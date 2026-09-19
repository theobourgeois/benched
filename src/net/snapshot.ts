import { createHuman, MAX_HUMANS } from '../game/humans';
import { TEAMS } from '../game/types';
import { blendField, Cursor, metres, sizeOf, timer, unit, type Field } from './wire';
import type {
  CellyKind,
  DekeKind,
  GameEvent,
  MatchState,
  Phase,
  SaveKind,
  Skater,
  Team,
} from '../game/types';

/**
 * One binary shape for a moment of a match, used for both boundaries this game has: the worker
 * running the simulation off the render thread, and the socket carrying it to the other player.
 * Writing it once means the network format is exercised on every local frame, so a field that
 * fails to cross shows up long before anyone is online.
 *
 * Only what moves is sent. Names, numbers, roles and clubs are settled when the match starts and
 * never change, so the receiver keeps its own skaters and has their positions posed onto it.
 */

/** Enum orders are part of the wire format: append to them, never reorder. */
const DEKES: readonly (DekeKind | null)[] = [
  null,
  'stride',
  'burst',
  'protect',
  'jump',
  'throughLegs',
  'windmill',
  'spin',
];
const CELLIES: readonly (CellyKind | null)[] = [null, 'helicopter', 'jump', 'limp', 'dance'];
const SAVES: readonly (SaveKind | null)[] = [
  null,
  'butterfly',
  'pad',
  'glove',
  'blocker',
  'body',
  'stick',
];
const SHOT_STYLES = [null, 'wrist', 'slap', 'backhand', 'pass'] as const;
export const PHASES: readonly Phase[] = [
  'menu',
  'faceoff',
  'playing',
  'goal',
  'intermission',
  'paused',
  'final',
];

const SKATER: readonly Field[] = [
  metres('x'),
  metres('z'),
  metres('vx'),
  metres('vz'),
  { key: 'angle', kind: 'angle' },
  { key: 'stamina', kind: 'u8', scale: 255, blend: 'lerp' },
  timer('cooldown'),
  timer('checkTimer'),
  // Stride winds on without resetting, so it keeps full precision.
  { key: 'stride', kind: 'f32', blend: 'lerp' },
  unit('skateDrive'),
  unit('edgeLean'),
  timer('downTimer'),
  timer('stumbleTimer'),
  unit('rush'),
  { key: 'hitLock', kind: 'i16', scale: 1 },
  { key: 'checkPower', kind: 'u8', scale: 255, blend: 'lerp' },
  { key: 'checkLanded', kind: 'bool' },
  timer('hitImmunity'),
  { key: 'fallAngle', kind: 'angle' },
  unit('stickSide'),
  unit('stickReach'),
  unit('stickSideVel'),
  unit('stickReachVel'),
  timer('shotTimer'),
  timer('saveTimer'),
  { key: 'saveKind', kind: 'enum', values: SAVES },
  unit('saveSide'),
  unit('saveHeight'),
  timer('readTimer'),
  timer('coverTimer'),
  { key: 'shotStyle', kind: 'enum', values: SHOT_STYLES },
  timer('shotDuration'),
  unit('shotSide'),
  unit('shotReach'),
  unit('shotLoad'),
  timer('passTimer'),
  timer('diveTimer'),
  timer('blockTimer'),
  timer('liftTimer'),
  { key: 'dekeKind', kind: 'enum', values: DEKES },
  timer('dekeTimer'),
  { key: 'dekeDir', kind: 'i16', scale: 1 },
  { key: 'cellyKind', kind: 'enum', values: CELLIES },
  timer('cellyTimer'),
  // The charged shot in flight: present, then its five numbers and the tick it began on.
  { key: 'pendingShot', kind: 'bool' },
  timer('pendingTimer'),
  unit('pendingLoad'),
  unit('pendingPower'),
  unit('pendingAim'),
  unit('pendingHeight'),
  { key: 'pendingTick', kind: 'f32' },
];

const PUCK_FIELDS: readonly Field[] = [
  metres('x'),
  metres('z'),
  { key: 'y', kind: 'i16', scale: 1000, blend: 'lerp' },
  metres('vx'),
  metres('vz'),
  metres('vy'),
  { key: 'owner', kind: 'i16', scale: 1 },
  { key: 'lastTouch', kind: 'i16', scale: 1 },
  timer('lockout'),
  { key: 'shot', kind: 'bool' },
  { key: 'passTo', kind: 'i16', scale: 1 },
];

/** A side, followed on the wire by `humans` rows of `HUMAN`: the people playing it, in seat order. */
const SIDE: readonly Field[] = [
  { key: 'humans', kind: 'u8', scale: 1 },
  unit('drawInput'),
  { key: 'drawReady', kind: 'bool' },
  unit('drawAimX'),
  unit('drawAimZ'),
];

const HUMAN: readonly Field[] = [
  { key: 'controlled', kind: 'i16', scale: 1 },
  { key: 'autoSkate', kind: 'bool' },
  unit('shotCharge'),
  unit('shotAim'),
  unit('shotLift'),
  { key: 'passHeld', kind: 'bool' },
  unit('passAimX'),
  unit('passAimZ'),
  { key: 'passTarget', kind: 'i16', scale: 1 },
  unit('passRange'),
];

const MATCH: readonly Field[] = [
  { key: 'phase', kind: 'enum', values: PHASES },
  { key: 'period', kind: 'u8', scale: 1 },
  { key: 'clock', kind: 'f32', blend: 'gameClock' },
  { key: 'countdown', kind: 'f32', blend: 'time' },
  { key: 'scoreHome', kind: 'u8', scale: 1 },
  { key: 'scoreAway', kind: 'u8', scale: 1 },
  { key: 'shotsHome', kind: 'u8', scale: 1 },
  { key: 'shotsAway', kind: 'u8', scale: 1 },
  { key: 'hitsHome', kind: 'u8', scale: 1 },
  { key: 'hitsAway', kind: 'u8', scale: 1 },
  { key: 'scoringTeam', kind: 'i16', scale: 1 },
  { key: 'tick', kind: 'f32', blend: 'lerp' },
  timer('hitstop'),
  { key: 'noticeTimer', kind: 'u16', scale: 1000, blend: 'time' },
  { key: 'noticeTeam', kind: 'i16', scale: 1 },
  { key: 'shootoutShooter', kind: 'u8', scale: 1 },
  { key: 'shootoutRound', kind: 'u8', scale: 1 },
  { key: 'shootoutTaken0', kind: 'u8', scale: 1 },
  { key: 'shootoutTaken1', kind: 'u8', scale: 1 },
  { key: 'possessionHome', kind: 'f32', blend: 'lerp' },
  { key: 'possessionAway', kind: 'f32', blend: 'lerp' },
  // The host's clock when this was sent, and the newest input stamp it has heard. Each end
  // reads back only the stamp it issued, so the two clocks never have to agree.
  { key: 'stamp', kind: 'f32' },
  { key: 'echo', kind: 'f32' },
];
const MATCH_INDEX = Object.fromEntries(MATCH.map((f, i) => [f.key, i]));
const SIDE_INDEX = Object.fromEntries(SIDE.map((f, i) => [f.key, i]));

/**
 * Whistles, hits and horns. The watching client has no simulation to raise its own, so what the
 * host heard is sent along: without these the other end is a silent rink with no spray.
 */
const EVENT_KINDS = [
  'shot',
  'pass',
  'hit',
  'goal',
  'post',
  'crossbar',
  'save',
  'faceoff',
  'horn',
  'receive',
  'stick',
  'deflect',
  'boards',
] as const;
const EVENT: readonly Field[] = [
  { key: 'id', kind: 'f32' },
  { key: 'type', kind: 'enum', values: EVENT_KINDS },
  { key: 'power', kind: 'u8', scale: 255 },
  metres('x'),
  metres('z'),
  { key: 'barDown', kind: 'bool' },
  { key: 'placed', kind: 'bool' },
];
/** Far more than a thirtieth of a second ever produces; the count is sent, so spare bytes cost nothing. */
const MAX_EVENTS = 24;

/** Bytes one snapshot takes at most: the match, both sides, the puck, the skaters and any calls. */
export const SNAPSHOT_BYTES =
  sizeOf(MATCH) +
  (sizeOf(SIDE) + sizeOf(HUMAN) * MAX_HUMANS) * 2 +
  sizeOf(PUCK_FIELDS) +
  1 +
  sizeOf(SKATER) * 12 +
  1 +
  sizeOf(EVENT) * MAX_EVENTS;

/** Flatten the parts of a skater that are nested, so the table can stay flat. */
function skaterValues(p: Skater): Record<string, unknown> {
  return {
    ...p,
    pendingShot: !!p.pendingShot,
    pendingTimer: p.pendingShot?.timer ?? 0,
    pendingLoad: p.pendingShot?.load ?? 0,
    pendingPower: p.pendingShot?.power ?? 0,
    pendingAim: p.pendingShot?.aim ?? 0,
    pendingHeight: p.pendingShot?.height ?? 0,
    pendingTick: p.pendingShot?.tick ?? 0,
  };
}

/** A clock reading that fits a float exactly: whole milliseconds, wrapping every ~17 minutes. */
export const STAMP_WRAP = 1 << 20;
export const stampNow = (now = performance.now()) => Math.round(now) % STAMP_WRAP;
/** Milliseconds since a stamp was issued, on the clock that issued it. */
export const sinceStamp = (stamp: number, now = performance.now()) =>
  (stampNow(now) - stamp + STAMP_WRAP) % STAMP_WRAP;

/**
 * `sinceEvent` is the last call the other end already heard, so each one crosses exactly once.
 * Pass -1 to send everything the match still remembers. `stamp` is the sender's clock and
 * `echo` the newest stamp it has heard from the other end, which is how each side measures its
 * own round trip.
 */
export function encodeSnapshot(s: MatchState, sinceEvent = -1, stamp = 0, echo = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(SNAPSHOT_BYTES);
  const at = new Cursor(new DataView(buffer));
  const match: Record<string, unknown> = {
    ...s,
    stamp,
    echo,
    scoreHome: s.score[0],
    scoreAway: s.score[1],
    shotsHome: s.shots[0],
    shotsAway: s.shots[1],
    hitsHome: s.hits[0],
    hitsAway: s.hits[1],
    scoringTeam: s.scoringTeam ?? -1,
    noticeTeam: s.noticeTeam ?? -1,
    shootoutTaken0: s.shootoutTaken[0],
    shootoutTaken1: s.shootoutTaken[1],
    possessionHome: s.possession[0],
    possessionAway: s.possession[1],
  };
  for (const field of MATCH) at.write(field, match[field.key]);
  for (const team of TEAMS) {
    const side = s.sides[team];
    const humans = side.humans.slice(0, MAX_HUMANS);
    const values: Record<string, unknown> = { ...side, humans: humans.length };
    for (const field of SIDE) at.write(field, values[field.key]);
    for (const human of humans) {
      const seat: Record<string, unknown> = {
        ...human,
        passAimX: human.passAim.x,
        passAimZ: human.passAim.z,
        passTarget: human.passTarget ?? -1,
      };
      for (const field of HUMAN) at.write(field, seat[field.key]);
    }
  }
  const puck: Record<string, unknown> = {
    ...s.puck,
    owner: s.puck.owner ?? -1,
    lastTouch: s.puck.lastTouch ?? -1,
    passTo: s.puck.passTo ?? -1,
  };
  for (const field of PUCK_FIELDS) at.write(field, puck[field.key]);
  at.write({ key: 'count', kind: 'u8', scale: 1 }, s.skaters.length);
  for (const p of s.skaters) {
    const values = skaterValues(p);
    for (const field of SKATER) at.write(field, values[field.key]);
  }
  const calls = s.events.filter((e) => e.id > sinceEvent).slice(-MAX_EVENTS);
  at.write({ key: 'count', kind: 'u8', scale: 1 }, calls.length);
  for (const event of calls) {
    const values: Record<string, unknown> = {
      ...event,
      power: Math.min(1, event.power),
      x: event.x ?? 0,
      z: event.z ?? 0,
      // Most calls happen at the puck and carry no place of their own.
      placed: event.x !== undefined,
      barDown: !!event.barDown,
    };
    for (const field of EVENT) at.write(field, values[field.key]);
  }
  return buffer.slice(0, at.offset);
}

/**
 * A snapshot read off the wire, still in the order of the field tables, so two of them can be
 * blended field by field without either being poured into a match first.
 */
export interface SideSnapshot {
  side: unknown[];
  humans: unknown[][];
}
export interface Snapshot {
  match: unknown[];
  sides: [SideSnapshot, SideSnapshot];
  puck: unknown[];
  skaters: unknown[][];
  events: GameEvent[];
}

const readAll = (at: Cursor, fields: readonly Field[], into?: unknown[]) => {
  const out = into ?? new Array<unknown>(fields.length);
  for (let i = 0; i < fields.length; i++) out[i] = at.read(fields[i]);
  return out;
};

export function decodeSnapshot(buffer: ArrayBuffer): Snapshot {
  const at = new Cursor(new DataView(buffer));
  const match = readAll(at, MATCH);
  const readSide = (): SideSnapshot => {
    const side = readAll(at, SIDE);
    const humans: unknown[][] = [];
    for (let i = 0; i < (side[SIDE_INDEX.humans] as number); i++) humans.push(readAll(at, HUMAN));
    return { side, humans };
  };
  const sides: [SideSnapshot, SideSnapshot] = [readSide(), readSide()];
  const puck = readAll(at, PUCK_FIELDS);
  const roster = at.read({ key: 'count', kind: 'u8', scale: 1 }) as number;
  const skaters: unknown[][] = [];
  for (let i = 0; i < roster; i++) skaters.push(readAll(at, SKATER));
  const count = at.read({ key: 'count', kind: 'u8', scale: 1 }) as number;
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    const values: Record<string, unknown> = {};
    for (const field of EVENT) values[field.key] = at.read(field);
    events.push({
      id: values.id as number,
      type: values.type as GameEvent['type'],
      power: values.power as number,
      ...(values.placed ? { x: values.x as number, z: values.z as number } : {}),
      ...(values.barDown ? { barDown: true } : {}),
    });
  }
  return { match, sides, puck, skaters, events };
}

/** The simulation step a snapshot was taken on: the host's timeline, which the watcher follows. */
export const snapshotTick = (snap: Snapshot) => snap.match[MATCH_INDEX.tick] as number;
export const snapshotStamp = (snap: Snapshot) => snap.match[MATCH_INDEX.stamp] as number;
export const snapshotEcho = (snap: Snapshot) => snap.match[MATCH_INDEX.echo] as number;
export const snapshotPhase = (snap: Snapshot) => snap.match[MATCH_INDEX.phase] as Phase;
export const snapshotHitstop = (snap: Snapshot) => snap.match[MATCH_INDEX.hitstop] as number;
const PUCK_INDEX = Object.fromEntries(PUCK_FIELDS.map((f, i) => [f.key, i]));
const HUMAN_INDEX = Object.fromEntries(HUMAN.map((f, i) => [f.key, i]));
export const snapshotPuckOwner = (snap: Snapshot) => {
  const owner = snap.puck[PUCK_INDEX.owner] as number;
  return owner < 0 ? null : owner;
};
/** Which skater a seat holds and whether it is auto-skating, or null when nobody sits there. */
export function snapshotHuman(snap: Snapshot, team: Team, seat: number) {
  const row = snap.sides[team].humans[seat];
  if (!row) return null;
  return {
    controlled: row[HUMAN_INDEX.controlled] as number,
    autoSkate: row[HUMAN_INDEX.autoSkate] as boolean,
  };
}

const blendAll = (
  fields: readonly Field[],
  a: unknown[],
  b: unknown[],
  t: number,
  span: number,
  into: unknown[],
) => {
  for (let i = 0; i < fields.length; i++) into[i] = blendField(fields[i], a[i], b[i], t, span);
  return into;
};

/**
 * The match `t` of the way from one snapshot to the next, which are `span` seconds apart. What
 * moves is drawn between them; what is discrete takes the nearer one. The calls are left out:
 * they belong to a moment, not to the space between two, and the session hands them over as each
 * moment is reached.
 */
export function blendSnapshots(a: Snapshot, b: Snapshot, t: number, span: number, into?: Snapshot) {
  const out: Snapshot = into ?? {
    match: [],
    sides: [
      { side: [], humans: [] },
      { side: [], humans: [] },
    ],
    puck: [],
    skaters: [],
    events: [],
  };
  blendAll(MATCH, a.match, b.match, t, span, out.match);
  for (const team of TEAMS) {
    const from = a.sides[team],
      to = b.sides[team],
      into = out.sides[team];
    blendAll(SIDE, from.side, to.side, t, span, into.side);
    // Seats only line up when both moments have the same people; otherwise take the nearer one.
    const seats =
      from.humans.length === to.humans.length ? to.humans : t < 0.5 ? from.humans : to.humans;
    into.humans.length = seats.length;
    seats.forEach((seat, k) => {
      const start = from.humans.length === to.humans.length ? from.humans[k] : seat;
      into.humans[k] = blendAll(HUMAN, start, seat, t, span, into.humans[k] ?? []);
    });
  }
  blendAll(PUCK_FIELDS, a.puck, b.puck, t, span, out.puck);
  const n = Math.min(a.skaters.length, b.skaters.length);
  out.skaters.length = n;
  for (let i = 0; i < n; i++)
    out.skaters[i] = blendAll(SKATER, a.skaters[i], b.skaters[i], t, span, out.skaters[i] ?? []);
  out.events = [];
  return out;
}

const byKey = (fields: readonly Field[], values: unknown[]) => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i++) out[fields[i].key] = values[i];
  return out;
};

/**
 * Pose an existing match onto a snapshot, in place. The object identity is kept deliberately:
 * the scene treats a new match object as a cut, and the replay recorder clears its buffer on one.
 */
export function poseSnapshot(s: MatchState, snap: Snapshot) {
  const match = byKey(MATCH, snap.match);
  s.phase = match.phase as Phase;
  s.period = match.period as number;
  s.clock = match.clock as number;
  s.countdown = match.countdown as number;
  s.score = [match.scoreHome as number, match.scoreAway as number];
  s.shots = [match.shotsHome as number, match.shotsAway as number];
  s.hits = [match.hitsHome as number, match.hitsAway as number];
  s.scoringTeam = (match.scoringTeam as number) < 0 ? null : (match.scoringTeam as Team);
  s.tick = match.tick as number;
  s.hitstop = match.hitstop as number;
  s.noticeTimer = match.noticeTimer as number;
  s.noticeTeam = (match.noticeTeam as number) < 0 ? null : (match.noticeTeam as Team);
  s.shootoutShooter = match.shootoutShooter as Team;
  s.shootoutRound = match.shootoutRound as number;
  s.shootoutTaken = [match.shootoutTaken0 as number, match.shootoutTaken1 as number];
  s.possession = [match.possessionHome as number, match.possessionAway as number];
  for (const team of TEAMS) {
    const side = s.sides[team];
    const draw = byKey(SIDE, snap.sides[team].side);
    side.drawInput = draw.drawInput as number;
    side.drawReady = draw.drawReady as boolean;
    side.drawAimX = draw.drawAimX as number;
    side.drawAimZ = draw.drawAimZ as number;
    const seats = snap.sides[team].humans;
    side.humans.length = seats.length;
    seats.forEach((row, k) => {
      const values = byKey(HUMAN, row);
      const human = (side.humans[k] ??= createHuman(values.controlled as number));
      human.controlled = values.controlled as number;
      human.autoSkate = values.autoSkate as boolean;
      human.shotCharge = values.shotCharge as number;
      human.shotAim = values.shotAim as number;
      human.shotLift = values.shotLift as number;
      human.passHeld = values.passHeld as boolean;
      human.passAim = { x: values.passAimX as number, z: values.passAimZ as number };
      human.passTarget = (values.passTarget as number) < 0 ? null : (values.passTarget as number);
      human.passRange = values.passRange as number;
    });
  }
  const puck = byKey(PUCK_FIELDS, snap.puck);
  s.puck.x = puck.x as number;
  s.puck.z = puck.z as number;
  s.puck.y = puck.y as number;
  s.puck.vx = puck.vx as number;
  s.puck.vz = puck.vz as number;
  s.puck.vy = puck.vy as number;
  s.puck.owner = (puck.owner as number) < 0 ? null : (puck.owner as number);
  s.puck.lastTouch = (puck.lastTouch as number) < 0 ? null : (puck.lastTouch as Team);
  s.puck.lockout = puck.lockout as number;
  s.puck.shot = puck.shot as boolean;
  s.puck.passTo = (puck.passTo as number) < 0 ? null : (puck.passTo as number);
  s.skaters.forEach((p, i) => poseSkater(p, snap, i));
  s.events = snap.events;
}

/** Pose one skater on what a snapshot says about the roster slot `i`. False if it has no row. */
export function poseSkater(p: Skater, snap: Snapshot, i: number): boolean {
  const raw = snap.skaters[i];
  if (!raw) return false;
  const values = byKey(SKATER, raw);
  for (const field of SKATER) {
    if (field.key.startsWith('pending')) continue;
    (p as unknown as Record<string, unknown>)[field.key] = values[field.key];
  }
  p.pendingShot = values.pendingShot
    ? {
        timer: values.pendingTimer as number,
        load: values.pendingLoad as number,
        power: values.pendingPower as number,
        aim: values.pendingAim as number,
        height: values.pendingHeight as number,
        tick: values.pendingTick as number,
      }
    : null;
  // A buffered check is the host's own business; it never reaches the blade on a watcher.
  p.queuedCheck = null;
  return true;
}

/** Pose a match straight onto what is in the buffer. */
export function applySnapshot(s: MatchState, buffer: ArrayBuffer) {
  poseSnapshot(s, decodeSnapshot(buffer));
}
