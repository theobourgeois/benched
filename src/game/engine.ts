import { attackDirection, EMPTY_INPUT, PHYSICS, PUCK, RINK, RULES, STICK } from './config';
import { activeDeke, classifyOneTouch, clearDeke, startDeke, stepDeke } from './dekes';
import { decideAI } from './ai';
import { DEFAULT_MATCHUP, type Club } from './clubs';
import { skateVelocity } from './skating';
import { clamp, constrainToRink, distance, normalized } from './math';
import { isOnIce, modeInfo, SHOOTOUT_ROUNDS } from './modes';
import type {
  DekeSpecial,
  GameEvent,
  GameMode,
  InputFrame,
  MatchState,
  Phase,
  Skater,
  Team,
  Vec2,
} from './types';
export { isOnIce } from './modes';
const ROLES = ['C', 'LW', 'RW', 'LD', 'RD', 'G'] as const;
export function createMatch(
  homeTeam: Team = 0,
  mode: GameMode = 'exhibition',
  teams: [Club, Club] = DEFAULT_MATCHUP,
): MatchState {
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
    },
    controlled: homeTeam * 6,
    homeTeam,
    teams,
    scoringTeam: null,
    shotCharge: 0,
    shotAim: 0,
    shotLift: 0,
    passHeld: false,
    passAim: { x: 0, z: 0 },
    passTarget: null,
    passRange: 0,
    tick: 0,
    hitstop: 0,
    events: [],
    notice: '',
    noticeTimer: 0,
    possession: [0, 0],
    drawInput: -1,
    shootoutShooter: homeTeam,
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
        stickSide: STICK.restSide,
        stickReach: STICK.restReach,
        stickSideVel: 0,
        stickReachVel: 0,
        shotTimer: 0,
        passTimer: 0,
        diveTimer: 0,
        blockTimer: 0,
        liftTimer: 0,
        dekeKind: null,
        dekeTimer: 0,
        dekeDir: 0,
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
    p.stickSide = STICK.restSide;
    p.stickReach = STICK.restReach;
    p.stickSideVel = 0;
    p.stickReachVel = 0;
    p.shotTimer = 0;
    p.passTimer = 0;
    p.diveTimer = 0;
    p.blockTimer = 0;
    p.liftTimer = 0;
    clearDeke(p);
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
  });
  s.controlled = s.homeTeam * 6;
  s.shotCharge = 0;
  s.shotAim = 0;
  s.shotLift = 0;
  s.passHeld = false;
  s.passAim = { x: 0, z: 0 };
  s.passTarget = null;
  s.passRange = 0;
  s.drawInput = -1;
  s.hitstop = 0;
  for (const p of s.skaters) {
    if (isOnIce(s, p)) continue;
    p.x = 0;
    p.z = 40 + p.id;
  }
  if (s.mode === 'freeSkate') {
    const you = s.skaters[s.controlled];
    you.x = 0;
    you.z = 0;
    givePuck(s, you);
  }
  if (s.mode === 'shootout') setupShootoutAttempt(s);
}
export function emit(s: MatchState, type: GameEvent['type'], power = 1, at?: Vec2) {
  s.events.push({ id: (s.events.at(-1)?.id ?? 0) + 1, type, power, x: at?.x, z: at?.z });
  if (s.events.length > 32) s.events.shift();
}
export function startMatch(s: MatchState) {
  if (!modeInfo(s.mode).faceoff) {
    s.phase = 'playing';
    s.countdown = 0;
    s.drawInput = -1;
    return;
  }
  s.phase = 'faceoff';
  s.countdown = RULES.faceoffSeconds;
  s.drawInput = -1;
}
function givePuck(s: MatchState, p: Skater) {
  s.puck.owner = p.id;
  s.puck.lastTouch = p.team;
  s.puck.shot = false;
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
  const youShoot = s.shootoutShooter === s.homeTeam;
  const keeper = s.skaters.find((p) => p.team === s.homeTeam && p.role === 'G');
  s.controlled = youShoot ? shooter.id : (keeper?.id ?? s.homeTeam * 6);
  notice(s, youShoot ? 'YOUR SHOT' : 'THEIR SHOT');
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
  if (s.shootoutShooter === s.homeTeam) s.shootoutRound++;
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
function notice(s: MatchState, value: string) {
  s.notice = value;
  s.noticeTimer = 1.5;
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
  const dir = attackDirection(p.team, s.period),
    post = RINK.goalHalfWidth - 0.16;
  return {
    x: dir * RINK.goalX,
    y: 0.14 + clamp(height, 0, 1) * (RINK.goalHeight - 0.22),
    z: clamp(aim, -1, 1) * post,
  };
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
  const target = pose ?? stickCarryTarget(stickX, pull);
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
function resolveFaceoff(s: MatchState) {
  const home = s.skaters[s.homeTeam * 6],
    away = s.skaters[(1 - s.homeTeam) * 6];
  const timed = s.drawInput >= 0 && s.drawInput <= 0.42,
    early = s.drawInput > 0.42;
  const won = timed || (!early && s.drawInput < 0 && Math.sin(s.tick * 12.989) > 0);
  const winner = won ? home : away,
    loser = won ? away : home;
  s.puck.owner = winner.id;
  s.puck.lastTouch = winner.team;
  s.puck.shot = false;
  s.puck.lockout = 0;
  const tip = stickTip(winner);
  s.puck.x = tip.x;
  s.puck.z = tip.z;
  s.puck.vx = winner.vx;
  s.puck.vz = winner.vz;
  if (winner.team === s.homeTeam) s.controlled = winner.id;
  winner.cooldown = 0.1;
  loser.cooldown = 0.32;
  s.drawInput = -1;
  notice(s, winner.team === s.homeTeam ? 'DRAW WON' : 'DRAW LOST');
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
export function switchSkater(s: MatchState) {
  const owner = s.puck.owner;
  if (owner !== null && s.skaters[owner].team === s.homeTeam) {
    s.controlled = owner;
    return;
  }
  const options = s.skaters.filter(
    (p) =>
      isOnIce(s, p) &&
      p.team === s.homeTeam &&
      p.role !== 'G' &&
      p.downTimer <= 0 &&
      p.id !== s.controlled,
  );
  if (!options.length) return;
  const from = owner !== null ? s.skaters[owner] : s.puck;
  const netX = -attackDirection(s.homeTeam, s.period) * RINK.goalX;
  s.controlled = options.reduce((best, p) =>
    switchCost(p, from, netX) < switchCost(best, from, netX) ? p : best,
  ).id;
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
  puck.vx = v.x * speed + p.vx * 0.23;
  puck.vz = v.z * speed + p.vz * 0.23;
  puck.y = origin?.y ?? 0.15;
  puck.vy = lift;
  puck.lockout = 0.16;
  puck.lastTouch = p.team;
  puck.shot = shot;
  p.cooldown = 0.55;
}
export function shootPuck(s: MatchState, p: Skater, power: number, aim = 0, height = 0.25) {
  if (s.puck.owner !== p.id || p.downTimer > 0 || p.stumbleTimer > 0) return;
  const oneTimer = p.passTimer > 0;
  power = clamp(power + (oneTimer ? 0.28 : 0), 0, 1);
  const tip = stickTip(p),
    backhand = p.stickSide < 0,
    target = netShotTarget(s, p, aim, height);
  const dx = target.x - tip.x,
    dz = target.z - tip.z,
    v = normalized(dx, dz);
  const origin = {
    x: tip.x + v.x * 0.32,
    z: tip.z + v.z * 0.32,
    y: 0.15 + clamp(height, 0, 1) * 0.42,
  };
  const speed =
    PHYSICS.shotSpeed * (0.66 + power * 0.45) * (oneTimer ? 1.08 : 1) * (backhand ? 0.88 : 1);
  const travel = Math.max(0.06, Math.hypot(target.x - origin.x, target.z - origin.z) / speed);
  const loft = Math.min(12, (target.y - origin.y + 4.9 * travel * travel) / travel);
  releasePuck(s, p, dx, dz, speed, loft, true, origin);
  p.shotTimer = oneTimer ? 0.22 : 0.34;
  p.passTimer = 0;
  s.shots[p.team]++;
  s.shotCharge = 0;
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
function applyPassAim(s: MatchState, p: Skater, input: InputFrame) {
  const aiming =
    s.puck.owner === p.id &&
    (input.passHeld || input.passRelease) &&
    p.downTimer <= 0 &&
    p.stumbleTimer <= 0;
  if (!aiming) {
    s.passHeld = false;
    s.passAim = { x: 0, z: 0 };
    s.passTarget = null;
    s.passRange = 0;
    return;
  }
  const lane = passLane(s, p, input.moveX, input.moveZ);
  s.passHeld = true;
  s.passAim = lane.aim;
  s.passTarget = lane.target?.id ?? null;
  s.passRange = lane.range;
}
export function passPuck(s: MatchState, p: Skater, mx: number, mz: number, loft = 0) {
  if (s.puck.owner !== p.id || p.downTimer > 0 || p.stumbleTimer > 0) return;
  const lane = passLane(s, p, mx, mz);
  releasePuck(s, p, lane.dx, lane.dz, PHYSICS.passSpeed * (loft > 0 ? 0.92 : 1), loft, false);
  if (lane.target && p.team === s.homeTeam) s.controlled = lane.target.id;
  s.passHeld = false;
  s.passAim = { x: 0, z: 0 };
  s.passTarget = null;
  s.passRange = 0;
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
  p.shotTimer = 0.22;
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
  p.cooldown = 0.4;
  p.stickReach += PHYSICS.pokeExtend;
  emit(s, 'hit', 0.22);
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
  p.diveTimer = PHYSICS.diveTime;
  p.cooldown = PHYSICS.diveTime;
  p.stickReach += 0.5;
  p.stamina = clamp(p.stamina - 0.14, 0, 1);
  notice(s, 'DIVE');
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
    cap = PHYSICS.hustleSpeed + PHYSICS.checkLungeCap;
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
  if (p.team === s.homeTeam) s.controlled = p.id;
  emit(s, 'hit', 0.18);
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
function pokeCheck(s: MatchState, p: Skater, sweep = false) {
  if (p.cooldown > 0 || p.downTimer > 0 || p.stumbleTimer > 0 || p.diveTimer > 0) return;
  p.cooldown = sweep ? 0.32 : 0.45;
  p.stickReach += PHYSICS.pokeExtend + (sweep ? PHYSICS.sweepReach : 0);
  const owner = s.puck.owner !== null ? s.skaters[s.puck.owner] : null;
  if (!owner || owner.team === p.team) return;
  const toPuck = normalized(s.puck.x - p.x, s.puck.z - p.z);
  if (facing(p, toPuck.x, toPuck.z) < 0.22) return;
  if (distance(stickTip(p), s.puck) > PHYSICS.pokeReach + (sweep ? PHYSICS.sweepReach : 0)) return;
  const toPoker = normalized(p.x - owner.x, p.z - owner.z);
  // Body between the stick and the puck: you have to wrap around the shield.
  const shielded =
    facing(owner, toPoker.x, toPoker.z) < 0.18 &&
    distance(p, s.puck) > distance(owner, s.puck) + 0.12;
  if (shielded) return;
  const pose = activeDeke(owner);
  if (pose && pose.hop > 0.12) return;
  const v = normalized(s.puck.x - p.x, s.puck.z - p.z);
  s.puck.owner = null;
  s.puck.vx = v.x * 5.2;
  s.puck.vz = v.z * 5.2;
  s.puck.lockout = 0.22;
  s.puck.shot = false;
  emit(s, 'hit', 0.2);
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
) {
  const speedNow = Math.hypot(p.vx, p.vz);
  skateVelocity(p, x, z, hustle, backskate, dt, carrying, grip);
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
  if (s.mode === 'freeSkate' && scoringTeam !== s.homeTeam) return false;
  if (s.mode === 'shootout' && scoringTeam !== s.shootoutShooter) return false;
  if (s.mode !== 'freeSkate') s.score[scoringTeam]++;
  s.scoringTeam = scoringTeam;
  s.phase = 'goal';
  s.countdown = s.mode === 'freeSkate' ? 1.6 : s.mode === 'shootout' ? 2.2 : RULES.goalSeconds;
  s.puck.vx = 0;
  s.puck.vz = 0;
  s.puck.vy = 0;
  emit(s, 'goal');
  return true;
}
function teamAttackingNet(sign: number, period: number): Team {
  return (attackDirection(0, period) === sign ? 0 : 1) as Team;
}
function goalieSave(s: MatchState, player: Skater) {
  const p = s.puck,
    defending = attackDirection(player.team, s.period);
  const side = Math.sign(p.z - player.z || Math.sin(s.tick * 0.7));
  p.vx = defending * (6.2 + Math.abs(p.vx) * 0.22);
  p.vz = side * (3.6 + Math.abs(p.z - player.z) * 4.5) + (p.z - player.z) * 3;
  p.vy = p.y > 0.7 ? 1.35 : 0.55;
  p.lockout = 0.28;
  p.shot = false;
  p.lastTouch = player.team;
  emit(s, 'save');
  notice(s, 'PAD SAVE');
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
    p.x = owner.x + forwardX * owner.stickReach + forwardZ * owner.stickSide;
    p.z = owner.z + forwardZ * owner.stickReach - forwardX * owner.stickSide;
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
        if (!defendingGoalie || distance(defendingGoalie, p) > 1.28) {
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
  // Swept goal-line crossing prevents fast shots tunnelling through the goal mouth.
  for (const sign of [-1, 1]) {
    const line = sign * RINK.goalX;
    if (oldX * sign < RINK.goalX && p.x * sign >= RINK.goalX) {
      const t = (line - oldX) / (p.x - oldX),
        z = oldZ + (p.z - oldZ) * t,
        y = oldY + (p.y - oldY) * t;
      if (Math.abs(z) < RINK.goalHalfWidth - 0.12 && y < RINK.goalHeight - 0.06) {
        if (goal(s, teamAttackingNet(sign, s.period))) return;
      }
      if (
        (Math.abs(Math.abs(z) - RINK.goalHalfWidth) < 0.22 && y < RINK.goalHeight + 0.1) ||
        (Math.abs(z) < RINK.goalHalfWidth && Math.abs(y - RINK.goalHeight) < 0.18)
      ) {
        p.x = oldX;
        p.vx *= -0.78;
        p.shot = false;
        emit(s, 'post');
        notice(s, 'OFF THE IRON');
      }
    }
    // Back and side netting: entering from behind never counts as a goal.
    if (
      p.x * sign > RINK.goalX &&
      p.x * sign < RINK.goalX + 1.5 &&
      Math.abs(p.z) < RINK.goalHalfWidth &&
      p.y < RINK.goalHeight
    ) {
      if (oldX * sign >= RINK.goalX + 1.5) {
        p.x = sign * (RINK.goalX + 1.52);
        p.vx *= -0.4;
      } else {
        p.z = Math.sign(oldZ || 1) * (RINK.goalHalfWidth + 0.12);
        p.vz *= -0.4;
      }
    }
  }
  if (shootoutAttemptOver(s)) return;
  const normal = constrainToRink(p, 0.16);
  if (normal) {
    const dot = p.vx * normal.x + p.vz * normal.z;
    if (dot < 0) {
      p.vx -= 1.72 * dot * normal.x;
      p.vz -= 1.72 * dot * normal.z;
      if (Math.abs(dot) > 8) emit(s, 'hit', 0.15);
    }
  }
  for (const player of s.skaters) {
    if (
      player.role !== 'G' ||
      !isOnIce(s, player) ||
      player.downTimer > 0 ||
      player.stumbleTimer > 0 ||
      p.y > 1.7 ||
      p.lockout > 0
    )
      continue;
    const dist = distance(player, p),
      lateral = Math.abs(p.z - player.z);
    if (dist > 1.52) continue;
    const reach = 1.08 + Math.min(0.28, Math.hypot(p.vx, p.vz) * 0.006);
    if (lateral > reach && dist > 0.9) continue;
    goalieSave(s, player);
    return;
  }
  for (const player of s.skaters) {
    if (
      !isOnIce(s, player) ||
      player.role === 'G' ||
      player.downTimer > 0 ||
      (player.diveTimer <= 0 && player.blockTimer <= 0)
    )
      continue;
    const diving = player.diveTimer > 0;
    if (p.y > (diving ? 1.15 : 0.85)) continue;
    const reach = diving ? 1.48 : 1.12;
    if (distance(player, p) > reach && puckReach(player, p) > reach) continue;
    const away = normalized(p.x - player.x, p.z - player.z),
      incoming = Math.hypot(p.vx, p.vz);
    p.vx = away.x * (4.2 + incoming * 0.28) + player.vx * 0.2;
    p.vz = away.z * (4.2 + incoming * 0.28) + player.vz * 0.2;
    p.vy = diving ? 1.1 : 0.45;
    p.shot = false;
    p.lockout = 0.18;
    emit(s, 'hit', diving ? 0.35 : 0.22);
    notice(s, diving ? 'DIVE BLOCK' : 'BLOCK');
    return;
  }
  if (p.lockout > 0 || p.y > 0.65) return;
  const incoming = Math.hypot(p.vx, p.vz);
  const candidates = s.skaters.filter(
    (player) =>
      isOnIce(s, player) &&
      player.role !== 'G' &&
      player.downTimer <= 0 &&
      player.diveTimer <= 0 &&
      player.stumbleTimer <= 0 &&
      player.cooldown <= 0 &&
      puckReach(player, p) < PHYSICS.pickupRadius,
  );
  candidates.sort((a, b) => puckReach(a, p) - puckReach(b, p));
  const you = candidates.find((player) => player.id === s.controlled);
  let player = candidates[0];
  if (you && player && puckReach(you, p) < puckReach(player, p) + 0.38) player = you;
  if (player) {
    // Hard shots deflect off bodies; slower pucks can be collected cleanly.
    if (p.shot && incoming > 18) {
      if (distance(player, p) < 0.72) {
        p.vx *= 0.45;
        p.vz += (player.z > p.z ? -1 : 1) * 5;
        p.shot = false;
        p.lockout = 0.14;
        emit(s, 'hit', 0.2);
      }
    } else {
      if (incoming > 8 && !p.shot && p.lastTouch === player.team) player.passTimer = 0.42;
      p.owner = player.id;
      p.lastTouch = player.team;
      p.shot = false;
      player.cooldown = 0.15;
      if (player.team === s.homeTeam) s.controlled = player.id;
    }
  }
}
/** Pure fixed-step simulation. It has no React, browser, rendering or audio dependencies. */
export function stepMatch(s: MatchState, input: InputFrame = EMPTY_INPUT, dt = RULES.fixedStep) {
  if (input.pause) {
    togglePause(s);
    return;
  }
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
    if (s.drawInput < 0 && (input.pass || input.poke)) s.drawInput = s.countdown;
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
    }
    return;
  }
  if (s.hitstop > 0) {
    s.hitstop = Math.max(0, s.hitstop - dt);
    return;
  }
  if (modeInfo(s.mode).timed) {
    s.clock = Math.max(0, s.clock - dt);
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
  if (input.switchPlayer) {
    if (!stickLift(s, s.skaters[s.controlled])) switchSkater(s);
  } else if (input.pass && (s.puck.owner === null || s.skaters[s.puck.owner].team !== s.homeTeam))
    switchSkater(s);
  const youCarry = s.puck.owner === s.controlled;
  s.shotCharge =
    !input.toeDrag &&
    !input.deke &&
    !input.dekeSpecial &&
    !s.skaters[s.controlled].dekeKind &&
    input.stickY > 0.3 &&
    youCarry
      ? clamp(s.shotCharge + dt * 1.8, 0, 1)
      : Math.max(0, s.shotCharge - dt * 2);
  if (youCarry && !input.toeDrag) {
    s.shotAim = clamp(input.aimZ ?? 0, -1, 1);
    s.shotLift = clamp(input.shotHeight ?? 0, 0, 1);
  } else {
    s.shotAim = 0;
    s.shotLift = 0;
  }
  applyPassAim(s, s.skaters[s.controlled], input);
  const controlledThisStep = s.controlled;
  const previous = s.skaters.map((p) => ({ x: p.x, z: p.z }));
  // Every CPU sees the same pre-movement frame, regardless of its roster index.
  const decisions = s.skaters.map((p) =>
    p.id !== controlledThisStep && isOnIce(s, p) ? decideAI(s, p) : null,
  );
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
    p.passTimer = Math.max(0, p.passTimer - dt);
    p.diveTimer = Math.max(0, p.diveTimer - dt);
    p.blockTimer = Math.max(0, p.blockTimer - dt);
    p.liftTimer = Math.max(0, p.liftTimer - dt);
    stepDeke(p, dt);
    if (p.downTimer > 0 || p.diveTimer > 0 || s.puck.owner !== p.id) clearDeke(p);
    const controlled = p.id === controlledThisStep;
    if (controlled && s.puck.owner === p.id) tryStartDeke(p, input);
    const drag = controlled && input.toeDrag && s.puck.owner === p.id;
    const ai = decisions[p.id];
    const side = controlled ? input.stickX : ai?.stickX || Math.sin(s.tick * 0.025 + p.id) * 0.35;
    const pull = drag ? clamp(input.stickY, 0, 1) : ai?.toeDrag ? 0.82 : 0;
    const carrying = s.puck.owner === p.id;
    advanceStick(p, side, pull, dt, carrying);
    const grip = activeDeke(p)
      ? PHYSICS.dekeGrip
      : carrying
        ? PHYSICS.edgeGrip - clamp(Math.abs(p.stickSideVel) * 0.6, 0, 4)
        : PHYSICS.edgeGrip;
    if (s.puck.owner === p.id && Math.hypot(p.vx, p.vz) < 2.8)
      p.stride += dt * (1.8 + Math.abs(p.stickSide - STICK.restSide) * 1.2);
    if (p.downTimer > 0 || p.diveTimer > 0) {
      moveSkater(p, 0, 0, false, false, dt);
      if (p.downTimer > 0) p.rush = 0;
      continue;
    }
    if (p.id === controlledThisStep) {
      if (input.block) p.blockTimer = 0.16;
      moveSkater(p, input.moveX, input.moveZ, input.hustle, input.backskate, dt, carrying, grip);
      if (input.dive && s.puck.owner !== p.id) startDive(s, p, input);
      if (input.check && s.puck.owner !== p.id) {
        // RS up is a commitment gesture, not a world-space north aim. Backchecking toward
        // our own goal must drive the shoulder down-ice with the left stick and skating path.
        const aim =
            Math.hypot(input.moveX, input.moveZ) > 0.18
              ? normalized(input.moveX, input.moveZ)
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
        shootPuck(s, p, input.shotPower, input.aimZ ?? 0, input.shotHeight ?? s.shotLift);
      if (input.passRelease && s.puck.owner === p.id) passPuck(s, p, input.moveX, input.moveZ);
      if (input.poke) pokeCheck(s, p);
      else if (input.pokeHeld) pokeCheck(s, p, true);
    } else {
      if (!ai) continue;
      moveSkater(p, ai.move.x, ai.move.z, ai.hustle, ai.backskate, dt, carrying, grip);
      if (p.role === 'G')
        p.angle = attackDirection(p.team, s.period) > 0 ? Math.PI / 2 : -Math.PI / 2;
      else {
        if (ai.check) launchCheck(s, p, ai.checkAim.x, ai.checkAim.z, ai.checkPower);
      }
      if (ai.shoot) shootPuck(s, p, ai.shotPower, ai.shotAim, ai.shotHeight);
      else if (ai.pass) passPuck(s, p, ai.passDir.x, ai.passDir.z);
      if (ai.poke) pokeCheck(s, p);
    }
    updateRush(p, dt);
  }
  separatePlayers(s, previous);
  advancePuck(s, dt);
}
export const isLivePhase = (phase: Phase) =>
  ['playing', 'faceoff', 'goal', 'paused'].includes(phase);
