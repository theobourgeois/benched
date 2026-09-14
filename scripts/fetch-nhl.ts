/**
 * Snapshots the NHL (teams, logos, rosters, ratings) into src/data/leagues/nhl.json and
 * public/logos/nhl/. Run `npm run data:nhl` to refresh; the game never calls these APIs itself.
 *
 * Ratings: EA publishes NHL ratings for the top ~300 players. Everyone else gets ratings derived
 * from season stats and NHL EDGE tracking, capped below EA's lowest overall so a derived depth
 * player never outranks a rated star.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  GOALIE_RATINGS,
  SKATER_RATINGS,
  type GoalieRatings,
  type League,
  type LeaguePlayer,
  type LeagueTeam,
  type Position,
  type SkaterRatings,
} from '../src/data/leagues/types.ts';

const WEB = 'https://api-web.nhle.com/v1';
const STATS = 'https://api.nhle.com/stats/rest/en';
const EA = 'https://www.ea.com/en/games/nhl/ratings';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const ROOT = new URL('..', import.meta.url);
const OUT_JSON = new URL('src/data/leagues/nhl.json', ROOT);
const LOGO_DIR = new URL('public/logos/nhl/', ROOT);
const EDGE_CACHE = new URL('node_modules/.cache/fetch-nhl/edge/', ROOT);

/** Kept per team: four lines, four pairs and three goalies. */
const KEEP = { F: 14, D: 8, G: 3 };
/** Games before a player's own stats fully replace the prior. */
const SKATER_GP = 20;
const GOALIE_GP = 10;
/** Where a player with no NHL track record lands, 0 to 1. */
const PRIOR = 0.15;
/** A season needs this many qualified skaters before its stats are used over last season's. */
const MIN_QUALIFIED = 300;

/** Brand colors, primary then secondary; the NHL API doesn't publish them. */
const COLORS: Record<string, [string, string]> = {
  ANA: ['#FC4C02', '#000000'],
  BOS: ['#FFB81C', '#000000'],
  BUF: ['#003087', '#FFB81C'],
  CGY: ['#C8102E', '#F1BE48'],
  CAR: ['#CE1126', '#000000'],
  CHI: ['#CF0A2C', '#000000'],
  COL: ['#6F263D', '#236192'],
  CBJ: ['#002654', '#CE1126'],
  DAL: ['#006847', '#8F8F8C'],
  DET: ['#CE1126', '#FFFFFF'],
  EDM: ['#041E42', '#FF4C00'],
  FLA: ['#C8102E', '#041E42'],
  LAK: ['#111111', '#A2AAAD'],
  MIN: ['#154734', '#A6192E'],
  MTL: ['#AF1E2D', '#192168'],
  NSH: ['#FFB81C', '#041E42'],
  NJD: ['#CE1126', '#000000'],
  NYI: ['#00539B', '#F47D30'],
  NYR: ['#0038A8', '#CE1126'],
  OTT: ['#DA1A32', '#B79257'],
  PHI: ['#F74902', '#000000'],
  PIT: ['#FCB514', '#000000'],
  SJS: ['#006D75', '#EA7200'],
  SEA: ['#001628', '#99D9D9'],
  STL: ['#002F87', '#FCB514'],
  TBL: ['#002868', '#FFFFFF'],
  TOR: ['#00205B', '#FFFFFF'],
  UTA: ['#010101', '#6CACE4'],
  VAN: ['#00205B', '#00843D'],
  VGK: ['#B4975A', '#333F42'],
  WSH: ['#C8102E', '#041E42'],
  WPG: ['#041E42', '#004C97'],
};

type Localized = { default: string };
interface StandingRow {
  teamAbbrev: Localized;
  teamName: Localized;
  teamCommonName: Localized;
  placeName: Localized;
  conferenceName: string;
  divisionName: string;
}
interface RosterPlayer {
  id: number;
  headshot: string;
  firstName: Localized;
  lastName: Localized;
  sweaterNumber?: number;
  positionCode: 'C' | 'L' | 'R' | 'D' | 'G';
  shootsCatches?: 'L' | 'R';
  heightInInches?: number;
  weightInPounds?: number;
  birthDate: string;
  birthCountry?: string;
}
interface Roster {
  forwards: RosterPlayer[];
  defensemen: RosterPlayer[];
  goalies: RosterPlayer[];
}
type StatRow = { playerId: number } & Record<string, number | string | null>;
interface Percentile {
  percentile?: number;
}
interface Edge {
  topShotSpeed?: Percentile;
  skatingSpeed?: { speedMax?: Percentile; burstsOver20?: Percentile };
  totalDistanceSkated?: Percentile;
}
interface EaPlayer {
  id: number;
  firstName: string;
  lastName: string;
  overallRating: number;
  jerseyNum: number;
  team: { label: string } | null;
  stats: Record<string, { value: number }>;
}

interface SkaterLine {
  /** Forwards and defensemen are ranked against their own position. */
  group: Group;
  gp: number;
  toi: number;
  points: number;
  assists: number;
  shots: number;
  shootingPct: number;
  hits: number;
  blocks: number;
  takeaways: number;
  faceoffs: number;
  faceoffPct: number;
}
interface GoalieLine {
  gp: number;
  starts: number;
  savePct: number;
  gaa: number;
  shutouts: number;
}
type Group = 'F' | 'D';
type Rank = (v: number | undefined) => number | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const avg = (...vs: (number | undefined)[]) => {
  const defined = vs.filter((v): v is number => v !== undefined);
  return defined.length ? defined.reduce((a, b) => a + b, 0) / defined.length : undefined;
};

async function request(url: string, init?: RequestInit): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (res.status === 404) return null;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 7) throw new Error(`${res.status} ${url}`);
    const header = Number(res.headers.get('retry-after'));
    const wait = header > 0 ? header * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
    console.warn(`  ${res.status}, retrying in ${wait / 1000}s: ${url}`);
    await sleep(wait);
  }
}
async function getJson<T>(url: string): Promise<T> {
  const res = await request(url);
  if (!res) throw new Error(`404 ${url}`);
  return (await res.json()) as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Share of the pool below `v`, ties counted half, so 0.5 is the median. */
function ranker(values: number[]): Rank {
  const pool = values.filter(Number.isFinite).sort((a, b) => a - b);
  return (v) => {
    if (v === undefined || !Number.isFinite(v) || !pool.length) return undefined;
    let below = 0;
    let equal = 0;
    for (const p of pool) {
      if (p < v) below++;
      else if (p === v) equal++;
      else break;
    }
    return (below + equal / 2) / pool.length;
  };
}

async function statRows(report: string, season: number) {
  const exp = encodeURIComponent(`seasonId=${season} and gameTypeId=2`);
  const res = await getJson<{ data: StatRow[] }>(`${STATS}/${report}?limit=-1&cayenneExp=${exp}`);
  return new Map(res.data.map((row) => [row.playerId, row]));
}

async function skaterLines(season: number) {
  const [summary, realtime, faceoffs] = await Promise.all([
    statRows('skater/summary', season),
    statRows('skater/realtime', season),
    statRows('skater/faceoffwins', season),
  ]);
  const lines = new Map<number, SkaterLine>();
  for (const [id, s] of summary) {
    const rt = realtime.get(id);
    const fo = faceoffs.get(id);
    lines.set(id, {
      group: s.positionCode === 'D' ? 'D' : 'F',
      gp: num(s.gamesPlayed),
      toi: num(s.timeOnIcePerGame),
      points: num(s.points),
      assists: num(s.assists),
      shots: num(s.shots),
      shootingPct: num(s.shootingPct),
      hits: num(rt?.hits),
      blocks: num(rt?.blockedShots),
      takeaways: num(rt?.takeaways),
      faceoffs: num(fo?.totalFaceoffs),
      faceoffPct: num(fo?.faceoffWinPct),
    });
  }
  return lines;
}

async function goalieLines(season: number) {
  const rows = await statRows('goalie/summary', season);
  const lines = new Map<number, GoalieLine>();
  for (const [id, g] of rows) {
    lines.set(id, {
      gp: num(g.gamesPlayed),
      starts: num(g.gamesStarted),
      savePct: num(g.savePct),
      gaa: num(g.goalsAgainstAverage),
      shutouts: num(g.shutouts),
    });
  }
  return lines;
}

/** Current season's stats once it's far enough along, otherwise last season's. */
async function pickStatsSeason(current: number) {
  const lines = await skaterLines(current);
  const qualified = [...lines.values()].filter((l) => l.gp >= SKATER_GP).length;
  if (qualified >= MIN_QUALIFIED) return { season: current, lines };
  const previous = current - 10001;
  return { season: previous, lines: await skaterLines(previous) };
}

/** EDGE is slow to scrape, so responses are kept between runs; delete the cache to refresh. */
async function fetchEdge(id: number, season: number): Promise<Edge | null> {
  const file = new URL(`${season}-${id}.json`, EDGE_CACHE);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Edge | null;
  } catch {
    const res = await request(`${WEB}/edge/skater-detail/${id}/${season}/2`);
    const edge = res ? ((await res.json()) as Edge) : null;
    await writeFile(file, JSON.stringify(edge));
    return edge;
  }
}

function collectEa(node: unknown, out: EaPlayer[] = []): EaPlayer[] {
  if (Array.isArray(node)) node.forEach((n) => collectEa(n, out));
  else if (node && typeof node === 'object') {
    if ('overallRating' in node && 'stats' in node) out.push(node as EaPlayer);
    else Object.values(node).forEach((n) => collectEa(n, out));
  }
  return out;
}

/** EA's ratings site embeds each page's players as Next.js page data, 50 at a time. */
async function fetchEa(): Promise<EaPlayer[]> {
  const seen = new Map<number, EaPlayer>();
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await request(`${EA}?page=${page}`, { headers: { 'user-agent': UA } });
      const html = res ? await res.text() : '';
      const data = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!data) throw new Error('page has no __NEXT_DATA__; the site layout changed');
      const fresh = collectEa(JSON.parse(data[1])).filter((p) => !seen.has(p.id));
      if (!fresh.length) break;
      for (const p of fresh) seen.set(p.id, p);
    }
  } catch (err) {
    console.warn(`EA ratings unavailable, deriving everyone: ${(err as Error).message}`);
  }
  return [...seen.values()];
}

/**
 * Pairs roster players with EA ratings in passes from most to least certain: surname and jersey
 * on the team, full name on the team, surname and first initial on the team (Mitch/Mitchell),
 * then a unique name anywhere for traded players. Each EA player is used once, so brothers and
 * namesakes don't share a rating.
 */
function matchEa(ea: EaPlayer[], roster: { p: RosterPlayer; team: string }[]) {
  const keys = (team: string, first: string, last: string, jersey: number | undefined) => {
    const [t, f, l] = [norm(team), norm(first), norm(last)];
    return [`${t}|${l}|#${jersey}`, `${t}|${l}|${f}`, `${t}|${l}|${f[0]}`, `${l}|${f}`];
  };
  const passes = [0, 1, 2, 3].map(() => new Map<string, EaPlayer[]>());
  for (const e of ea) {
    keys(e.team?.label ?? '', e.firstName, e.lastName, e.jerseyNum).forEach((key, i) =>
      passes[i].set(key, [...(passes[i].get(key) ?? []), e]),
    );
  }
  const claimed = new Set<number>();
  const matches = new Map<number, EaPlayer>();
  passes.forEach((index, i) => {
    for (const { p, team } of roster) {
      if (matches.has(p.id)) continue;
      const key = keys(team, p.firstName.default, p.lastName.default, p.sweaterNumber)[i];
      const open = (index.get(key) ?? []).filter((e) => !claimed.has(e.id));
      if (open.length !== 1) continue;
      matches.set(p.id, open[0]);
      claimed.add(open[0].id);
    }
  });
  return matches;
}

const rate = (t: number) => Math.round(52 + 38 * clamp01(t));

function skaterFeatures(line: SkaterLine) {
  const hours = (line.gp * line.toi) / 3600;
  const per60 = (x: number) => (hours > 0 ? x / hours : undefined);
  return {
    toi: line.toi,
    points: per60(line.points),
    assists: per60(line.assists),
    shooting: line.shots >= 30 ? line.shootingPct : undefined,
    hits: per60(line.hits),
    blocks: per60(line.blocks),
    takeaways: per60(line.takeaways),
    faceoffs: line.faceoffs >= 100 ? line.faceoffPct : undefined,
  };
}
type Features = ReturnType<typeof skaterFeatures>;

function skaterRanks(lines: SkaterLine[]) {
  const qualified = lines.filter((l) => l.gp >= SKATER_GP).map(skaterFeatures);
  const rank = (key: keyof Features) =>
    ranker(qualified.map((f) => f[key]).filter((v): v is number => v !== undefined));
  return {
    toi: rank('toi'),
    points: rank('points'),
    assists: rank('assists'),
    shooting: rank('shooting'),
    hits: rank('hits'),
    blocks: rank('blocks'),
    takeaways: rank('takeaways'),
    faceoffs: rank('faceoffs'),
  } satisfies Record<keyof Features, Rank>;
}

function deriveSkater(
  p: RosterPlayer,
  position: Exclude<Position, 'G'>,
  ranks: ReturnType<typeof skaterRanks>,
  size: { weight: Rank; height: Rank },
  line: SkaterLine | undefined,
  edge: Edge | undefined,
) {
  const f = line && line.gp > 0 ? skaterFeatures(line) : undefined;
  const pct = {
    toi: ranks.toi(f?.toi),
    points: ranks.points(f?.points),
    assists: ranks.assists(f?.assists),
    shooting: ranks.shooting(f?.shooting),
    hits: ranks.hits(f?.hits),
    blocks: ranks.blocks(f?.blocks),
    takeaways: ranks.takeaways(f?.takeaways),
    faceoffs: ranks.faceoffs(f?.faceoffs),
    speed: edge?.skatingSpeed?.speedMax?.percentile,
    bursts: edge?.skatingSpeed?.burstsOver20?.percentile,
    shotSpeed: edge?.topShotSpeed?.percentile,
    distance: edge?.totalDistanceSkated?.percentile,
  };
  const trust = Math.min(1, (line?.gp ?? 0) / SKATER_GP);
  const record =
    position === 'D'
      ? 0.6 * (pct.toi ?? 0) + 0.4 * (pct.points ?? 0)
      : 0.45 * (pct.toi ?? 0) + 0.55 * (pct.points ?? 0);
  const q = PRIOR + (record - PRIOR) * trust;
  /** Half overall quality, half the specific skill, the skill part scaled by sample size. */
  const skill = (v: number | undefined, weight = trust) =>
    rate(v === undefined ? q : q + (v - q) * 0.5 * weight);
  const weight = size.weight(p.weightInPounds);
  const height = size.height(p.heightInInches);
  const takesDraws = position === 'C' || pct.faceoffs !== undefined;

  const ratings: SkaterRatings = {
    speed: skill(pct.speed),
    acceleration: skill(pct.bursts),
    agility: skill(avg(pct.speed, pct.bursts)),
    balance: skill(weight, 1),
    strength: skill(avg(weight, weight, height), 1),
    endurance: skill(avg(pct.toi, pct.distance)),
    puckControl: skill(pct.points),
    deking: skill(pct.points),
    handeye: skill(avg(pct.shooting, pct.points)),
    passing: skill(pct.assists),
    wristshotPower: skill(pct.shotSpeed),
    wristshotAccuracy: skill(pct.shooting),
    slapshotPower: skill(pct.shotSpeed),
    slapshotAccuracy: skill(pct.shooting),
    bodyChecking: skill(pct.hits),
    stickChecking: skill(pct.takeaways),
    shotBlocking: skill(pct.blocks),
    faceoffs: takesDraws ? skill(pct.faceoffs) : rate(q * 0.4),
    offensiveAwareness: skill(pct.points),
    defensiveAwareness: skill(position === 'D' ? pct.toi : avg(pct.takeaways, pct.blocks)),
    aggression: skill(pct.hits),
    poise: skill(undefined),
  };
  return { q, ratings };
}

function goalieRanks(lines: GoalieLine[]) {
  const qualified = lines.filter((l) => l.gp >= GOALIE_GP);
  return {
    savePct: ranker(qualified.map((l) => l.savePct)),
    gaa: ranker(qualified.map((l) => -l.gaa)),
    starts: ranker(qualified.map((l) => l.starts)),
    shutouts: ranker(qualified.map((l) => l.shutouts)),
  };
}

function deriveGoalie(line: GoalieLine | undefined, ranks: ReturnType<typeof goalieRanks>) {
  const played = line && line.gp > 0 ? line : undefined;
  const pct = {
    savePct: ranks.savePct(played?.savePct),
    gaa: ranks.gaa(played ? -played.gaa : undefined),
    starts: ranks.starts(played?.starts),
    shutouts: ranks.shutouts(played?.shutouts),
  };
  const trust = Math.min(1, (line?.gp ?? 0) / GOALIE_GP);
  const record = 0.6 * (pct.savePct ?? 0) + 0.4 * (pct.starts ?? 0);
  const q = PRIOR + (record - PRIOR) * trust;
  const skill = (v: number | undefined) => rate(v === undefined ? q : q + (v - q) * 0.5 * trust);

  const ratings: GoalieRatings = {
    glovesideHigh: skill(pct.savePct),
    glovesideLow: skill(pct.savePct),
    sticksideHigh: skill(pct.savePct),
    sticksideLow: skill(pct.savePct),
    fiveHole: skill(pct.savePct),
    angles: skill(pct.savePct),
    reboundControl: skill(pct.gaa),
    pokeCheck: skill(undefined),
    breakaway: skill(pct.savePct),
    speed: skill(undefined),
    agility: skill(undefined),
    shotRecover: skill(pct.gaa),
    vision: skill(pct.savePct),
    passing: skill(undefined),
    poise: skill(pct.shutouts),
    endurance: skill(pct.starts),
  };
  return { q, ratings };
}

const allOf = (r: Roster) => [...r.forwards, ...r.defensemen, ...r.goalies];

const positionOf = (code: RosterPlayer['positionCode']): Position =>
  ({ C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' })[code] as Position;

/** Keeps numbers unique within a team; the higher-rated player keeps a contested number. */
function assignNumbers(players: LeaguePlayer[]) {
  const ranked = [...players].sort((a, b) => b.overall - a.overall);
  const taken = new Set<number>();
  for (const p of ranked) {
    if (p.number && !taken.has(p.number)) taken.add(p.number);
    else p.number = 0;
  }
  for (const p of ranked) {
    if (p.number) continue;
    let n = 2;
    while (taken.has(n) || n === 99) n++;
    p.number = n;
    taken.add(n);
  }
}

/** One player per line keeps roster refreshes readable in diffs. */
function formatLeague(league: League) {
  const rows = league.teams.map((team) => team.players.map((p) => JSON.stringify(p)));
  const skeleton = {
    ...league,
    teams: league.teams.map((team, i) => ({ ...team, players: `@players${i}` })),
  };
  return (
    JSON.stringify(skeleton, null, 2).replace(
      /"@players(\d+)"/g,
      (_, i: string) => `[\n${rows[Number(i)].map((r) => `        ${r}`).join(',\n')}\n      ]`,
    ) + '\n'
  );
}

async function main() {
  const seasons = await getJson<number[]>(`${WEB}/season`);
  const rosterSeason = seasons[seasons.length - 1];

  const [standings, stats, goalies, ea] = await Promise.all([
    getJson<{ standings: StandingRow[] }>(`${WEB}/standings/now`),
    pickStatsSeason(rosterSeason),
    goalieLines(rosterSeason),
    fetchEa(),
  ]);
  const statsSeason = stats.season;
  const goalieStats = statsSeason === rosterSeason ? goalies : await goalieLines(statsSeason);
  console.log(`rosters ${rosterSeason}, stats ${statsSeason}, ${ea.length} EA ratings`);

  const clubs = standings.standings
    .map((row) => ({
      abbr: row.teamAbbrev.default,
      name: row.teamName.default,
      city: row.placeName.default,
      nickname: row.teamCommonName.default,
      conference: row.conferenceName,
      division: row.divisionName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const missing = clubs.filter((c) => !COLORS[c.abbr]).map((c) => c.abbr);
  if (missing.length) throw new Error(`add brand colors for: ${missing.join(', ')}`);

  const rosters = await mapLimit(clubs, 8, (c) =>
    getJson<Roster>(`${WEB}/roster/${c.abbr}/${rosterSeason}`),
  );
  const everyone = rosters.flatMap(allOf);
  const skaters = everyone.filter((p) => p.positionCode !== 'G');

  const allLines = [...stats.lines.values()];
  const skaterRanksBy = {
    F: skaterRanks(allLines.filter((l) => l.group === 'F')),
    D: skaterRanks(allLines.filter((l) => l.group === 'D')),
  };
  // Derived overalls sit below the weakest EA-rated player.
  const ceiling = ea.length ? Math.min(...ea.map((p) => p.overallRating)) - 1 : 90;
  const overallOf = (q: number) => Math.min(ceiling, Math.round(62 + 21 * q));
  const size = {
    weight: ranker(skaters.map((p) => num(p.weightInPounds))),
    height: ranker(skaters.map((p) => num(p.heightInInches))),
  };
  const gRanks = goalieRanks([...goalieStats.values()]);
  const eaMatches = matchEa(
    ea,
    clubs.flatMap((club, i) => allOf(rosters[i]).map((p) => ({ p, team: club.name }))),
  );
  const skaterRatingsOf = (p: RosterPlayer, position: Exclude<Position, 'G'>, edge?: Edge) =>
    deriveSkater(
      p,
      position,
      skaterRanksBy[position === 'D' ? 'D' : 'F'],
      size,
      stats.lines.get(p.id),
      edge,
    );
  const goalieRatingsOf = (p: RosterPlayer) => deriveGoalie(goalieStats.get(p.id), gRanks);

  // Overalls don't use EDGE, so lineups are picked first and only dressed, derived skaters
  // need the slow EDGE lookups.
  const lineups = clubs.map((club, i) => {
    const candidates = allOf(rosters[i]).map((p) => {
      const position = positionOf(p.positionCode);
      const rated = eaMatches.get(p.id);
      const q = position === 'G' ? goalieRatingsOf(p).q : skaterRatingsOf(p, position).q;
      return { p, position, rated, overall: rated?.overallRating ?? overallOf(q) };
    });
    type Candidate = (typeof candidates)[number];
    const best = (keep: (c: Candidate) => boolean, n: number) =>
      candidates
        .filter(keep)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, n);
    const dressed = [
      ...best((c) => c.position !== 'D' && c.position !== 'G', KEEP.F),
      ...best((c) => c.position === 'D', KEEP.D),
      ...best((c) => c.position === 'G', KEEP.G),
    ];
    return { club, dressed };
  });

  const tracked = lineups
    .flatMap((l) => l.dressed)
    .filter((c) => !c.rated && c.position !== 'G' && (stats.lines.get(c.p.id)?.gp ?? 0) > 0);
  const edges = new Map<number, Edge>();
  let fetched = 0;
  await mkdir(EDGE_CACHE, { recursive: true });
  // EDGE rate-limits hard and answers bursts with a minute-long block, so it goes one at a time.
  await mapLimit(tracked, 1, async ({ p }) => {
    const edge = await fetchEdge(p.id, statsSeason);
    if (edge) edges.set(p.id, edge);
    if (++fetched % 25 === 0) console.log(`  EDGE ${fetched}/${tracked.length}`);
  });
  console.log(`EDGE tracking for ${edges.size}/${tracked.length} derived skaters`);

  const order: Record<Position, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };
  const teams: LeagueTeam[] = lineups.map(({ club, dressed }) => {
    const players = dressed.map(({ p, position, rated, overall }): LeaguePlayer => {
      const base = {
        id: p.id,
        firstName: p.firstName.default,
        lastName: p.lastName.default,
        number: p.sweaterNumber ?? 0,
        shoots: p.shootsCatches ?? 'L',
        heightIn: p.heightInInches ?? 73,
        weightLb: p.weightInPounds ?? 200,
        birthDate: p.birthDate,
        country: p.birthCountry ?? '',
        headshot: p.headshot,
        overall,
        ratingSource: rated ? ('ea' as const) : ('derived' as const),
      };
      if (position === 'G') {
        const ratings = rated ? eaRatings(rated, GOALIE_RATINGS) : goalieRatingsOf(p).ratings;
        return { ...base, position, ratings };
      }
      const ratings = rated
        ? eaRatings(rated, SKATER_RATINGS)
        : skaterRatingsOf(p, position, edges.get(p.id)).ratings;
      return { ...base, position, ratings };
    });
    players.sort((a, b) => order[a.position] - order[b.position] || b.overall - a.overall);
    assignNumbers(players);
    const [primary, secondary] = COLORS[club.abbr];
    return {
      ...club,
      colors: { primary, secondary },
      logos: { light: `logos/nhl/${club.abbr}_light.svg`, dark: `logos/nhl/${club.abbr}_dark.svg` },
      players,
    };
  });

  await mkdir(LOGO_DIR, { recursive: true });
  await mapLimit(
    teams.flatMap((t) => [`${t.abbr}_light.svg`, `${t.abbr}_dark.svg`]),
    8,
    async (file) => {
      const svg = await (await request(`https://assets.nhle.com/logos/nhl/svg/${file}`))?.text();
      if (!svg) throw new Error(`missing logo ${file}`);
      await writeFile(new URL(file, LOGO_DIR), svg);
    },
  );

  const league: League = {
    id: 'nhl',
    name: 'National Hockey League',
    abbr: 'NHL',
    rosterSeason: String(rosterSeason),
    statsSeason: String(statsSeason),
    fetchedAt: new Date().toISOString(),
    teams,
  };
  await mkdir(new URL('.', OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, formatLeague(league));

  const matched = new Set([...eaMatches.values()].map((p) => p.id));
  const unmatched = ea.filter((p) => !matched.has(p.id));
  const players = teams.flatMap((t) => t.players);
  console.log(
    `${teams.length} teams, ${players.length} players ` +
      `(${players.filter((p) => p.ratingSource === 'ea').length} EA-rated, derived capped at ${ceiling})`,
  );
  if (unmatched.length) {
    console.log(
      `${unmatched.length} EA players not on a roster: ` +
        unmatched
          .slice(0, 12)
          .map((p) => `${p.firstName} ${p.lastName} (${p.team?.label ?? '?'})`)
          .join(', '),
    );
  }
}

function eaRatings<K extends string>(p: EaPlayer, keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, p.stats[k]?.value ?? 50])) as Record<K, number>;
}

await main();
