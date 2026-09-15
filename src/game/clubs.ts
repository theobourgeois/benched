import nhlData from '../data/leagues/nhl.json';
import type { League, LeaguePlayer, LeagueTeam } from '../data/leagues/types';
import type { Jersey, Team } from './types';

export interface Uniform {
  jersey: string;
  trim: string;
  /** Team mark that contrasts with this jersey. */
  crest: string;
}
export interface Starter {
  name: string;
  number: number;
}
export interface Club {
  /** Unique across leagues, e.g. "nhl:TOR". */
  key: string;
  league: string;
  abbr: string;
  city: string;
  name: string;
  /** Team color that reads on the dark menu and HUD. */
  accent: string;
  home: Uniform;
  away: Uniform;
  /** Logo image drawn for dark backgrounds. */
  logo: string;
  /** Logo image drawn for ice and other light surfaces. */
  logoLight: string;
  /** Starters in engine role order: C, LW, RW, LD, RD, G. */
  lineup: Starter[];
}
export interface LeagueOption {
  id: string;
  name: string;
  clubs: Club[];
  /** Keys of the matchup shown when the league is picked. */
  featured: [string, string];
}

const AWAY_WHITE = '#eef2f5';
/** A natural winger or strong-side defenseman keeps the spot over a better player within this many overall. */
const POSITION_BIAS = 4;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const saturation = (hex: string) => Math.max(...channels(hex)) - Math.min(...channels(hex));
const toward = (hex: string, target: string, t: number) =>
  '#' +
  channels(hex)
    .map((c, i) =>
      Math.round((c + (channels(target)[i] - c) * t) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/** The first brand color bright and colorful enough for the dark UI, else the primary lifted toward white. */
function accentOf(primary: string, secondary: string) {
  const readable = (c: string) => luminance(c) > 0.09 && saturation(c) > 0.2;
  if (readable(primary)) return primary;
  if (readable(secondary)) return secondary;
  let lifted = primary;
  for (let t = 0.1; luminance(lifted) < 0.2 && t < 1; t += 0.1)
    lifted = toward(primary, '#ffffff', t);
  return lifted;
}

/** Best player for each role, preferring a natural fit unless someone else is clearly better. */
function startersOf(players: LeaguePlayer[]): Starter[] {
  const pool = [...players].sort((a, b) => b.overall - a.overall);
  const take = (natural: (p: LeaguePlayer) => boolean, fallback: (p: LeaguePlayer) => boolean) => {
    const fit = pool.find(natural);
    const best = pool.find(fallback);
    const pick = fit && (!best || fit.overall >= best.overall - POSITION_BIAS) ? fit : best;
    if (!pick) throw new Error('roster is missing a position');
    pool.splice(pool.indexOf(pick), 1);
    return { name: pick.lastName, number: pick.number };
  };
  const forward = (p: LeaguePlayer) => p.position !== 'D' && p.position !== 'G';
  const defense = (p: LeaguePlayer) => p.position === 'D';
  const goalie = (p: LeaguePlayer) => p.position === 'G';
  return [
    take((p) => p.position === 'C', forward),
    take((p) => p.position === 'LW', forward),
    take((p) => p.position === 'RW', forward),
    take((p) => defense(p) && p.shoots === 'L', defense),
    take((p) => defense(p) && p.shoots === 'R', defense),
    take(goalie, goalie),
  ];
}

function crestOf(jersey: string, team: LeagueTeam) {
  const file = luminance(jersey) > 0.45 ? team.logos.light : team.logos.dark;
  return `${import.meta.env.BASE_URL}${file}`;
}

function clubOf(league: League, team: LeagueTeam): Club {
  const { primary, secondary } = team.colors;
  return {
    key: `${league.id}:${team.abbr}`,
    league: league.id,
    abbr: team.abbr,
    city: team.city,
    name: team.nickname,
    accent: accentOf(primary, secondary),
    home: { jersey: primary, trim: secondary, crest: crestOf(primary, team) },
    away: { jersey: AWAY_WHITE, trim: primary, crest: crestOf(AWAY_WHITE, team) },
    logo: `${import.meta.env.BASE_URL}${team.logos.dark}`,
    logoLight: `${import.meta.env.BASE_URL}${team.logos.light}`,
    lineup: startersOf(team.players),
  };
}

function leagueOption(league: League, featured: [string, string]): LeagueOption {
  return {
    id: league.id,
    name: league.abbr,
    clubs: league.teams.map((team) => clubOf(league, team)),
    featured: [`${league.id}:${featured[0]}`, `${league.id}:${featured[1]}`],
  };
}

/** Leagues with a snapshot in src/data/leagues; add one here to make it selectable. */
export const LEAGUES: LeagueOption[] = [leagueOption(nhlData as unknown as League, ['TOR', 'MTL'])];

export const leagueOf = (club: Club) => LEAGUES.find((l) => l.id === club.league) ?? LEAGUES[0];
export const uniformFor = (club: Club, jersey: Jersey) =>
  jersey === 'home' ? club.home : club.away;
export const otherJersey = (jersey: Jersey): Jersey => (jersey === 'home' ? 'away' : 'home');
/** The picking side wears its choice and the opponent the other set, so the colors never clash. */
export function jerseysFor(side: Team, choice: Jersey): [Jersey, Jersey] {
  return side === 0 ? [choice, otherJersey(choice)] : [otherJersey(choice), choice];
}

export function openingMatchup(league: LeagueOption): [Club, Club] {
  const find = (key: string, fallback: number) =>
    league.clubs.find((c) => c.key === key) ?? league.clubs[fallback];
  return [find(league.featured[0], 0), find(league.featured[1], 1)];
}
export const DEFAULT_MATCHUP = openingMatchup(LEAGUES[0]);

/** The next club in the league, skipping the opponent so a team never plays itself. */
export function cycleClub(league: LeagueOption, current: Club, opponent: Club, step: 1 | -1) {
  const clubs = league.clubs.filter((c) => c.key !== opponent.key);
  const i = clubs.findIndex((c) => c.key === current.key);
  return clubs[(i + step + clubs.length) % clubs.length];
}
