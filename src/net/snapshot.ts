import { TEAMS } from '../game/types';
import { Cursor, metres, sizeOf, timer, unit, type Field } from './wire';
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
  { key: 'stamina', kind: 'u8', scale: 255 },
  timer('cooldown'),
  timer('checkTimer'),
  // Stride winds on without resetting, so it keeps full precision.
  { key: 'stride', kind: 'f32' },
  unit('skateDrive'),
  unit('edgeLean'),
  timer('downTimer'),
  timer('stumbleTimer'),
  unit('rush'),
  { key: 'hitLock', kind: 'i16', scale: 1 },
  { key: 'checkPower', kind: 'u8', scale: 255 },
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
  { key: 'y', kind: 'i16', scale: 1000 },
  metres('vx'),
  metres('vz'),
  metres('vy'),
  { key: 'owner', kind: 'i16', scale: 1 },
  { key: 'lastTouch', kind: 'i16', scale: 1 },
  timer('lockout'),
  { key: 'shot', kind: 'bool' },
  { key: 'passTo', kind: 'i16', scale: 1 },
];

const SIDE: readonly Field[] = [
  { key: 'human', kind: 'bool' },
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
  unit('drawInput'),
];

const MATCH: readonly Field[] = [
  { key: 'phase', kind: 'enum', values: PHASES },
  { key: 'period', kind: 'u8', scale: 1 },
  { key: 'clock', kind: 'f32' },
  { key: 'countdown', kind: 'f32' },
  { key: 'scoreHome', kind: 'u8', scale: 1 },
  { key: 'scoreAway', kind: 'u8', scale: 1 },
  { key: 'shotsHome', kind: 'u8', scale: 1 },
  { key: 'shotsAway', kind: 'u8', scale: 1 },
  { key: 'hitsHome', kind: 'u8', scale: 1 },
  { key: 'hitsAway', kind: 'u8', scale: 1 },
  { key: 'scoringTeam', kind: 'i16', scale: 1 },
  { key: 'tick', kind: 'f32' },
  timer('hitstop'),
  { key: 'noticeTimer', kind: 'u16', scale: 1000 },
  { key: 'noticeTeam', kind: 'i16', scale: 1 },
  { key: 'shootoutShooter', kind: 'u8', scale: 1 },
  { key: 'shootoutRound', kind: 'u8', scale: 1 },
  { key: 'shootoutTaken0', kind: 'u8', scale: 1 },
  { key: 'shootoutTaken1', kind: 'u8', scale: 1 },
  { key: 'possessionHome', kind: 'f32' },
  { key: 'possessionAway', kind: 'f32' },
];

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
  sizeOf(SIDE) * 2 +
  sizeOf(PUCK_FIELDS) +
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

/**
 * `sinceEvent` is the last call the other end already heard, so each one crosses exactly once.
 * Pass -1 to send everything the match still remembers.
 */
export function encodeSnapshot(s: MatchState, sinceEvent = -1): ArrayBuffer {
  const buffer = new ArrayBuffer(SNAPSHOT_BYTES);
  const at = new Cursor(new DataView(buffer));
  const match: Record<string, unknown> = {
    ...s,
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
    const values: Record<string, unknown> = {
      ...side,
      passAimX: side.passAim.x,
      passAimZ: side.passAim.z,
      passTarget: side.passTarget ?? -1,
    };
    for (const field of SIDE) at.write(field, values[field.key]);
  }
  const puck: Record<string, unknown> = {
    ...s.puck,
    owner: s.puck.owner ?? -1,
    lastTouch: s.puck.lastTouch ?? -1,
    passTo: s.puck.passTo ?? -1,
  };
  for (const field of PUCK_FIELDS) at.write(field, puck[field.key]);
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
 * Pose an existing match onto a snapshot, in place. The object identity is kept deliberately:
 * the scene treats a new match object as a cut, and the replay recorder clears its buffer on one.
 */
export function applySnapshot(s: MatchState, buffer: ArrayBuffer) {
  const at = new Cursor(new DataView(buffer));
  const match: Record<string, unknown> = {};
  for (const field of MATCH) match[field.key] = at.read(field);
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
    const values: Record<string, unknown> = {};
    for (const field of SIDE) values[field.key] = at.read(field);
    const side = s.sides[team];
    side.human = values.human as boolean;
    side.controlled = values.controlled as number;
    side.autoSkate = values.autoSkate as boolean;
    side.shotCharge = values.shotCharge as number;
    side.shotAim = values.shotAim as number;
    side.shotLift = values.shotLift as number;
    side.passHeld = values.passHeld as boolean;
    side.passAim = { x: values.passAimX as number, z: values.passAimZ as number };
    side.passTarget = (values.passTarget as number) < 0 ? null : (values.passTarget as number);
    side.passRange = values.passRange as number;
    side.drawInput = values.drawInput as number;
  }
  const puck: Record<string, unknown> = {};
  for (const field of PUCK_FIELDS) puck[field.key] = at.read(field);
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
  for (const p of s.skaters) {
    const values: Record<string, unknown> = {};
    for (const field of SKATER) values[field.key] = at.read(field);
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
  }
  const count = at.read({ key: 'count', kind: 'u8', scale: 1 }) as number;
  s.events = [];
  for (let i = 0; i < count; i++) {
    const values: Record<string, unknown> = {};
    for (const field of EVENT) values[field.key] = at.read(field);
    s.events.push({
      id: values.id as number,
      type: values.type as GameEvent['type'],
      power: values.power as number,
      ...(values.placed ? { x: values.x as number, z: values.z as number } : {}),
      ...(values.barDown ? { barDown: true } : {}),
    });
  }
}
