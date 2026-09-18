import {
  attackDirection,
  EMPTY_INPUT,
  GET_UP,
  GOALIE,
  GOALIE_STICK,
  IRON,
  PHYSICS,
  PUCK,
  RINK,
  RULES,
  SHOT,
  STICK,
} from './config';
import { activeDeke, classifyOneTouch, clearDeke, startDeke, stepDeke } from './dekes';
import {
  canStartCelly,
  cellyDuration,
  cellyRagdoll,
  clearCelly,
  startCelly,
  stepCelly,
} from './cellys';
import { decideAI, pokeShielded } from './ai';
import { DEFAULT_MATCHUP, type Club } from './clubs';
import { cpuTune, DEFAULT_DIFFICULTY } from './difficulty';
import { backcheckLaunchCap, backcheckScales, isBreakawayRush, skateVelocity } from './skating';
import {
  applySave,
  canCover,
  canRecommit,
  committed,
  commitSave,
  goalieFacing,
  manualSave,
  recordContact,
  savePush,
  stepGoalieRead,
  sweepGoalie,
  trackSaveSide,
  type SaveContact,
} from './goalie';
import { SHOT_DOWNSWING } from './actionTiming';
import { clamp, constrainToRink, distance, hash01, normalized } from './math';
import { createHuman, humanOn, MAX_HUMANS } from './humans';
import { clockRate, freeSkateTeam, isOnIce, modeInfo, SHOOTOUT_ROUNDS } from './modes';
import type {
  DekeSpecial,
  GameEvent,
  GameMode,
  Human,
  InputFrame,
  MatchState,
  Jersey,
  Phase,
  Puck,
  Skater,
  SideInputs,
  SideState,
  Team,
  Vec2,
} from './types';
import { TEAMS } from './types';
export { isOnIce } from './modes';
const ROLES = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const;
/** A side's starting state: one person per seat, all of them to be placed at the first drop. */
function createSide(team: Team, seats: number): SideState {
  return {
    humans: Array.from({ length: Math.min(seats, MAX_HUMANS) }, () => createHuman(team * 6)),
    drawInput: -1,
  };
}
/** What a person's stick carries between whistles: nothing. */
function resetHuman(human: Human) {
  human.autoSkate = false;
  human.shotCharge = 0;
  human.shotAim = 0;
  human.shotLift = 0;
  clearPassAim(human);
}
/**
 * Put a side's people on its skaters: the seat `lead` on `first`, and everybody after them, in
 * seat order, on the rest of the roster: skaters on the ice first, then the goalie, then anyone
 * off the ice. With one person that is just them on `first`; with two in a 1-on-1 the second is
 * in goal; and a seat that has no skater on the ice this time (a shootout attempt) is parked on
 * one that is not, so no two people ever hold the same skater.
 */
function seatHumans(s: MatchState, team: Team, first: Skater, lead = 0) {
  const humans = s.sides[team].humans;
  if (!humans.length) return;
  const rank = (p: Skater) => (isOnIce(s, p) ? 0 : 2) + (p.role === 'G' ? 1 : 0);
  const rest = s.skaters
    .filter((p) => p.team === team && p.id !== first.id)
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  humans.forEach((human, i) => {
    const seat = humans[(lead + i) % humans.length];
    seat.controlled = i === 0 ? first.id : rest[i - 1].id;
    resetHuman(human);
  });
}
/** True when somebody is holding this skater. */
const isControlled = (s: MatchState, p: Skater) => humanOn(s, p) !== undefined;
/**
 * The puck has come to `p`, so somebody on that side should be holding them. Nobody moves if a
 * person already is. Otherwise it is `from` — the person who threw the pass that got it there —
 * or, for a puck nobody on the side sent (a loose puck, a draw, a goalie's freeze), whoever is
 * nearest, with seat order settling a tie. Returns the person now on `p`, if the side has any.
 */
function handOver(s: MatchState, p: Skater, from?: Human) {
  const humans = s.sides[p.team].humans;
  const holding = humans.find((h) => h.controlled === p.id);
  if (holding || !humans.length) return holding;
  const reach = (h: Human) => distance(s.skaters[h.controlled], p);
  const taker =
    from && humans.includes(from)
      ? from
      : humans.reduce((best, h) => (reach(h) < reach(best) ? h : best));
  taker.controlled = p.id;
  return taker;
}
/**
 * Hand this skater to the first person on their side, seating one if nobody is there. Whoever
 * was already on that skater swaps onto the first person's old one, so nobody is holding twice.
 */
export function driveSkater(s: MatchState, id: number) {
  const p = s.skaters[id];
  const humans = s.sides[p.team].humans;
  if (!humans.length) {
    humans.push(createHuman(id));
    return;
  }
  const holding = humans.find((h) => h.controlled === id);
  if (holding) holding.controlled = humans[0].controlled;
  humans[0].controlled = id;
}
/**
 * What one person on a side is doing this step. The seat alone decides whether they are on the
 * ice; the frame only carries their intent, and a missing one holds still.
 */
const frameFor = (t: Team, seat: number, frames: SideInputs) => frames[t][seat] ?? EMPTY_INPUT;
/**
 * `humans` is the side each person is playing, one entry per person, in seat order. One team is
 * the usual game against the CPU; `[0, 1]` is two people against each other, and `[0, 0]` two
 * people on the same bench against the CPU.
 */
export function createMatch(
  humans: Team | Team[] = 0,
  mode: GameMode = 'exhibition',
  teams: [Club, Club] = DEFAULT_MATCHUP,
  jerseys: [Jersey, Jersey] = ['home', 'away'],
): MatchState {
  const played = Array.isArray(humans) ? humans : [humans];
  const s: MatchState = {
    mode,
    phase: 'menu',
    previousPhase: 'playing',
    period: 1,
    clock: modeInfo(mode).periodSeconds,
    countdown: 0,
    score: [0, 0],
    shots: [0, 0],
    hits: [0, 0],
    skaters: [],
    puck: {
      x: 0,
      z: 0,
      y: PUCK.restY,
      vx: 0,
      vz: 0,
      vy: 0,
      owner: null,
      lastTouch: null,
      lockout: 0,
      shot: false,
      passTo: null,
    },
    sides: [
      createSide(0, played.filter((t) => t === 0).length),
      createSide(1, played.filter((t) => t === 1).length),
    ],
    teams,
    jerseys,
    difficulty: DEFAULT_DIFFICULTY,
    scoringTeam: null,
    tick: 0,
    hitstop: 0,
    barTick: -1,
    events: [],
    notice: '',
    noticeTimer: 0,
    noticeTeam: null,
    possession: [0, 0],
    shootoutShooter: played[0] ?? 0,
    shootoutRound: 1,
    shootoutTaken: [0, 0],
  };
  for (let t = 0; t < 2; t++)
    for (let i = 0; i < 6; i++)
      s.skaters.push({
        id: t * 6 + i,
        team: t as Team,
        role: ROLES[i],
        number: teams[t].lineup[i].number,
        name: teams[t].lineup[i].name,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        angle: 0,
        stamina: 1,
        cooldown: 0,
        checkTimer: 0,
        stride: i,
        skateDrive: 0,
        edgeLean: 0,
        downTimer: 0,
        stumbleTimer: 0,
        rush: 0,
        hitLock: -1,
        checkPower: 0,
        checkLanded: false,
        queuedCheck: null,
        hitImmunity: 0,
        fallAngle: 0,
        stickSide: ROLES[i] === 'G' ? GOALIE_STICK.side : STICK.restSide,
        stickReach: ROLES[i] === 'G' ? GOALIE_STICK.reach : STICK.restReach,
        stickSideVel: 0,
        stickReachVel: 0,
        shotTimer: 0,
        pendingShot: null,
        saveTimer: 0,
        saveKind: null,
        saveSide: 0,
        saveHeight: 0,
        readTimer: 0,
        coverTimer: 0,
        shotStyle: 'wrist',
        shotDuration: 0.34,
        shotSide: STICK.restSide,
        shotReach: STICK.restReach,
        passTimer: 0,
        diveTimer: 0,
        blockTimer: 0,
        liftTimer: 0,
        dekeKind: null,
        dekeTimer: 0,
        dekeDir: 0,
        cellyKind: null,
        cellyTimer: 0,
      });
  resetFormation(s);
  return s;
}
export function resetFormation(s: MatchState) {
  const positions = [
    [-1.6, 0],
    [-3, -7],
    [-3, 7],
    [-11, -5],
    [-11, 5],
    [-25, 0],
  ];
  for (const p of s.skaters) {
    const dir = attackDirection(p.team, s.period),
      pos = positions[p.id % 6];
    p.x = pos[0] * dir;
    p.z = pos[1] * dir;
    p.vx = 0;
    p.vz = 0;
    p.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.cooldown = 0;
    p.checkTimer = 0;
    p.skateDrive = 0;
    p.edgeLean = 0;
    p.downTimer = 0;
    p.stumbleTimer = 0;
    p.rush = 0;
    p.hitLock = -1;
    p.checkPower = 0;
    p.checkLanded = false;
    p.queuedCheck = null;
    p.hitImmunity = 0;
    p.stickSide = p.role === 'G' ? GOALIE_STICK.side : STICK.restSide;
    p.stickReach = p.role === 'G' ? GOALIE_STICK.reach : STICK.restReach;
    p.stickSideVel = 0;
    p.stickReachVel = 0;
    p.shotTimer = 0;
    p.pendingShot = null;
    p.shotLoad = 0;
    p.saveTimer = 0;
    p.saveKind = null;
    p.readTimer = 0;
    p.coverTimer = 0;
    p.passTimer = 0;
    p.diveTimer = 0;
    p.blockTimer = 0;
    p.liftTimer = 0;
    clearDeke(p);
    clearCelly(p);
  }
  Object.assign(s.puck, {
    x: 0,
    z: 0,
    y: PUCK.restY,
    vx: 0,
    vz: 0,
    vy: 0,
    owner: null,
    lockout: 0,
    shot: false,
    passTo: null,
  });
  for (const t of TEAMS) seatHumans(s, t, s.skaters[t * 6]);
  s.hitstop = 0;
  for (const p of s.skaters) {
    if (isOnIce(s, p)) continue;
    p.x = 0;
    p.z = 40 + p.id;
  }
  if (s.mode === 'freeSkate') {
    // Practice is one skater's rink: the first human side takes the puck at centre ice.
    const team = freeSkateTeam(s);
    const you = s.skaters[s.sides[team].humans[0]?.controlled ?? team * 6];
    you.x = 0;
    you.z = 0;
    givePuck(s, you);
  }
  if (s.mode === 'shootout') setupShootoutAttempt(s);
}
export function emit(
  s: MatchState,
  type: GameEvent['type'],
  power = 1,
  detail?: { x?: number; z?: number; barDown?: boolean },
) {
  s.events.push({
    id: (s.events.at(-1)?.id ?? 0) + 1,
    type,
    power,
    x: detail?.x,
    z: detail?.z,
    ...(detail?.barDown && { barDown: true }),
  });
  if (s.events.length > 32) s.events.shift();
}
export function startMatch(s: MatchState) {
  if (!modeInfo(s.mode).faceoff) {
    s.phase = 'playing';
    s.countdown = 0;
    clearDraw(s);
    return;
  }
  s.phase = 'faceoff';
  s.countdown = RULES.faceoffSeconds;
  clearDraw(s);
}
/** Nobody has swung at the next drop yet. */
function clearDraw(s: MatchState) {
  s.sides[0].drawInput = -1;
  s.sides[1].drawInput = -1;
}
function givePuck(s: MatchState, p: Skater) {
  s.puck.owner = p.id;
  s.puck.lastTouch = p.team;
  s.puck.shot = false;
  s.puck.passTo = null;
  s.puck.lockout = 0;
  const tip = stickTip(p);
  s.puck.x = tip.x;
  s.puck.z = tip.z;
  s.puck.y = PUCK.restY;
  s.puck.vx = p.vx;
  s.puck.vz = p.vz;
  s.puck.vy = 0;
}
function setupShootoutAttempt(s: MatchState) {
  const shooter = s.skaters.find((p) => p.team === s.shootoutShooter && p.role === 'C');
  if (!shooter) return;
  const dir = attackDirection(shooter.team, s.period);
  shooter.x = -7.5 * dir;
  shooter.z = 0;
  shooter.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  givePuck(s, shooter);
  // Each side takes the only skater it has on the ice: the shooter, or the goalie facing them.
  // Two people on one bench take turns, shooting and keeping alike, one attempt each.
  const attempt = s.shootoutTaken[s.shootoutShooter];
  for (const t of TEAMS) {
    const keeper = s.skaters.find((p) => p.team === t && p.role === 'G');
    seatHumans(s, t, t === s.shootoutShooter ? shooter : (keeper ?? s.skaters[t * 6]), attempt);
  }
  notice(s, 'SHOT', s.shootoutShooter);
}
function missShootout(s: MatchState, reason: string) {
  if (s.mode !== 'shootout' || s.phase !== 'playing') return;
  s.scoringTeam = null;
  s.phase = 'goal';
  s.countdown = 1.7;
  notice(s, reason);
}
function concludeShootoutAttempt(s: MatchState) {
  s.shootoutTaken[s.shootoutShooter]++;
  const [takenHome, takenAway] = s.shootoutTaken;
  if (takenHome === takenAway && takenHome >= SHOOTOUT_ROUNDS && s.score[0] !== s.score[1]) {
    s.phase = 'final';
    emit(s, 'horn');
    return;
  }
  s.shootoutShooter = (1 - s.shootoutShooter) as Team;
  // A round is one attempt each, so it turns over once the trailing side has caught up.
  s.shootoutRound = Math.min(s.shootoutTaken[0], s.shootoutTaken[1]) + 1;
  s.clock = modeInfo('shootout').periodSeconds;
  resetFormation(s);
  startMatch(s);
}
function shootoutAttemptOver(s: MatchState) {
  if (s.mode !== 'shootout' || s.phase !== 'playing') return false;
  const dir = attackDirection(s.shootoutShooter, s.period);
  if (s.puck.owner === null && s.puck.x * dir > RINK.goalX + 0.35) {
    missShootout(s, 'WIDE');
    return true;
  }
  const shooter = s.skaters.find((p) => p.team === s.shootoutShooter && p.role === 'C');
  if (shooter && shooter.x * dir > RINK.goalX) {
    missShootout(s, 'NO GOAL');
    return true;
  }
  return false;
}
export function togglePause(s: MatchState) {
  if (s.phase === 'paused') s.phase = s.previousPhase;
  else if (['playing', 'faceoff', 'goal'].includes(s.phase)) {
    s.previousPhase = s.phase;
    s.phase = 'paused';
  }
}
export function nextPeriod(s: MatchState) {
  if (s.phase !== 'intermission') return;
  s.period++;
  s.clock = modeInfo(s.mode).periodSeconds;
  resetFormation(s);
  startMatch(s);
}
/**
 * A line across the ice. `team` marks who it happened to, so a client showing one side can say
 * "DRAW WON" where the other says "DRAW LOST" without the simulation taking a point of view.
 */
function notice(s: MatchState, value: string, team: Team | null = null) {
  s.notice = value;
  s.noticeTimer = 1.5;
  s.noticeTeam = team;
}
export function stickTip(p: Skater) {
  const fx = Math.sin(p.angle),
    fz = Math.cos(p.angle);
  return {
    x: p.x + fx * p.stickReach + fz * p.stickSide,
    z: p.z + fz * p.stickReach - fx * p.stickSide,
  };
}
/** Where a left-stick shot is aimed on the attacking net. */
export function netShotTarget(s: MatchState, p: Skater, aim: number, height: number) {
  return {
    x: attackDirection(p.team, s.period) * RINK.goalX,
    y: 0.14 + clamp(height, 0, 1) * (SHOT.topShelf - 0.14),
    z: clamp(aim, -1, 1) * SHOT.corner,
  };
}
/**
 * Radius of the aim circle on the net, in metres. A set forehand is tight; skating across the
 * shot, a backhand, shooting across the body or a hard wind-up opens it up.
 */
export function shotSpread(
  s: MatchState,
  p: Skater,
  power: number,
  target = netShotTarget(s, p, humanOn(s, p)?.shotAim ?? 0, humanOn(s, p)?.shotLift ?? 0),
) {
  const tip = stickTip(p),
    range = Math.hypot(target.x - tip.x, target.z - tip.z),
    line = normalized(target.x - tip.x, target.z - tip.z);
  const across = Math.abs(p.vx * line.z - p.vz * line.x),
    facing = 1 - (Math.sin(p.angle) * line.x + Math.cos(p.angle) * line.z);
  const angle =
    SHOT.spread +
    across * SHOT.spreadLateral +
    (p.stickSide < 0 ? SHOT.spreadBackhand : 0) +
    clamp(power, 0, 1) * SHOT.spreadPower +
    clamp(facing, 0, 1) * SHOT.spreadFacing;
  return angle * range;
}
const REST_ANGLE = Math.atan2(STICK.restSide - STICK.pivotSide, STICK.restReach - STICK.pivotReach);
function fromPivot(angle: number, radius: number) {
  return {
    side: STICK.pivotSide + Math.sin(angle) * radius,
    reach: STICK.pivotReach + Math.cos(angle) * radius,
  };
}
/**
 * Skill-stick pose around the lower hand. +stickX is the player's right, so the blade
 * goes with the input instead of mirroring it. A toe-drag pull sweeps that same side back.
 */
export function stickCarryTarget(stickX: number, pull: number) {
  const lateral = Math.abs(stickX) > 0.08 ? clamp(stickX, -1, 1) : 0;
  const left = 0.88,
    right = -0.88;
  const angle0 =
    lateral >= 0
      ? REST_ANGLE + (right - REST_ANGLE) * lateral
      : REST_ANGLE + (left - REST_ANGLE) * -lateral;
  const drag = clamp(pull, 0, 1);
  const angle = angle0 + (angle0 >= 0 ? 1 : -1) * drag * 1.22;
  const hold = (STICK.restReach - STICK.pivotReach) / Math.max(0.42, Math.cos(angle0));
  const radius = Math.max(0.38, hold - drag * (hold - 0.55));
  return fromPivot(angle, radius);
}
function spring(
  current: number,
  vel: number,
  target: number,
  dt: number,
  omega = STICK.omega,
  zeta = STICK.zeta,
) {
  const accel = omega * omega * (target - current) - 2 * zeta * omega * vel;
  const nextVel = vel + accel * dt;
  return { value: current + nextVel * dt, vel: nextVel };
}
function advanceStick(p: Skater, stickX: number, pull: number, dt: number, carrying: boolean) {
  const pose = activeDeke(p);
  // The paddle stays down in front of the skates; the puck rides on it when the goalie has it.
  const target = pose ?? (p.role === 'G' ? GOALIE_STICK : stickCarryTarget(stickX, pull));
  const omega = pose ? STICK.omega * 1.55 : STICK.omega,
    zeta = pose ? 0.86 : STICK.zeta;
  const side = spring(p.stickSide, p.stickSideVel, target.side, dt, omega, zeta);
  const reach = spring(p.stickReach, p.stickReachVel, target.reach, dt, omega, zeta);
  p.stickSide = side.value;
  p.stickSideVel = side.vel;
  p.stickReach = reach.value;
  p.stickReachVel = reach.vel;
  if (!carrying || p.role === 'G') return;
  const leftX = Math.cos(p.angle),
    leftZ = -Math.sin(p.angle);
  if (pose) return;
  // A deke should carry the skater a little with the puck, like an edge cut, not a dash.
  const skating = Math.hypot(p.vx, p.vz) > 1.5;
  const push =
    p.stickSideVel * STICK.cut + (skating ? (p.stickSide - STICK.restSide) * STICK.drift : 0);
  p.vx += leftX * push * dt;
  p.vz += leftZ * push * dt;
}
function dekeDirFromInput(p: Skater, input: InputFrame) {
  const moving = Math.hypot(input.moveX, input.moveZ) > 0.22;
  if (moving) return classifyOneTouch(p.angle, input.moveX, input.moveZ).dir || 1;
  if (Math.abs(input.stickX) > 0.2) return input.stickX > 0 ? 1 : -1;
  return p.stickSide <= STICK.restSide ? 1 : -1;
}
function tryStartDeke(p: Skater, input: InputFrame) {
  if (input.dekeSpecial) {
    const dir = dekeDirFromInput(p, input);
    const special: DekeSpecial = input.dekeSpecial;
    switch (special) {
      case 'jump':
        startDeke(p, 'jump', dir);
        break;
      case 'throughLegs':
        startDeke(p, 'throughLegs', dir);
        break;
      case 'windmill':
        startDeke(p, 'windmill', Math.abs(input.stickX) > 0.2 ? (input.stickX > 0 ? 1 : -1) : dir);
        break;
      case 'spin':
        startDeke(p, 'spin', dir);
        break;
      default: {
        const _never: never = special;
        return _never;
      }
    }
    return;
  }
  if (!input.deke) return;
  const touch = classifyOneTouch(p.angle, input.moveX, input.moveZ);
  startDeke(p, touch.kind, touch.dir);
}
function puckReach(player: Skater, puck: { x: number; z: number }) {
  return Math.min(distance(stickTip(player), puck), distance(player, puck) + 0.12);
}
/**
 * How good a side's strike at the draw was, lower being better: on time, then not swinging at
 * all, then jumping it. Ties inside a tier go to whoever struck closest to the drop.
 */
function drawTier(drawInput: number) {
  if (drawInput < 0) return 1;
  return drawInput <= 0.42 ? 0 : 2;
}
/**
 * Who takes the draw. Timing the drop beats not swinging, which beats jumping it; inside a tier
 * the stick that arrived closest to the puck wins. Two sides that did the same thing — most often
 * two CPUs, neither of which swings — fall back to the coin flip this has always been.
 */
export function drawWinner(s: MatchState): Team {
  const [home, away] = [s.sides[0].drawInput, s.sides[1].drawInput];
  const tiers = [drawTier(home), drawTier(away)];
  if (tiers[0] !== tiers[1]) return tiers[0] < tiers[1] ? 0 : 1;
  if (home !== away) return home < away ? 0 : 1;
  return Math.sin(s.tick * 12.989) > 0 ? 0 : 1;
}
function resolveFaceoff(s: MatchState) {
  const won = drawWinner(s);
  const winner = s.skaters[won * 6],
    loser = s.skaters[(1 - won) * 6];
  s.puck.owner = winner.id;
  s.puck.lastTouch = winner.team;
  s.puck.shot = false;
  s.puck.passTo = null;
  s.puck.lockout = 0;
  const tip = stickTip(winner);
  s.puck.x = tip.x;
  s.puck.z = tip.z;
  s.puck.vx = winner.vx;
  s.puck.vz = winner.vz;
  handOver(s, winner);
  winner.cooldown = 0.1;
  loser.cooldown = 0.32;
  s.sides[0].drawInput = -1;
  s.sides[1].drawInput = -1;
  notice(s, 'DRAW', winner.team);
}
/** Lower is better: sit in the lane between the puck and our net, not chasing from behind. */
function switchCost(p: Skater, from: { x: number; z: number }, netX: number) {
  const dx = p.x - from.x,
    dz = p.z - from.z,
    dist = Math.hypot(dx, dz);
  const lane = normalized(netX - from.x, -from.z);
  const along = dx * lane.x + dz * lane.z,
    across = dx * lane.z - dz * lane.x;
  return (
    dist - clamp(along, 0, 10) * 0.85 + (along < 0 ? -along * 1.5 : 0) + Math.abs(across) * 0.4
  );
}
/**
 * Move one person to another skater on their side. Nobody is ever switched onto a skater somebody
 * else is holding: a carrier a teammate has is left to them, and so is anyone they are on. When
 * two people switch on the same step the first seat picks first and the second picks from what is
 * left, because the sides are read in seat order.
 */
export function switchSkater(s: MatchState, team: Team, human: Human) {
  const humans = s.sides[team].humans;
  const held = (p: Skater) => humans.some((h) => h.controlled === p.id);
  const owner = s.puck.owner !== null ? s.skaters[s.puck.owner] : null;
  // A goalie holding the puck can be left to play it while you take a skater.
  if (owner && owner.team === team && owner.role !== 'G' && !held(owner)) {
    human.controlled = owner.id;
    human.autoSkate = false;
    return;
  }
  const options = s.skaters.filter(
    (p) => isOnIce(s, p) && p.team === team && p.role !== 'G' && p.downTimer <= 0 && !held(p),
  );
  if (!options.length) return;
  const from = owner ?? s.puck;
  const netX = -attackDirection(team, s.period) * RINK.goalX;
  human.controlled = options.reduce((best, p) =>
    switchCost(p, from, netX) < switchCost(best, from, netX) ? p : best,
  ).id;
  human.autoSkate = true;
}
/** Keep stride toward the body. A full reverse would plant a hockey stop and kill the hit. */
function autoSkateMove(s: MatchState, p: Skater): Vec2 {
  const owner = s.puck.owner !== null ? s.skaters[s.puck.owner] : null;
  const mark = owner ?? s.puck;
  const toward = normalized(mark.x + mark.vx * 0.14 - p.x, mark.z + mark.vz * 0.14 - p.z);
  const speed = Math.hypot(p.vx, p.vz);
  const travelDir =
    speed > 0.2
      ? { x: p.vx / speed, z: p.vz / speed }
      : { x: Math.sin(p.angle), z: Math.cos(p.angle) };
  if (toward.x === 0 && toward.z === 0) return travelDir;
  if (speed < 1.4) return toward;
  const travel = Math.atan2(travelDir.x, travelDir.z);
  const want = Math.atan2(toward.x, toward.z);
  const error = Math.atan2(Math.sin(want - travel), Math.cos(want - travel));
  const turn = clamp(error, -1.15, 1.15);
  return { x: Math.sin(travel + turn), z: Math.cos(travel + turn) };
}
function controlledSkate(s: MatchState, p: Skater, input: InputFrame, human: Human) {
  const stick = Math.hypot(input.moveX, input.moveZ);
  if (s.puck.owner === p.id || stick > 0.18 || input.backskate) human.autoSkate = false;
  if (!human.autoSkate)
    return {
      x: input.moveX,
      z: input.moveZ,
      hustle: input.hustle,
      backskate: input.backskate,
      push: 1,
    };
  const move = autoSkateMove(s, p);
  return {
    x: move.x,
    z: move.z,
    hustle: p.stamina > 0.08,
    backskate: false,
    push: PHYSICS.autoSkatePush,
  };
}
function releasePuck(
  s: MatchState,
  p: Skater,
  dx: number,
  dz: number,
  speed: number,
  lift: number,
  shot: boolean,
  origin?: { x: number; z: number; y?: number },
) {
  const v = normalized(dx, dz),
    puck = s.puck;
  puck.owner = null;
  puck.x = origin?.x ?? p.x + v.x * 1.15;
  puck.z = origin?.z ?? p.z + v.z * 1.15;
  puck.vx = v.x * speed + p.vx * PHYSICS.puckCarry;
  puck.vz = v.z * speed + p.vz * PHYSICS.puckCarry;
  puck.y = origin?.y ?? 0.15;
  puck.vy = lift;
  puck.lockout = 0.16;
  puck.lastTouch = p.team;
  puck.shot = shot;
  puck.passTo = null;
  p.cooldown = 0.55;
}
/** Queue only an already loaded slap shot; taps, backhands and one-timers release immediately. */
export function requestShot(s: MatchState, p: Skater, power: number, aim = 0, height = 0.25) {
  if (
    s.puck.owner !== p.id ||
    p.downTimer > 0 ||
    p.stumbleTimer > 0 ||
    p.diveTimer > 0 ||
    p.pendingShot
  )
    return;
  const human = humanOn(s, p);
  const load = human?.shotCharge ?? 0;
  if (load > 0.2 && power > 0.55 && p.stickSide >= 0 && p.passTimer <= 0) {
    p.pendingShot = { timer: SHOT_DOWNSWING, load, power, aim, height, tick: s.tick };
    if (human) human.shotCharge = 0;
  } else shootPuck(s, p, power, aim, height);
}

export function advancePendingShot(s: MatchState, p: Skater, dt: number) {
  const shot = p.pendingShot;
  if (!shot) return;
  if (
    s.puck.owner !== p.id ||
    p.downTimer > 0 ||
    p.stumbleTimer > 0 ||
    p.diveTimer > 0 ||
    p.dekeKind
  ) {
    p.pendingShot = null;
    return;
  }
  if (shot.tick === s.tick) return;
  if (shot.timer <= dt + 1e-8) {
    p.pendingShot = null;
    shootPuck(s, p, shot.power, shot.aim, shot.height);
  } else p.pendingShot = { ...shot, timer: shot.timer - dt };
}

export function shootPuck(s: MatchState, p: Skater, power: number, aim = 0, height = 0.25) {
  if (s.puck.owner !== p.id || p.downTimer > 0 || p.stumbleTimer > 0) return;
  p.pendingShot = null;
  const oneTimer = p.passTimer > 0;
  power = clamp(power + (oneTimer ? 0.28 : 0), 0, 1);
  const tip = stickTip(p),
    backhand = p.stickSide < 0,
    aimed = netShotTarget(s, p, aim, height);
  const spread = shotSpread(s, p, power, aimed),
    miss = hash01(s.tick, p.id) * Math.PI * 2,
    missBy = spread * Math.sqrt(hash01(p.id, s.tick));
  const target = {
    x: aimed.x,
    y: Math.max(PUCK.restY, aimed.y + Math.sin(miss) * missBy),
    z: aimed.z + Math.cos(miss) * missBy,
  };
  const toward = normalized(target.x - tip.x, target.z - tip.z);
  const origin = {
    x: tip.x + toward.x * 0.32,
    z: tip.z + toward.z * 0.32,
    y: 0.15 + clamp(height, 0, 1) * 0.42,
  };
  const speed =
    PHYSICS.shotSpeed * (0.66 + power * 0.45) * (oneTimer ? 1.08 : 1) * (backhand ? 0.88 : 1);
  // The puck keeps some of the skater's glide. Aim off it so the shot goes where the marker says.
  const line = normalized(target.x - origin.x, target.z - origin.z),
    carryX = p.vx * PHYSICS.puckCarry,
    carryZ = p.vz * PHYSICS.puckCarry,
    along = carryX * line.x + carryZ * line.z,
    driftX = carryX - along * line.x,
    driftZ = carryZ - along * line.z,
    forward = Math.sqrt(Math.max(0, speed * speed - driftX * driftX - driftZ * driftZ));
  const range = Math.hypot(target.x - origin.x, target.z - origin.z),
    ground = Math.max(1, forward + along),
    drag = PHYSICS.puckDrag,
    slowed = 1 - (range * drag) / ground;
  // Drag slows the puck on the way, so it arrives later, and lower, than range / speed.
  const travel = Math.max(
    0.06,
    drag > 1e-4 && slowed > 0.05 ? -Math.log(slowed) / drag : range / ground,
  );
  const loft = Math.min(12, (target.y - origin.y + 4.9 * travel * travel) / travel);
  releasePuck(
    s,
    p,
    line.x * forward - driftX,
    line.z * forward - driftZ,
    speed,
    loft,
    true,
    origin,
  );
  p.shotTimer = oneTimer ? 0.3 : 0.6;
  p.shotDuration = p.shotTimer;
  p.shotStyle = backhand ? 'backhand' : power > 0.55 ? 'slap' : 'wrist';
  p.shotSide = p.stickSide;
  p.shotReach = p.stickReach;
  // The pose unwinds whatever windup was showing through the release rather than dropping it.
  const human = humanOn(s, p);
  p.shotLoad = human?.shotCharge ?? 0;
  p.passTimer = 0;
  s.shots[p.team]++;
  if (human) human.shotCharge = 0;
  emit(s, 'shot', power);
  notice(
    s,
    oneTimer ? 'ONE-TIMER' : backhand ? 'BACKHAND' : power > 0.55 ? 'SLAP SHOT' : 'WRIST SHOT',
  );
}
function passMates(s: MatchState, p: Skater) {
  return s.skaters.filter(
    (q) =>
      isOnIce(s, q) && q.team === p.team && q.id !== p.id && q.role !== 'G' && q.downTimer <= 0,
  );
}
/** Stick-aimed pass lane with a cone of aim-assist toward a teammate, else a dump. */
export function passLane(s: MatchState, p: Skater, mx: number, mz: number) {
  const stick = Math.hypot(mx, mz),
    speed = Math.hypot(p.vx, p.vz);
  let aim =
    stick > 0.18
      ? normalized(mx, mz)
      : speed > 0.8
        ? normalized(p.vx, p.vz)
        : { x: Math.sin(p.angle), z: Math.cos(p.angle) };
  if (Math.hypot(aim.x, aim.z) < 0.2) aim = { x: attackDirection(p.team, s.period), z: 0 };
  let target: Skater | null = null,
    best = -Infinity;
  for (const q of passMates(s, p)) {
    const dist = distance(p, q);
    if (dist < 1.15) continue;
    const to = normalized(q.x - p.x, q.z - p.z);
    const align = to.x * aim.x + to.z * aim.z;
    if (align < PHYSICS.passAssist) continue;
    const score = align - dist * 0.01;
    if (score > best) {
      best = score;
      target = q;
    }
  }
  let dx = aim.x * PHYSICS.passDump,
    dz = aim.z * PHYSICS.passDump;
  if (target) {
    const travel = distance(p, target) / PHYSICS.passSpeed;
    dx = target.x + target.vx * travel * 0.6 - p.x;
    dz = target.z + target.vz * travel * 0.6 - p.z;
    aim = normalized(dx, dz);
  }
  return { aim, target, dx, dz, range: Math.hypot(dx, dz) };
}
/** Distance to the nearest opponent standing in the pass lane, or null if the lane is clear. */
function passCover(s: MatchState, from: Skater, dx: number, dz: number) {
  const length = Math.hypot(dx, dz);
  if (length < 2) return null;
  let best: number | null = null;
  for (const q of s.skaters) {
    if (!isOnIce(s, q) || q.team === from.team || q.role === 'G' || q.downTimer > 0) continue;
    const ox = q.x - from.x,
      oz = q.z - from.z;
    const t = (ox * dx + oz * dz) / (length * length);
    if (t < 0.1 || t > 0.85) continue;
    const lat = Math.hypot(ox - t * dx, oz - t * dz);
    if (lat > 1.12) continue;
    const dist = t * length;
    if (best === null || dist < best) best = dist;
  }
  return best;
}
/** Lift that clears a body at `cover` without hanging higher than an explicit saucer. */
function hopPassLoft(cover: number) {
  const speed = PHYSICS.passSpeed * 0.92;
  const t = Math.max(0.1, cover / speed);
  return clamp((0.82 - 0.15 + 4.9 * t * t) / t, 2.6, PHYSICS.saucerLift);
}
/** Clear a person's pass arrow. */
function clearPassAim(human: Human) {
  human.passHeld = false;
  human.passAim = { x: 0, z: 0 };
  human.passTarget = null;
  human.passRange = 0;
}
function applyPassAim(s: MatchState, p: Skater, input: InputFrame, human: Human) {
  const aiming =
    s.puck.owner === p.id &&
    (input.passHeld || input.passRelease) &&
    p.downTimer <= 0 &&
    p.stumbleTimer <= 0;
  if (!aiming) {
    clearPassAim(human);
    return;
  }
  const lane = passLane(s, p, input.moveX, input.moveZ);
  human.passHeld = true;
  human.passAim = lane.aim;
  human.passTarget = lane.target?.id ?? null;
  human.passRange = lane.range;
}
export function passPuck(s: MatchState, p: Skater, mx: number, mz: number, loft = 0) {
  if (s.puck.owner !== p.id || p.downTimer > 0 || p.stumbleTimer > 0) return;
  const lane = passLane(s, p, mx, mz);
  p.shotTimer = p.shotDuration = 0.45;
  p.shotStyle = 'pass';
  p.shotSide = p.stickSide;
  p.shotReach = p.stickReach;
  p.shotLoad = 0;
  const cover = loft <= 0 && lane.target ? passCover(s, p, lane.dx, lane.dz) : null;
  const lift = loft > 0 ? loft : cover !== null ? hopPassLoft(cover) : 0;
  releasePuck(s, p, lane.dx, lane.dz, PHYSICS.passSpeed * (lift > 0 ? 0.92 : 1), lift, false);
  s.puck.passTo = lane.target?.id ?? null;
  // Whoever threw it follows the puck, unless the pass went to somebody a teammate is holding.
  const passer = humanOn(s, p);
  if (passer) clearPassAim(passer);
  if (lane.target) handOver(s, lane.target, passer);
  emit(s, 'pass', loft > 0 ? 0.42 : 0.35);
  notice(s, loft > 0 ? 'SAUCER' : 'PASS');
}
function actionAim(p: Skater, input: InputFrame, s: MatchState) {
  const ice = Math.hypot(input.stickIceX, input.stickIceZ);
  if (ice > 0.28) return normalized(input.stickIceX, input.stickIceZ);
  const stick = Math.hypot(input.stickX, input.stickY);
  if (stick > 0.28) {
    const dir = attackDirection(p.team, s.period);
    return normalized(-input.stickY * dir, input.stickX * dir);
  }
  const speed = Math.hypot(p.vx, p.vz);
  if (speed > 0.8) return normalized(p.vx, p.vz);
  if (Math.hypot(input.moveX, input.moveZ) > 0.18) return normalized(input.moveX, input.moveZ);
  return { x: Math.sin(p.angle), z: Math.cos(p.angle) };
}
export function chipPuck(s: MatchState, p: Skater, input: InputFrame) {
  if (s.puck.owner !== p.id || p.downTimer > 0 || p.stumbleTimer > 0) return;
  const aim = actionAim(p, input, s),
    dir = attackDirection(p.team, s.period),
    netX = dir * RINK.goalX;
  const dist = Math.hypot(netX - p.x, p.z);
  const onNet = dist < 9.5 && aim.x * dir > 0.4 && Math.abs(p.z) < 6.2;
  const tip = stickTip(p);
  releasePuck(
    s,
    p,
    aim.x,
    aim.z,
    PHYSICS.chipSpeed + Math.hypot(p.vx, p.vz) * 0.35,
    PHYSICS.chipLift,
    onNet,
    { x: tip.x + aim.x * 0.28, z: tip.z + aim.z * 0.28, y: 0.22 },
  );
  p.shotTimer = p.shotDuration = 0.3;
  p.shotStyle = 'wrist';
  p.shotSide = p.stickSide;
  p.shotReach = p.stickReach;
  p.shotLoad = 0;
  if (onNet) s.shots[p.team]++;
  emit(s, onNet ? 'shot' : 'pass', onNet ? 0.4 : 0.28);
  notice(s, onNet ? 'CHIP IN' : 'CHIP');
}
function chopPuck(s: MatchState, p: Skater, input: InputFrame) {
  if (s.puck.owner !== null || p.cooldown > 0 || p.downTimer > 0 || p.diveTimer > 0) return;
  if (puckReach(p, s.puck) > 1.45 || s.puck.y > 1.05) return;
  const aim = actionAim(p, input, s);
  s.puck.vx = aim.x * PHYSICS.chopSpeed + p.vx * 0.25;
  s.puck.vz = aim.z * PHYSICS.chopSpeed + p.vz * 0.25;
  s.puck.vy = 2.6;
  s.puck.y = Math.max(s.puck.y, 0.18);
  s.puck.shot = false;
  s.puck.lockout = 0.16;
  s.puck.lastTouch = p.team;
  s.puck.passTo = null;
  p.cooldown = 0.4;
  p.stickReach += PHYSICS.pokeExtend;
  emit(s, 'stick', 0.22);
  notice(s, 'CHOP');
}
function startDive(s: MatchState, p: Skater, input: InputFrame) {
  if (p.role === 'G' || p.cooldown > 0 || p.downTimer > 0 || p.diveTimer > 0 || p.stumbleTimer > 0)
    return;
  const aim = actionAim(p, input, s);
  const speed = Math.max(PHYSICS.diveSpeed, Math.hypot(p.vx, p.vz) + 2.8);
  p.vx = aim.x * speed;
  p.vz = aim.z * speed;
  p.angle = Math.atan2(aim.x, aim.z);
  p.fallAngle = p.angle;
  p.diveTimer = PHYSICS.diveTime;
  p.cooldown = PHYSICS.diveTime + GET_UP;
  p.stickReach += 0.5;
  p.stamina = clamp(p.stamina - 0.14, 0, 1);
  notice(s, 'DIVE');
}
/** After the flop hits the ice, go limp so the body stays a shot block until they get up. */
function landDive(p: Skater) {
  if (p.diveTimer <= 0 || p.downTimer > 0) return;
  const landAfter = Math.min(PHYSICS.diveLand, PHYSICS.diveTime * 0.55);
  if (PHYSICS.diveTime - p.diveTimer < landAfter) return;
  p.downTimer = p.diveTimer + GET_UP;
  p.fallAngle = p.angle;
  p.cooldown = Math.max(p.cooldown, p.downTimer);
}
/**
 * A committed body check: a short lunge in the aim direction with a live window in which contact
 * resolves as a hit. Pulling the stick back first loads a bigger lunge. Miss, and you are
 * overextended for a beat.
 */
export function launchCheck(s: MatchState, p: Skater, aimX: number, aimZ: number, load = 0) {
  if (
    p.role === 'G' ||
    p.cooldown > 0 ||
    p.downTimer > 0 ||
    p.diveTimer > 0 ||
    p.stumbleTimer > 0 ||
    s.puck.owner === p.id
  )
    return false;
  let aim = normalized(aimX, aimZ);
  if (Math.hypot(aim.x, aim.z) < 0.2) aim = { x: Math.sin(p.angle), z: Math.cos(p.angle) };
  load = clamp(load, 0, 1);
  let best: Skater | null = null,
    bestScore = -Infinity;
  for (const q of s.skaters) {
    if (q.id === p.id || q.team === p.team || !isOnIce(s, q) || q.downTimer > 0) continue;
    const dist = distance(p, q);
    if (dist > PHYSICS.hitLockRange) continue;
    const to = normalized(q.x - p.x, q.z - p.z);
    const dot = aim.x * to.x + aim.z * to.z;
    // Someone on your hip is a shoulder check, not a miss: lock them when they are
    // close enough to hit even if they sit outside the forward aim cone.
    const beside = dist < PHYSICS.playerRadius * 2 + 0.85 && dot > -0.12;
    if (dot < PHYSICS.hitLockCone && !beside) continue;
    const score =
      dot * 0.8 + (1 - dist / PHYSICS.hitLockRange) * 1.2 + (s.puck.owner === q.id ? 0.3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  p.hitLock = best ? best.id : -1;
  if (best) {
    const predicted = Math.atan2(
      best.x + best.vx * PHYSICS.hitLockLead - p.x,
      best.z + best.vz * PHYSICS.hitLockLead - p.z,
    );
    const angle = Math.atan2(aim.x, aim.z);
    const correction = Math.atan2(Math.sin(predicted - angle), Math.cos(predicted - angle));
    const assisted = angle + clamp(correction, -PHYSICS.checkAimAssist, PHYSICS.checkAimAssist);
    aim = { x: Math.sin(assisted), z: Math.cos(assisted) };
  }
  const speed = Math.hypot(p.vx, p.vz);
  // Aim assistance is resolved once, before commitment. Redirect only a little of existing
  // momentum: arriving on the right angle matters, and a late deke can make the shoulder miss.
  if (speed > 0.5) {
    const travel = Math.atan2(p.vx, p.vz),
      target = Math.atan2(aim.x, aim.z);
    const error = Math.atan2(Math.sin(target - travel), Math.cos(target - travel));
    const turn = clamp(error, -PHYSICS.checkAimAssist, PHYSICS.checkAimAssist);
    p.vx = Math.sin(travel + turn) * speed;
    p.vz = Math.cos(travel + turn) * speed;
  }
  const lunge = (PHYSICS.checkLunge + load * PHYSICS.checkLoadLunge) * (0.65 + p.stamina * 0.35);
  p.vx += aim.x * lunge;
  p.vz += aim.z * lunge;
  const launched = Math.hypot(p.vx, p.vz),
    cap = backcheckLaunchCap(s, p, PHYSICS.hustleSpeed + PHYSICS.checkLungeCap);
  if (launched > cap) {
    p.vx *= cap / launched;
    p.vz *= cap / launched;
  }
  p.angle = Math.atan2(p.vx, p.vz);
  p.checkTimer = PHYSICS.checkWindow;
  p.checkPower = load;
  p.checkLanded = false;
  p.cooldown = PHYSICS.checkWindow + 0.1;
  p.stamina = clamp(p.stamina - (PHYSICS.checkStamina + load * 0.04), 0, 1);
  return true;
}
function stickLift(s: MatchState, p: Skater) {
  if (p.role === 'G' || p.cooldown > 0 || p.downTimer > 0 || p.diveTimer > 0) return false;
  const owner = s.puck.owner !== null ? s.skaters[s.puck.owner] : null;
  if (!owner || owner.team === p.team || owner.role === 'G') return false;
  if (distance(p, owner) > PHYSICS.liftRange) return false;
  p.cooldown = 0.5;
  p.liftTimer = 0.32;
  owner.cooldown = Math.max(owner.cooldown, 0.35);
  owner.stumbleTimer = Math.max(owner.stumbleTimer, 0.28);
  s.puck.owner = p.id;
  s.puck.lastTouch = p.team;
  s.puck.shot = false;
  s.puck.passTo = null;
  handOver(s, p);
  emit(s, 'stick', 0.18);
  notice(s, 'STICK LIFT');
  return true;
}
function freePuck(s: MatchState, victim: Skater) {
  if (s.puck.owner !== victim.id) return;
  s.puck.owner = null;
  s.puck.vx = victim.vx * 0.75;
  s.puck.vz = victim.vz * 0.75;
  s.puck.lockout = 0.22;
  s.puck.shot = false;
  s.puck.passTo = null;
}
const facing = (p: Skater, x: number, z: number) => Math.sin(p.angle) * x + Math.cos(p.angle) * z;
function squaredUp(victim: Skater, nx: number, nz: number) {
  return victim.stumbleTimer <= 0 && !activeDeke(victim) && facing(victim, -nx, -nz) > 0.5;
}
function closingSpeed(hitter: Skater, victim: Skater, nx: number, nz: number) {
  return Math.max(0, (hitter.vx - victim.vx) * nx + (hitter.vz - victim.vz) * nz);
}
/**
 * Collision power: closing along the contact, plus skating speed through a committed shoulder.
 * A bump is only relative momentum. A check also counts the speed you drove in with, and a
 * side-on shoulder (the contact is on your hip, not your chest) spends that speed into them —
 * matching pace along the boards is a dump, not a rub. Hits from behind stay a shove; a
 * squared-up victim still takes something off; a deke or stumble leaves them exposed.
 */
function hitPower(hitter: Skater, victim: Skater, nx: number, nz: number, committed: boolean) {
  const relative = closingSpeed(hitter, victim, nx, nz);
  const drive = Math.max(0, hitter.vx * nx + hitter.vz * nz);
  const closing = committed
    ? relative * (1 - PHYSICS.checkDrive) + drive * PHYSICS.checkDrive
    : relative;
  const face = clamp(facing(hitter, nx, nz), 0, 1);
  const square = 0.55 + 0.45 * face;
  const away = victim.vx * nx + victim.vz * nz;
  const fromBehind = away > 2.5 && facing(victim, nx, nz) > 0.5 ? PHYSICS.checkFromBehind : 1;
  const exposed = victim.stumbleTimer > 0 || !!activeDeke(victim);
  const brace = exposed ? PHYSICS.checkExposed : squaredUp(victim, nx, nz) ? PHYSICS.checkBrace : 1;
  const commit = committed
    ? PHYSICS.checkCommit * (1 + PHYSICS.checkLoadBonus * clamp(hitter.checkPower, 0, 1))
    : 0;
  // Contact on the shoulder, not the chest: your skating speed is the hit. Head-on already
  // has closing; this is what makes a parallel board check the heaviest play.
  const shoulder = committed
    ? Math.hypot(hitter.vx, hitter.vz) * PHYSICS.checkShoulderDrive * (1 - face)
    : 0;
  const power = (closing * square * brace + commit + shoulder) * fromBehind;
  return victim.role === 'G' ? Math.min(power, PHYSICS.checkKnockdown - 0.01) : power;
}
function knockDown(
  s: MatchState,
  hitter: Skater,
  victim: Skater,
  power: number,
  nx: number,
  nz: number,
) {
  freePuck(s, victim);
  const impulse = clamp(closingSpeed(hitter, victim, nx, nz) * 0.55 + power * 0.18, 3.5, 9);
  victim.vx += nx * impulse + hitter.vx * 0.1;
  victim.vz += nz * impulse + hitter.vz * 0.1;
  victim.downTimer = clamp(0.9 + power * 0.09, 1.1, 2.3);
  victim.hitImmunity = victim.downTimer + 0.6;
  victim.stumbleTimer = 0;
  victim.fallAngle = Math.atan2(nx, nz);
  victim.cooldown = victim.downTimer;
  victim.diveTimer = 0;
  victim.blockTimer = 0;
  hitter.vx *= 0.8;
  hitter.vz *= 0.8;
  s.hits[hitter.team]++;
  s.hitstop = PHYSICS.hitstop;
  emit(s, 'hit', clamp(0.75 + (power - PHYSICS.checkKnockdown) * 0.05, 0.75, 1), victim);
  notice(s, 'BIG HIT');
}
function stagger(
  s: MatchState,
  hitter: Skater,
  victim: Skater,
  power: number,
  nx: number,
  nz: number,
) {
  freePuck(s, victim);
  const push = clamp(closingSpeed(hitter, victim, nx, nz) * 0.45 + power * 0.12, 2, 6);
  victim.vx += nx * push;
  victim.vz += nz * push;
  hitter.vx *= 0.86;
  hitter.vz *= 0.86;
  victim.hitImmunity = 0.45;
  victim.stumbleTimer = clamp(0.45 + (power - PHYSICS.checkStumble) * 0.12, 0.45, 0.9);
  victim.cooldown = Math.max(victim.cooldown, victim.stumbleTimer);
}
function shove(hitter: Skater, victim: Skater, power: number, nx: number, nz: number) {
  const push = clamp(power * 0.5, 1.2, 3.2);
  victim.vx += nx * push;
  victim.vz += nz * push;
  hitter.vx *= 0.94;
  hitter.vz *= 0.94;
  victim.hitImmunity = Math.max(victim.hitImmunity, 0.15);
}
/** Keep the checker moving through a body they already hit instead of bouncing off. */
function keepSkatingThrough(hitter: Skater, victim: Skater, nx: number, nz: number) {
  const closing = (hitter.vx - victim.vx) * nx + (hitter.vz - victim.vz) * nz;
  if (closing <= 0) return;
  hitter.vx -= nx * closing * 0.12;
  hitter.vz -= nz * closing * 0.12;
  victim.vx += nx * closing * 0.55;
  victim.vz += nz * closing * 0.55;
}
function jostle(a: Skater, b: Skater, nx: number, nz: number, closing: number) {
  if (closing <= 0) return;
  const bleed = closing * 0.22;
  a.vx -= nx * bleed;
  a.vz -= nz * bleed;
  b.vx += nx * bleed;
  b.vz += nz * bleed;
}
/** The check is live: the flick happened and the follow-through has not started. */
const liveCheck = (p: Skater) => p.checkTimer > PHYSICS.checkRecovery && !p.checkLanded;
function bodyCheck(
  s: MatchState,
  hitter: Skater,
  victim: Skater,
  nx: number,
  nz: number,
  scale = 1,
) {
  hitter.checkLanded = true;
  hitter.hitLock = -1;
  if (victim.hitImmunity > 0) {
    keepSkatingThrough(hitter, victim, nx, nz);
    return;
  }
  const power = hitPower(hitter, victim, nx, nz, true) * scale;
  victim.stamina = clamp(victim.stamina - clamp(power * 0.02, 0.03, 0.18), 0, 1);
  if (power >= PHYSICS.checkKnockdown) {
    knockDown(s, hitter, victim, power, nx, nz);
    return;
  }
  if (power >= PHYSICS.checkStumble) {
    stagger(s, hitter, victim, power, nx, nz);
    s.hits[hitter.team]++;
    emit(s, 'hit', clamp(power / 13, 0.45, 0.7), victim);
    notice(s, 'HIT');
    return;
  }
  shove(hitter, victim, power, nx, nz);
  emit(s, 'hit', 0.3, victim);
}
/**
 * Skating into someone without checking: whoever is driving into the other delivers a bump.
 * It can put a skater on their heels, but only two sprinters head-on go down. A carrier who
 * runs into a defender that has squared up loses that battle.
 */
function incidental(s: MatchState, a: Skater, b: Skater, nx: number, nz: number, closing: number) {
  if (closing <= 0.05) return;
  let driver = a,
    other = b,
    dx = nx,
    dz = nz;
  const aDrive = a.vx * nx + a.vz * nz,
    bDrive = -(b.vx * nx + b.vz * nz);
  if (bDrive > aDrive) {
    driver = b;
    other = a;
    dx = -nx;
    dz = -nz;
  }
  if (s.puck.owner === driver.id && squaredUp(other, dx, dz)) {
    [driver, other] = [other, driver];
    dx = -dx;
    dz = -dz;
  }
  if (driver.role === 'G' || other.role === 'G' || other.hitImmunity > 0) {
    jostle(a, b, nx, nz, closing);
    return;
  }
  const power = hitPower(driver, other, dx, dz, false);
  if (power >= PHYSICS.bumpKnockdown) {
    knockDown(s, driver, other, power, dx, dz);
    return;
  }
  if (power >= PHYSICS.bumpStumble) {
    const hadPuck = s.puck.owner === other.id;
    stagger(s, driver, other, power, dx, dz);
    if (hadPuck) {
      s.hits[driver.team]++;
      notice(s, 'STOOD UP');
    }
    emit(s, 'hit', hadPuck ? 0.45 : 0.32, other);
    return;
  }
  jostle(a, b, nx, nz, closing);
}
/** Opponents in contact: a live check lands as a hit; anything else is a bump. */
function contact(s: MatchState, a: Skater, b: Skater, nx: number, nz: number, closing: number) {
  const aLive = shoulderContact(s, a, b, nx, nz),
    bLive = shoulderContact(s, b, a, -nx, -nz);
  if (aLive && bLive) {
    // Two committed checks: the heavier momentum wins and the other eats it at a discount.
    const aDrive = a.vx * nx + a.vz * nz,
      bDrive = -(b.vx * nx + b.vz * nz);
    if (aDrive >= bDrive) {
      b.checkLanded = true;
      bodyCheck(s, a, b, nx, nz, 0.85);
    } else {
      a.checkLanded = true;
      bodyCheck(s, b, a, -nx, -nz, 0.85);
    }
    return;
  }
  if (aLive) return bodyCheck(s, a, b, nx, nz);
  if (bLive) return bodyCheck(s, b, a, -nx, -nz);
  incidental(s, a, b, nx, nz, closing);
}
/**
 * A poke is a jab along the left stick. The blade runs out from the body down that line and takes
 * the puck only if the puck sits in the lane it covers; with the stick neutral it runs along the
 * blade's own line. A clean poke knocks the puck off the carrier's blade and back toward the poker,
 * with the carrier a beat slow to recover, so the one who aimed it gets first touch. A miss costs
 * the whiff cooldown.
 */
function pokeCheck(s: MatchState, p: Skater, aimX: number, aimZ: number, sweep = false) {
  if (p.cooldown > 0 || p.downTimer > 0 || p.stumbleTimer > 0 || p.diveTimer > 0) return;
  const fx = Math.sin(p.angle),
    fz = Math.cos(p.angle),
    tip = stickTip(p);
  let aim = normalized(aimX, aimZ);
  // Nobody jabs behind their own back: a stick pulled back, or left neutral, pokes down the blade.
  if (Math.hypot(aimX, aimZ) < 0.3 || aim.x * fx + aim.z * fz < PHYSICS.pokeCone)
    aim = normalized(tip.x - p.x, tip.z - p.z);
  p.cooldown = sweep ? 0.32 : 0.45;
  p.stickReach += PHYSICS.pokeExtend + (sweep ? PHYSICS.sweepReach : 0);
  // Throw the blade toward the aim so the jab reads on the rig.
  const aimSide = (aim.x * fz - aim.z * fx) * STICK.restReach;
  p.stickSide += clamp(aimSide - p.stickSide, -0.6, 0.6) * 0.5;
  const owner = s.puck.owner !== null ? s.skaters[s.puck.owner] : null;
  if (!owner || owner.team === p.team) return;
  // A frozen puck is under the goalie; there is nothing to poke until they play it.
  if (owner.role === 'G' && (owner.coverTimer ?? 0) > 0) return;
  const rx = s.puck.x - p.x,
    rz = s.puck.z - p.z,
    along = rx * aim.x + rz * aim.z,
    across = Math.abs(rx * aim.z - rz * aim.x);
  const length = PHYSICS.pokeLength + (sweep ? PHYSICS.sweepReach : 0),
    lane = PHYSICS.pokeReach + (sweep ? PHYSICS.sweepLane : 0);
  if (along < 0.25 || along > length || across > lane) return;
  // Body between the stick and the puck: you have to wrap around the shield.
  if (pokeShielded(p, owner, s.puck)) return;
  const pose = activeDeke(owner);
  if (pose && pose.hop > 0.12) return;
  const back = normalized(-rx, -rz),
    off = normalized(s.puck.x - owner.x, s.puck.z - owner.z),
    kick = normalized(back.x + off.x * PHYSICS.pokeOff, back.z + off.z * PHYSICS.pokeOff);
  s.puck.owner = null;
  s.puck.vx = p.vx * 0.5 + owner.vx * 0.3 + kick.x * PHYSICS.pokeKick;
  s.puck.vz = p.vz * 0.5 + owner.vz * 0.3 + kick.z * PHYSICS.pokeKick;
  s.puck.lockout = 0.08;
  s.puck.shot = false;
  s.puck.passTo = null;
  s.puck.lastTouch = p.team;
  p.cooldown = 0.1;
  owner.cooldown = Math.max(owner.cooldown, PHYSICS.pokeRecover);
  clearDeke(owner);
  emit(s, 'stick', 0.2);
  notice(s, 'POKE CHECK');
}
/**
 * NHL 14 style skating. The heading turns toward the stick at a rate that falls with speed, thrust
 * runs along the heading, and the edges bite off sideways slip: a turn at pace is a carve, not a
 * slide. Pushing against your own momentum is a hockey stop that pivots you around to push off.
 */
function moveSkater(
  p: Skater,
  x: number,
  z: number,
  hustle: boolean,
  backskate: boolean,
  dt: number,
  carrying = false,
  grip = PHYSICS.edgeGrip,
  pushScale = 1,
  speedScale = 1,
) {
  const speedNow = Math.hypot(p.vx, p.vz);
  skateVelocity(p, x, z, hustle, backskate, dt, carrying, grip, pushScale, speedScale);
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // The goal frame is solid for skaters; keep players out of the net interior.
  for (const sign of [-1, 1]) {
    const nx = p.x * sign,
      radius = PHYSICS.playerRadius;
    if (
      nx > RINK.goalX - radius &&
      nx < RINK.goalX + 1.5 + radius &&
      Math.abs(p.z) < RINK.goalHalfWidth + radius
    ) {
      const front = nx - (RINK.goalX - radius),
        back = RINK.goalX + 1.5 + radius - nx,
        side = RINK.goalHalfWidth + radius - Math.abs(p.z);
      if (front < back && front < side) {
        p.x = sign * (RINK.goalX - radius);
        p.vx = 0;
      } else if (back < side) {
        p.x = sign * (RINK.goalX + 1.5 + radius);
        p.vx = 0;
      } else {
        p.z = Math.sign(p.z || 1) * (RINK.goalHalfWidth + radius);
        p.vz = 0;
      }
    }
  }
  const normal = constrainToRink(p, PHYSICS.playerRadius);
  if (normal) {
    const dot = p.vx * normal.x + p.vz * normal.z;
    if (dot < 0) {
      p.vx -= dot * normal.x;
      p.vz -= dot * normal.z;
    }
  }
  p.stride += speedNow * dt * 1.05;
}
/** A check that finds nothing but air leaves you overextended: no puck, no second swing, for a beat. */
function whiffCheck(p: Skater) {
  p.hitLock = -1;
  p.stumbleTimer = Math.max(p.stumbleTimer, 0.22);
  p.cooldown = Math.max(p.cooldown, 0.3);
  p.vx *= 0.85;
  p.vz *= 0.85;
}
function updateRush(p: Skater, dt: number) {
  if (p.downTimer > 0) {
    p.rush = 0;
    p.hitLock = -1;
    return;
  }
  const speed = Math.hypot(p.vx, p.vz);
  p.rush += (speed - p.rush) * (1 - Math.exp(-6 * dt));
}
/** Chest or shoulder can spend a live check. The back cannot: a hip brush from behind is
 * not a hit. Matching speed beside someone still counts — the throw is the contact. */
function shoulderContact(s: MatchState, a: Skater, b: Skater, nx: number, nz: number) {
  if (
    !liveCheck(a) ||
    s.puck.owner === a.id ||
    a.team === b.team ||
    a.downTimer > 0 ||
    b.downTimer > 0
  )
    return false;
  // cos(95°) ≈ -0.09: the forward half plus a sliver behind the shoulder, not the spine.
  if (facing(a, nx, nz) <= -0.08) return false;
  return closingSpeed(a, b, nx, nz) > 0.1 || Math.hypot(a.vx, a.vz) > 2.8;
}
function separatePlayers(s: MatchState, previous: Vec2[]) {
  const contacts: { a: Skater; b: Skater; t: number; nx: number; nz: number; body: boolean }[] = [];
  for (let i = 0; i < s.skaters.length; i++)
    for (let j = i + 1; j < s.skaters.length; j++) {
      const a = s.skaters[i],
        b = s.skaters[j];
      if (!isOnIce(s, a) || !isOnIce(s, b)) continue;
      const min = PHYSICS.playerRadius * 2;
      const opponents = a.team !== b.team && a.downTimer <= 0 && b.downTimer <= 0;
      const radius = min + (opponents && (liveCheck(a) || liveCheck(b)) ? PHYSICS.checkReach : 0);
      const rx = previous[j].x - previous[i].x,
        rz = previous[j].z - previous[i].z;
      const dx = b.x - a.x - rx,
        dz = b.z - a.z - rz;
      const c = rx * rx + rz * rz - radius * radius;
      const aa = dx * dx + dz * dz,
        bb = 2 * (rx * dx + rz * dz);
      const discriminant = bb * bb - 4 * aa * c;
      const t =
        c <= 0
          ? 0
          : aa > 1e-10 && discriminant >= 0
            ? (-bb - Math.sqrt(discriminant)) / (2 * aa)
            : Infinity;
      if (t < 0 || t > 1) continue;
      const atX = rx + dx * t,
        atZ = rz + dz * t;
      const n =
        Math.hypot(atX, atZ) > 1e-5
          ? normalized(atX, atZ)
          : normalized(a.vx - b.vx || 1, a.vz - b.vz);
      const closest = aa > 1e-10 ? clamp(-(rx * dx + rz * dz) / aa, 0, 1) : 0;
      const body = Math.hypot(rx + dx * closest, rz + dz * closest) < min;
      contacts.push({ a, b, t, nx: n.x, nz: n.z, body });
    }
  // The first shoulder along the path wins, independent of roster order.
  contacts.sort((a, b) => a.t - b.t);
  for (const { a, b, nx, nz, body } of contacts) {
    const opponents = a.team !== b.team && a.downTimer <= 0 && b.downTimer <= 0;
    const eligible = shoulderContact(s, a, b, nx, nz) || shoulderContact(s, b, a, -nx, -nz);
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (opponents && (body || eligible)) contact(s, a, b, nx, nz, closing);
    else if (body) jostle(a, b, nx, nz, closing);
    if (!body) continue;
    const overlap =
      Math.max(0, PHYSICS.playerRadius * 2 - ((b.x - a.x) * nx + (b.z - a.z) * nz)) / 2;
    a.x -= nx * overlap;
    a.z -= nz * overlap;
    b.x += nx * overlap;
    b.z += nz * overlap;
    constrainToRink(a, PHYSICS.playerRadius);
    constrainToRink(b, PHYSICS.playerRadius);
  }
}
function goal(s: MatchState, scoringTeam: Team) {
  if (s.phase === 'goal') return false;
  if (s.mode === 'freeSkate' && scoringTeam !== freeSkateTeam(s)) return false;
  if (s.mode === 'shootout' && scoringTeam !== s.shootoutShooter) return false;
  if (s.mode !== 'freeSkate') s.score[scoringTeam]++;
  s.scoringTeam = scoringTeam;
  s.phase = 'goal';
  s.countdown = s.mode === 'freeSkate' ? 1.6 : s.mode === 'shootout' ? 2.2 : RULES.goalSeconds;
  emit(s, 'goal', 1, { barDown: s.barTick >= 0 && s.tick - s.barTick < 40 });
  return true;
}
/** First fraction of a step at which a point leaving (ax, ay) along (dx, dy) comes within r of the origin. */
function sweepCircle(ax: number, ay: number, dx: number, dy: number, r: number) {
  const c = ax * ax + ay * ay - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy,
    b = ax * dx + ay * dy;
  if (a < 1e-12 || b >= 0) return null;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? t : null;
}
interface IronHit {
  kind: 'post' | 'crossbar';
  sign: number;
  t: number;
  nx: number;
  ny: number;
  nz: number;
}
/**
 * Sweeps the puck against the posts and crossbar as round pipes, so where it catches the iron
 * decides whether it rings in, out, over or down. Bounces it off the first contact.
 */
function strikeIron(p: Puck, oldX: number, oldY: number, oldZ: number, dt: number) {
  const dx = p.x - oldX,
    dy = p.y - oldY,
    dz = p.z - oldZ,
    postReach = IRON.radius + IRON.puckRim,
    barReach = IRON.radius + IRON.puckFace;
  let hit: IronHit | null = null;
  // The posts run up into the crossbar and the crossbar out over the posts, so the corner has no gap.
  for (const sign of [-1, 1]) {
    const ax = oldX - sign * RINK.goalX;
    for (const side of [-1, 1]) {
      const az = oldZ - side * RINK.goalHalfWidth,
        t = sweepCircle(ax, az, dx, dz, postReach);
      if (t === null || (hit && t >= hit.t) || oldY + dy * t > IRON.crossbarY + IRON.radius)
        continue;
      const cx = ax + dx * t,
        cz = az + dz * t,
        d = Math.hypot(cx, cz) || 1;
      hit = { kind: 'post', sign, t, nx: cx / d, ny: 0, nz: cz / d };
    }
    const ay = oldY - IRON.crossbarY,
      t = sweepCircle(ax, ay, dx, dy, barReach);
    if (
      t === null ||
      (hit && t >= hit.t) ||
      Math.abs(oldZ + dz * t) > RINK.goalHalfWidth + IRON.radius
    )
      continue;
    const cx = ax + dx * t,
      cy = ay + dy * t,
      d = Math.hypot(cx, cy) || 1;
    hit = { kind: 'crossbar', sign, t, nx: cx / d, ny: cy / d, nz: 0 };
  }
  if (!hit) return null;
  const vn = p.vx * hit.nx + p.vy * hit.ny + p.vz * hit.nz;
  if (vn >= 0) return null;
  const x = oldX + dx * hit.t,
    y = oldY + dy * hit.t,
    z = oldZ + dz * hit.t;
  const bounce = (v: number, n: number) => (v - vn * n) * IRON.friction - vn * n * IRON.restitution;
  p.vx = bounce(p.vx, hit.nx);
  p.vy = bounce(p.vy, hit.ny);
  p.vz = bounce(p.vz, hit.nz);
  const rest = (1 - hit.t) * dt;
  p.x = x + p.vx * rest;
  p.y = y + p.vy * rest;
  p.z = z + p.vz * rest;
  return { ...hit, x, y, z, speed: -vn };
}
function ringIron(s: MatchState, ring: NonNullable<ReturnType<typeof strikeIron>>) {
  const p = s.puck;
  p.shot = false;
  p.lockout = Math.max(p.lockout, 0.12);
  // Caught under the crossbar and driven down behind the line.
  const barDown =
    s.phase !== 'goal' &&
    ring.kind === 'crossbar' &&
    ring.ny < 0 &&
    p.vx * ring.sign > 0 &&
    p.vy < 0;
  emit(s, ring.kind, clamp(ring.speed / 30, 0.2, 1), { barDown });
  if (barDown) {
    s.barTick = s.tick;
    s.hitstop = Math.max(s.hitstop, IRON.ringHold);
  } else if (s.phase !== 'goal') notice(s, 'OFF THE IRON');
}
/** A puck wholly inside the frame as it crosses the goal line is in. */
function crossGoalLine(
  s: MatchState,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  for (const sign of [-1, 1]) {
    if (a.x * sign >= RINK.goalX || b.x * sign < RINK.goalX) continue;
    const t = (sign * RINK.goalX - a.x) / (b.x - a.x);
    if (
      Math.abs(a.z + (b.z - a.z) * t) < RINK.goalHalfWidth &&
      a.y + (b.y - a.y) * t < IRON.crossbarY
    )
      goal(s, teamAttackingNet(sign, s.period));
  }
}
function teamAttackingNet(sign: number, period: number): Team {
  return (attackDirection(0, period) === sign ? 0 : 1) as Team;
}
function containGoalPuck(s: MatchState) {
  if (s.phase !== 'goal' || s.scoringTeam === null) return;
  const p = s.puck;
  if (p.owner !== null) return;
  const sign = attackDirection(s.scoringTeam, s.period);
  const depth = p.x * sign;
  const front = RINK.goalX + 0.12;
  const back = RINK.goalX + 1.42;
  if (depth < front) {
    p.x = sign * front;
    if (p.vx * sign < 0) p.vx *= -0.28;
  } else if (depth > back) {
    p.x = sign * back;
    if (p.vx * sign > 0) p.vx *= -0.32;
  }
  const side = RINK.goalHalfWidth - 0.12;
  if (Math.abs(p.z) > side) {
    p.z = Math.sign(p.z || 1) * side;
    p.vz *= -0.35;
  }
  if (p.y > RINK.goalHeight - 0.08) {
    p.y = RINK.goalHeight - 0.08;
    if (p.vy > 0) p.vy *= -0.28;
  }
}
/** The goalie has the puck under them: a catch, a smother, or a loose puck they got to first. */
function coverPuck(s: MatchState, g: Skater, label: string) {
  const p = s.puck;
  p.owner = g.id;
  p.lastTouch = g.team;
  p.shot = false;
  p.passTo = null;
  p.lockout = 0;
  p.vx = p.vz = p.vy = 0;
  p.y = PUCK.restY;
  g.coverTimer = s.sides[g.team].humans.length ? GOALIE.humanHold : GOALIE.hold;
  g.cooldown = 0.25;
  g.readTimer = 0;
  const keeper = handOver(s, g);
  if (keeper) keeper.autoSkate = false;
  notice(s, label);
  if (s.mode === 'shootout') missShootout(s, 'SAVE');
}
/** The puck met the goalie: rebound it or freeze it, and call the play. Passes just bounce. */
function goalieStop(s: MatchState, g: Skater, contact: SaveContact) {
  const p = s.puck,
    shot = p.shot;
  recordContact(g, contact);
  const outcome = applySave(g, p, contact);
  if (shot) emit(s, 'save', clamp(contact.speed / 34, 0.4, 1));
  if (outcome.cover) {
    coverPuck(s, g, shot ? outcome.label : 'COVERED');
    return;
  }
  p.shot = false;
  p.passTo = null;
  p.lastTouch = g.team;
  p.lockout = 0.28;
  if (!shot) {
    emit(s, 'deflect', 0.15);
    return;
  }
  notice(s, outcome.label);
  if (s.mode === 'shootout') missShootout(s, 'SAVE');
}
function advancePuck(s: MatchState, dt: number) {
  const p = s.puck;
  p.lockout = Math.max(0, p.lockout - dt);
  if (p.owner !== null) {
    const previousX = p.x;
    const owner = s.skaters[p.owner];
    const forwardX = Math.sin(owner.angle),
      forwardZ = Math.cos(owner.angle);
    const pose = activeDeke(owner);
    // A frozen puck is under the mitt, not out on the paddle.
    const frozen = owner.role === 'G' && (owner.coverTimer ?? 0) > 0;
    const reach = frozen ? 0.5 : owner.stickReach,
      side = frozen ? 0.25 : owner.stickSide;
    p.x = owner.x + forwardX * reach + forwardZ * side;
    p.z = owner.z + forwardZ * reach - forwardX * side;
    p.y = PUCK.restY + (pose ? pose.hop + pose.lift : 0);
    p.vx = owner.vx;
    p.vz = owner.vz;
    p.vy = 0;
    constrainToRink(p, 0.16);
    s.possession[owner.team] += dt;
    for (const sign of [-1, 1])
      if (
        previousX * sign < RINK.goalX &&
        p.x * sign >= RINK.goalX &&
        Math.abs(p.z) < RINK.goalHalfWidth - 0.12
      ) {
        const defendingGoalie = s.skaters.find(
          (q) => q.role === 'G' && isOnIce(s, q) && attackDirection(q.team, s.period) === -sign,
        );
        if (
          !defendingGoalie ||
          distance(defendingGoalie, p) > 1.28 * cpuTune(s, defendingGoalie).save
        ) {
          p.owner = null;
          goal(s, teamAttackingNet(sign, s.period));
        }
      }
    if (s.phase === 'playing') shootoutAttemptOver(s);
    return;
  }
  const oldX = p.x,
    oldZ = p.z,
    oldY = p.y;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt;
  p.vy -= 9.8 * dt;
  if (p.y < PUCK.restY) {
    p.y = PUCK.restY;
    p.vy = Math.abs(p.vy) > 0.6 ? -p.vy * 0.25 : 0;
  }
  p.vx *= Math.exp(-PHYSICS.puckDrag * dt);
  p.vz *= Math.exp(-PHYSICS.puckDrag * dt);
  // The goalie is swept before the iron: they stand in front of it.
  if (s.phase !== 'goal')
    for (const g of s.skaters) {
      if (g.role !== 'G' || !isOnIce(s, g) || g.downTimer > 0 || g.stumbleTimer > 0) continue;
      const contact = sweepGoalie(g, p, { x: oldX, y: oldY, z: oldZ }, cpuTune(s, g).save);
      if (!contact) continue;
      // Back to the contact; the rebound carries it for the rest of the step.
      const rest = (1 - contact.t) * dt;
      p.x = oldX + (p.x - oldX) * contact.t;
      p.z = oldZ + (p.z - oldZ) * contact.t;
      p.y = Math.max(PUCK.restY, oldY + (p.y - oldY) * contact.t);
      goalieStop(s, g, contact);
      if (p.owner === null) {
        p.x += p.vx * rest;
        p.z += p.vz * rest;
        p.y += p.vy * rest;
      }
      return;
    }
  // Swept iron and goal-line tests keep fast shots from tunnelling through the frame.
  const ring = s.phase === 'goal' ? null : strikeIron(p, oldX, oldY, oldZ, dt);
  const from = ring ?? { x: oldX, y: oldY, z: oldZ };
  if (ring) {
    crossGoalLine(s, { x: oldX, y: oldY, z: oldZ }, ring);
    ringIron(s, ring);
  }
  crossGoalLine(s, from, p);
  for (const sign of [-1, 1]) {
    // Back and side netting: entering from behind never counts as a goal.
    if (
      p.x * sign > RINK.goalX &&
      p.x * sign < RINK.goalX + 1.5 &&
      Math.abs(p.z) < RINK.goalHalfWidth &&
      p.y < RINK.goalHeight
    ) {
      if (from.x * sign >= RINK.goalX + 1.5) {
        p.x = sign * (RINK.goalX + 1.52);
        p.vx *= -0.4;
      } else if (Math.abs(from.z) >= RINK.goalHalfWidth) {
        p.z = Math.sign(from.z || 1) * (RINK.goalHalfWidth + 0.12);
        p.vz *= -0.4;
      } else if (s.phase !== 'goal') {
        p.z = Math.sign(from.z || 1) * (RINK.goalHalfWidth + 0.12);
        p.vz *= -0.4;
      }
    }
  }
  if (shootoutAttemptOver(s)) return;
  containGoalPuck(s);
  const normal = constrainToRink(p, 0.16);
  if (normal) {
    const dot = p.vx * normal.x + p.vz * normal.z;
    if (dot < 0) {
      p.vx -= 1.72 * dot * normal.x;
      p.vz -= 1.72 * dot * normal.z;
      if (Math.abs(dot) > 8) emit(s, 'boards', clamp(-dot / 30, 0.15, 1));
    }
  }
  for (const player of s.skaters) {
    if (
      !isOnIce(s, player) ||
      player.role === 'G' ||
      (player.diveTimer <= 0 && player.blockTimer <= 0)
    )
      continue;
    const diving = player.diveTimer > 0;
    const ragdolled = diving && player.downTimer > 0;
    if (p.y > (diving ? (ragdolled ? 0.78 : 1.15) : 0.85)) continue;
    const reach = diving ? (ragdolled ? 1.62 : 1.48) : 1.12;
    if (distance(player, p) > reach && puckReach(player, p) > reach) continue;
    const away = normalized(p.x - player.x, p.z - player.z),
      incoming = Math.hypot(p.vx, p.vz);
    p.vx = away.x * (4.2 + incoming * 0.28) + player.vx * 0.2;
    p.vz = away.z * (4.2 + incoming * 0.28) + player.vz * 0.2;
    p.vy = diving ? 1.1 : 0.45;
    p.shot = false;
    p.lockout = 0.18;
    p.passTo = null;
    emit(s, 'deflect', diving ? 0.35 : 0.22);
    notice(s, diving ? 'DIVE BLOCK' : 'BLOCK');
    return;
  }
  if (p.lockout > 0) return;
  const incoming = Math.hypot(p.vx, p.vz);
  const livePass = !p.shot && incoming > 7 && p.passTo !== null;
  if (p.y > (livePass ? PHYSICS.passCatchHeight : 0.65)) return;
  const reachOf = (player: Skater) =>
    livePass && player.team !== p.lastTouch ? distance(player, p) : puckReach(player, p);
  const limitOf = (player: Skater) => {
    if (player.role === 'G') return GOALIE.coverReach;
    if (livePass && player.id === p.passTo) return PHYSICS.pickupRadius + 0.22;
    if (livePass && player.team !== p.lastTouch) return PHYSICS.passIntercept;
    return PHYSICS.pickupRadius;
  };
  // A goalie can smother a slow puck they get to first; anything quicker is a rebound to fight for.
  const candidates = s.skaters.filter(
    (player) =>
      isOnIce(s, player) &&
      player.downTimer <= 0 &&
      player.diveTimer <= 0 &&
      player.stumbleTimer <= 0 &&
      player.cooldown <= 0 &&
      (player.role === 'G' ? canCover(player, p) : p.y <= 0.65 || player.team === p.lastTouch) &&
      reachOf(player) < limitOf(player),
  );
  candidates.sort((a, b) => reachOf(a) - reachOf(b));
  // A human reaching for a loose puck gets the benefit of the doubt over a CPU. When both sides
  // are reaching, neither does, or the race would be settled by roster order instead of by reach.
  // Two people on the same side reaching are one side: the nearer of them gets it.
  const held = candidates.filter((player) => isControlled(s, player));
  const you = new Set(held.map((player) => player.team)).size === 1 ? held[0] : undefined;
  let player = candidates[0];
  if (you && player && reachOf(you) < reachOf(player) + 0.38) player = you;
  if (livePass && p.lastTouch !== null && player && player.team !== p.lastTouch) {
    const mate = candidates.find((candidate) => candidate.team === p.lastTouch);
    if (mate) player = mate;
  }
  if (player?.role === 'G') {
    coverPuck(s, player, 'COVERED');
    return;
  }
  if (player) {
    // Hard shots deflect off bodies; slower pucks can be collected cleanly.
    if (p.shot && incoming > 18) {
      if (distance(player, p) < 0.72) {
        p.vx *= 0.45;
        p.vz += (player.z > p.z ? -1 : 1) * 5;
        p.shot = false;
        p.lockout = 0.14;
        emit(s, 'deflect', 0.2);
      }
    } else {
      if (incoming > 8 && !p.shot && p.lastTouch === player.team) player.passTimer = 0.42;
      // A puck that arrives with pace makes a sound on the blade; one scooped off the ice does not.
      if (incoming > 5) emit(s, 'receive', clamp(incoming / 24, 0.2, 1), player);
      p.owner = player.id;
      p.lastTouch = player.team;
      p.shot = false;
      p.passTo = null;
      player.cooldown = 0.15;
      handOver(s, player);
    }
  }
}
/**
 * Pure fixed-step simulation. It has no React, browser, rendering or audio dependencies.
 *
 * One `InputFrame` per person, by team and then seat; a side nobody sits on is left to `decideAI`. Pausing is
 * deliberately not handled here — with two people playing, whose pause it is belongs to the
 * caller, not to the physics.
 */
export function stepMatch(s: MatchState, inputs: SideInputs = [[], []], dt = RULES.fixedStep) {
  if (
    s.phase === 'menu' ||
    s.phase === 'paused' ||
    s.phase === 'intermission' ||
    s.phase === 'final'
  )
    return;
  s.tick++;
  s.noticeTimer = Math.max(0, s.noticeTimer - dt);
  if (s.phase === 'faceoff') {
    // A side's draw is taken by whoever is on its centre. Anybody else's swing is not at the dot.
    for (const t of TEAMS) {
      const side = s.sides[t];
      const seat = side.humans.findIndex((h) => h.controlled === t * 6);
      if (seat < 0) continue;
      const input = frameFor(t, seat, inputs);
      if (side.drawInput < 0 && (input.pass || input.poke)) side.drawInput = s.countdown;
    }
    s.countdown -= dt;
    if (s.countdown <= 0) {
      resolveFaceoff(s);
      s.phase = 'playing';
      emit(s, 'faceoff');
    }
    return;
  }
  if (s.phase === 'goal') {
    s.countdown -= dt;
    if (s.countdown <= 0) {
      if (s.mode === 'shootout') concludeShootoutAttempt(s);
      else {
        resetFormation(s);
        startMatch(s);
      }
      return;
    }
  }
  if (s.hitstop > 0 && s.phase !== 'goal') {
    s.hitstop = Math.max(0, s.hitstop - dt);
    return;
  }
  if (s.phase !== 'goal' && modeInfo(s.mode).timed) {
    // Fast until the finish, then real seconds, and never skipping past the start of the finish.
    const finish = RULES.realTimeFinish;
    s.clock =
      s.clock > finish
        ? Math.max(finish, s.clock - dt * clockRate(modeInfo(s.mode)))
        : Math.max(0, s.clock - dt);
    if (s.clock <= 0) {
      if (s.mode === 'shootout') {
        missShootout(s, 'TIME');
        return;
      }
      s.phase = s.period === modeInfo(s.mode).periods ? 'final' : 'intermission';
      emit(s, 'horn');
      return;
    }
  }
  // Each person reads their own stick before anyone moves: switching, windup, aim and the pass
  // arrow. Seat order is the priority when two people on a side want the same skater.
  for (const t of TEAMS)
    s.sides[t].humans.forEach((human, seat) => {
      const input = frameFor(t, seat, inputs);
      if (input.switchPlayer) {
        const ownGoal = s.phase === 'goal' && s.scoringTeam === t;
        if (!ownGoal && !stickLift(s, s.skaters[human.controlled])) switchSkater(s, t, human);
      } else if (input.pass && (s.puck.owner === null || s.skaters[s.puck.owner].team !== t))
        switchSkater(s, t, human);
      const you = s.skaters[human.controlled],
        youCarry = s.puck.owner === human.controlled;
      human.shotCharge =
        !you.pendingShot &&
        !input.toeDrag &&
        !input.deke &&
        !input.dekeSpecial &&
        !you.dekeKind &&
        input.stickY > 0.3 &&
        youCarry
          ? clamp(human.shotCharge + dt * 1.8, 0, 1)
          : Math.max(0, human.shotCharge - dt * 2);
      if (youCarry && !input.toeDrag) {
        human.shotAim = clamp(input.aimZ ?? 0, -1, 1);
        human.shotLift = clamp(input.shotHeight ?? 0, 0, 1);
      } else {
        human.shotAim = 0;
        human.shotLift = 0;
      }
      applyPassAim(s, you, input, human);
    });
  // Freeze who each person is driving for the whole step. A pass that switches control mid-loop
  // must not hand the stick over before the skater who threw it has finished moving.
  const driven = new Map<number, { input: InputFrame; human: Human }>();
  for (const t of TEAMS)
    s.sides[t].humans.forEach((human, seat) =>
      driven.set(human.controlled, { input: frameFor(t, seat, inputs), human }),
    );
  const previous = s.skaters.map((p) => ({ x: p.x, z: p.z }));
  // Every CPU sees the same pre-movement frame, regardless of its roster index.
  const decisions = s.skaters.map((p) =>
    !driven.has(p.id) && isOnIce(s, p) ? decideAI(s, p) : null,
  );
  const breakaway = isBreakawayRush(s);
  for (const p of s.skaters) {
    if (!isOnIce(s, p)) continue;
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.checkTimer > 0) {
      p.checkTimer = Math.max(0, p.checkTimer - dt);
      if (p.checkTimer === 0 && !p.checkLanded) whiffCheck(p);
    }
    p.downTimer = Math.max(0, p.downTimer - dt);
    p.stumbleTimer = Math.max(0, p.stumbleTimer - dt);
    p.hitImmunity = Math.max(0, p.hitImmunity - dt);
    p.shotTimer = Math.max(0, p.shotTimer - dt);
    p.saveTimer = Math.max(0, (p.saveTimer ?? 0) - dt);
    p.coverTimer = Math.max(0, (p.coverTimer ?? 0) - dt);
    p.passTimer = Math.max(0, p.passTimer - dt);
    p.diveTimer = Math.max(0, p.diveTimer - dt);
    landDive(p);
    p.blockTimer = Math.max(0, p.blockTimer - dt);
    p.liftTimer = Math.max(0, p.liftTimer - dt);
    stepDeke(p, dt);
    if (p.downTimer > 0 || p.diveTimer > 0 || s.puck.owner !== p.id) clearDeke(p);
    stepCelly(p, dt);
    if (p.downTimer > 0 && p.cellyKind !== 'limp') clearCelly(p);
    const drive = driven.get(p.id);
    const input = drive?.input ?? null;
    if (p.role === 'G') {
      p.angle = goalieFacing(s, p);
      stepGoalieRead(s, p, dt, cpuTune(s, p).reaction, !!input);
    }
    if (input && s.puck.owner === p.id && p.role !== 'G') tryStartDeke(p, input);
    if (input?.celly && canStartCelly(s, p) && startCelly(p, input.celly)) {
      clearDeke(p);
      s.countdown = Math.max(s.countdown, cellyDuration(input.celly) + 0.5);
    }
    const drag = !!input?.toeDrag && s.puck.owner === p.id;
    const ai = decisions[p.id];
    const side = input ? input.stickX : ai?.stickX || Math.sin(s.tick * 0.025 + p.id) * 0.35;
    const pull = drag && input ? clamp(input.stickY, 0, 1) : ai?.toeDrag ? 0.82 : 0;
    const carrying = s.puck.owner === p.id;
    const rushCarry = carrying && breakaway;
    if (!p.pendingShot) advanceStick(p, side, pull, dt, carrying);
    const grip = activeDeke(p)
      ? PHYSICS.dekeGrip
      : carrying
        ? PHYSICS.edgeGrip - clamp(Math.abs(p.stickSideVel) * 0.6, 0, 4)
        : PHYSICS.edgeGrip;
    if (s.puck.owner === p.id && Math.hypot(p.vx, p.vz) < 2.8)
      p.stride += dt * (1.8 + Math.abs(p.stickSide - STICK.restSide) * 1.2);
    if (p.downTimer > 0 || p.diveTimer > 0 || cellyRagdoll(p)) {
      moveSkater(p, 0, 0, false, false, dt);
      if (p.downTimer > 0 || cellyRagdoll(p)) p.rush = 0;
      continue;
    }
    if (input) {
      if (input.block && p.role !== 'G') p.blockTimer = 0.16;
      const skate = controlledSkate(s, p, input, drive!.human);
      const push = p.role === 'G' ? savePush(p) : null;
      const human = backcheckScales(s, p, skate.push, 1);
      moveSkater(
        p,
        push?.x ?? skate.x,
        push?.z ?? skate.z,
        skate.hustle,
        skate.backskate,
        dt,
        carrying && !rushCarry,
        grip,
        human.push,
        human.speed,
      );
      if (p.role === 'G') {
        trackSaveSide(p, previous[p.id].x, previous[p.id].z);
        // A flick throws a hand or the pads at that side; holding the block button drops the pads.
        if (input.reach && s.puck.owner !== p.id && (!committed(p) || canRecommit(p)))
          manualSave(p, input.stickIceX, input.stickIceZ);
        else if (input.block && s.puck.owner !== p.id && !committed(p))
          commitSave(p, 'butterfly', 0, 0.2);
        // A covered puck held past the freeze gets played, as a whistle would have it.
        if (s.puck.owner === p.id && (p.coverTimer ?? 0) <= 0 && !input.passHeld) {
          const play = decideAI(s, p);
          if (play.pass) passPuck(s, p, play.passDir.x, play.passDir.z);
        }
      }
      if (input.dive && s.puck.owner !== p.id) startDive(s, p, input);
      if (input.check && s.puck.owner !== p.id && p.role !== 'G') {
        // RS up is a commitment gesture, not a world-space north aim. Backchecking toward
        // our own goal must drive the shoulder down-ice with the left stick and skating path.
        const aim =
            Math.hypot(skate.x, skate.z) > 0.18
              ? normalized(skate.x, skate.z)
              : Math.hypot(p.vx, p.vz) > 0.8
                ? normalized(p.vx, p.vz)
                : { x: Math.sin(p.angle), z: Math.cos(p.angle) },
          load = input.checkPower ?? 0;
        p.queuedCheck = launchCheck(s, p, aim.x, aim.z, load)
          ? null
          : { x: aim.x, z: aim.z, load, timer: PHYSICS.checkBuffer };
      } else if (p.queuedCheck) {
        // A flick thrown a hair early fires as soon as the body is free.
        const queued = p.queuedCheck;
        queued.timer -= dt;
        if (queued.timer <= 0 || s.puck.owner === p.id) p.queuedCheck = null;
        else if (launchCheck(s, p, queued.x, queued.z, queued.load)) p.queuedCheck = null;
      }
      if (input.chip) {
        if (s.puck.owner === p.id) chipPuck(s, p, input);
        else chopPuck(s, p, input);
      }
      if (input.saucer && s.puck.owner === p.id)
        passPuck(s, p, input.moveX, input.moveZ, PHYSICS.saucerLift);
      if (input.shoot && s.puck.owner === p.id)
        requestShot(
          s,
          p,
          input.shotPower,
          input.aimZ ?? 0,
          input.shotHeight ?? drive!.human.shotLift,
        );
      if (input.passRelease && s.puck.owner === p.id) passPuck(s, p, input.moveX, input.moveZ);
      if (input.poke) pokeCheck(s, p, input.moveX, input.moveZ);
      else if (input.pokeHeld) pokeCheck(s, p, input.moveX, input.moveZ, true);
    } else {
      if (!ai) continue;
      const tune = cpuTune(s, p);
      const cpu = backcheckScales(s, p, tune.speed, tune.speed);
      const push = p.role === 'G' ? savePush(p) : null;
      moveSkater(
        p,
        push?.x ?? ai.move.x,
        push?.z ?? ai.move.z,
        ai.hustle,
        ai.backskate,
        dt,
        carrying && !rushCarry,
        grip,
        cpu.push,
        cpu.speed,
      );
      if (p.role === 'G') trackSaveSide(p, previous[p.id].x, previous[p.id].z);
      else if (ai.check) launchCheck(s, p, ai.checkAim.x, ai.checkAim.z, ai.checkPower);
      if (ai.shoot && !p.pendingShot) shootPuck(s, p, ai.shotPower, ai.shotAim, ai.shotHeight);
      else if (ai.pass && !p.pendingShot) passPuck(s, p, ai.passDir.x, ai.passDir.z);
      if (ai.poke) pokeCheck(s, p, ai.pokeAim.x, ai.pokeAim.z, ai.pokeSweep);
    }
    updateRush(p, dt);
  }
  separatePlayers(s, previous);
  for (const p of s.skaters) if (p.pendingShot) advancePendingShot(s, p, dt);
  advancePuck(s, dt);
}
/**
 * One person's own skating and stick for one step, on its own: what a watcher can work out
 * about its skater before the host says. It is the slice of `stepMatch` that depends only on
 * the stick in that person's hands, so run from the host's last word through the presses the
 * host has not answered yet it lands where the host will. Nothing here touches anyone else,
 * the puck, or fires an action: contact, shots and calls are the host's alone.
 */
export function predictSkater(
  s: MatchState,
  p: Skater,
  input: InputFrame,
  human: Human,
  dt: number,
  carrying: boolean,
) {
  if (p.role === 'G') return;
  p.cooldown = Math.max(0, p.cooldown - dt);
  if (p.checkTimer > 0) p.checkTimer = Math.max(0, p.checkTimer - dt);
  p.downTimer = Math.max(0, p.downTimer - dt);
  p.stumbleTimer = Math.max(0, p.stumbleTimer - dt);
  p.diveTimer = Math.max(0, p.diveTimer - dt);
  const drag = !!input.toeDrag && carrying;
  const pull = drag ? clamp(input.stickY, 0, 1) : 0;
  if (!p.pendingShot) advanceStick(p, input.stickX, pull, dt, carrying);
  const grip = activeDeke(p)
    ? PHYSICS.dekeGrip
    : carrying
      ? PHYSICS.edgeGrip - clamp(Math.abs(p.stickSideVel) * 0.6, 0, 4)
      : PHYSICS.edgeGrip;
  if (carrying && Math.hypot(p.vx, p.vz) < 2.8)
    p.stride += dt * (1.8 + Math.abs(p.stickSide - STICK.restSide) * 1.2);
  if (p.downTimer > 0 || p.diveTimer > 0 || cellyRagdoll(p)) {
    moveSkater(p, 0, 0, false, false, dt);
    if (p.downTimer > 0 || cellyRagdoll(p)) p.rush = 0;
    return;
  }
  const skate = controlledSkate(s, p, input, human);
  const scales = backcheckScales(s, p, skate.push, 1);
  moveSkater(
    p,
    skate.x,
    skate.z,
    skate.hustle,
    skate.backskate,
    dt,
    carrying && !isBreakawayRush(s),
    grip,
    scales.push,
    scales.speed,
  );
  updateRush(p, dt);
}
export const isLivePhase = (phase: Phase) =>
  ['playing', 'faceoff', 'goal', 'paused'].includes(phase);
