import { attackDirection, GOALIE, PHYSICS, RINK, RINKS } from './config';
import { cpuTune } from './difficulty';
import { angleLine, committed, goalieFrame, onPads } from './goalie';
import { clamp, distance, normalized } from './math';
import { isOnIce } from './modes';
import type { MatchState, Skater, Vec2 } from './types';
export interface AIDecision {
  move: Vec2;
  shoot: boolean;
  pass: boolean;
  poke: boolean;
  /** Held poke: a sweep from the hip instead of a jab from their back. */
  pokeSweep: boolean;
  /** Where the poke is jabbed, as a left stick would aim it. */
  pokeAim: Vec2;
  hustle: boolean;
  backskate: boolean;
  passDir: Vec2;
  shotAim: number;
  shotHeight: number;
  shotPower: number;
  stickX: number;
  toeDrag: boolean;
  /** Commit to a body check this step. */
  check: boolean;
  checkAim: Vec2;
  checkPower: number;
}
const idle = (): AIDecision => ({
  move: { x: 0, z: 0 },
  shoot: false,
  pass: false,
  poke: false,
  pokeSweep: false,
  pokeAim: { x: 0, z: 0 },
  hustle: false,
  backskate: false,
  passDir: { x: 0, z: 0 },
  shotAim: 0,
  shotHeight: 0.25,
  shotPower: 0.4,
  stickX: 0,
  toeDrag: false,
  check: false,
  checkAim: { x: 0, z: 0 },
  checkPower: 0,
});
const laneOf = (p: Skater) =>
  p.role === 'LW' || p.role === 'LD' ? -1 : p.role === 'RW' || p.role === 'RD' ? 1 : 0;
const isDefense = (p: Skater) => p.role === 'LD' || p.role === 'RD';
const skaters = (s: MatchState, p: Skater) =>
  s.skaters.filter((o) => isOnIce(s, o) && o.team === p.team && o.role !== 'G' && o.downTimer <= 0);
const foes = (s: MatchState, p: Skater) =>
  s.skaters.filter((o) => isOnIce(s, o) && o.team !== p.team && o.role !== 'G' && o.downTimer <= 0);
const nearestGap = (s: MatchState, p: Skater) =>
  foes(s, p).reduce((d, o) => Math.min(d, distance(p, o)), 99);
const attackNet = (team: number, period: number) => attackDirection(team, period) * RINK.goalX;
const defendNet = (team: number, period: number) => -attackNet(team, period);
/**
 * The spots below were laid out on the barn, and stay written in its coordinates. `deep` slides
 * one along the ice with the goal line, so the slot is the same distance from the net on every
 * sheet; `wide` stretches a lane with the boards, so wingers use the room a wider sheet gives
 * them. `zoneOf` is the other way round: how far up ice a skater is, read as if on the barn.
 * On the barn all three change nothing.
 */
const deep = (x: number) => x + (RINK.goalX - RINKS.barn.goalX);
const wide = (z: number) => z * (RINK.halfWidth / RINKS.barn.halfWidth);
const zoneOf = (p: Vec2, dir: number) => dir * p.x - (RINK.goalX - RINKS.barn.goalX);
const facing = (p: Skater, x: number, z: number) => Math.sin(p.angle) * x + Math.cos(p.angle) * z;
function goalieOf(s: MatchState, team: number) {
  return s.skaters.find((p) => p.role === 'G' && p.team === team && isOnIce(s, p));
}
/** How open a look the carrier has: slot, angle, and whether the goalie is cheating. */
export function scoringLook(s: MatchState, p: Skater) {
  const dir = attackDirection(p.team, s.period),
    netX = attackNet(p.team, s.period);
  const dist = Math.hypot(netX - p.x, p.z);
  if (zoneOf(p, dir) < 12.5 || dist > 16 || dir * p.x > RINK.goalX - 0.4) return 0;
  const goalie = goalieOf(s, p.team === 0 ? 1 : 0);
  const farSide = goalie ? Math.abs(p.z - goalie.z) : 1.2;
  const pressure = Math.max(0, 2.8 - nearestGap(s, p)) * 0.12;
  let look = 0;
  if (Math.abs(p.z) < 4.2 && dist < 11) look = 0.88;
  else if (Math.abs(p.z) < 6.6 && dist < 13.2) look = 0.56;
  else if (dist < 10) look = 0.3;
  else if (zoneOf(p, dir) > 16 && dist < 14) look = 0.18;
  look += clamp(farSide - 0.55, 0, 0.35);
  return clamp(look - pressure, 0, 1);
}
function bestOutlet(s: MatchState, p: Skater) {
  const dir = attackDirection(p.team, s.period);
  let best: Skater | null = null,
    score = -1e3;
  for (const q of skaters(s, p)) {
    if (q.id === p.id) continue;
    const open = nearestGap(s, q);
    const ahead = (q.x - p.x) * dir;
    if (open < 1.45 && scoringLook(s, q) < 0.5) continue;
    if (p.x * dir < 10 && ahead < 1.5) continue;
    const dx = q.x - p.x,
      dz = q.z - p.z,
      lengthSq = dx * dx + dz * dz;
    const blocked = foes(s, p).some((o) => {
      const t = ((o.x - p.x) * dx + (o.z - p.z) * dz) / Math.max(lengthSq, 0.01);
      return t > 0.08 && t < 0.92 && Math.hypot(o.x - p.x - t * dx, o.z - p.z - t * dz) < 1.3;
    });
    if (blocked) continue;
    const value =
      scoringLook(s, q) * 9 +
      open * 1.15 +
      ahead * 0.55 -
      distance(p, q) * 0.16 -
      (q.role === 'G' ? 8 : 0);
    if (value > score) {
      score = value;
      best = q;
    }
  }
  return best;
}
/**
 * Where the goalie stands: on the angle line from the puck, out far enough to cut the angle on a
 * distant shooter and deep when the play is in tight or a pass across is on.
 * Behind the goal line they hug the near post; a slow loose puck nobody else can reach gets covered.
 */
function goalieTarget(s: MatchState, p: Skater): Vec2 {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck,
    netX = defendNet(p.team, s.period),
    tune = cpuTune(s, p),
    owner = puck.owner === null ? null : s.skaters[puck.owner];
  if (owner?.id === p.id) return { x: p.x, z: p.z };
  const postZ = RINK.goalHalfWidth - 0.35;
  if (!owner && Math.hypot(puck.vx, puck.vz) < GOALIE.coverSpeed) {
    // A dribbler in the crease: get on it before a forward does, then freeze it.
    const gap = distance(p, puck),
      threat = foes(s, p).reduce((d, o) => Math.min(d, distance(o, puck)), 99);
    if (gap < 2.6 && (puck.x - netX) * dir > -0.3 && threat > gap + 0.25)
      return { x: puck.x, z: puck.z };
  }
  // Lead a carrier's hands; a released shot is already on its way and the read handles it.
  const lead = owner ? GOALIE.lead : 0.06,
    px = puck.x + puck.vx * lead,
    pz = puck.z + puck.vz * lead;
  const ahead = (px - netX) * dir;
  if (ahead < 0.35) return { x: netX + dir * 0.35, z: Math.sign(pz || 1) * postZ };
  const range = Math.hypot(ahead, pz);
  // Never further out than halfway to a puck near the goal line: on a sharp angle the post is home.
  let depth = Math.min(
    clamp(GOALIE.depthMin + range * GOALIE.depthRate, GOALIE.depthMin, 1.6) * tune.depth,
    Math.max(0.35, ahead * 0.5),
  );
  // A far-side attacker in the slot means a one-timer across: stay deeper, ready to push.
  if (owner && owner.team !== p.team && Math.abs(owner.z) > 2) {
    const backdoor = foes(s, p).some(
      (o) =>
        o.id !== owner.id &&
        Math.sign(o.z) !== Math.sign(owner.z) &&
        Math.abs(o.z) < 4 &&
        (o.x - netX) * dir < 8,
    );
    if (backdoor) depth *= 0.72;
  }
  // The angle line is already square. A slow tracker lags inside it; nobody gains by cheating past it.
  const z = clamp(angleLine(ahead, pz, depth) * Math.min(1, tune.track), -postZ - 0.3, postZ + 0.3);
  return { x: netX + dir * depth, z };
}
/** With the puck under them: hold it a beat, then find a defender or dump it up the wall. */
function goaliePlayPuck(s: MatchState, p: Skater, decision: AIDecision) {
  const dir = attackDirection(p.team, s.period),
    press = nearestGap(s, p);
  if (p.cooldown > 0 || ((p.coverTimer ?? 0) > 0 && press > 2.4)) return;
  let best: Skater | null = null,
    score = -1e3;
  for (const q of skaters(s, p)) {
    const open = nearestGap(s, q),
      dx = q.x - p.x,
      dz = q.z - p.z,
      lengthSq = dx * dx + dz * dz;
    if (open < 1.6 || lengthSq < 4) continue;
    const blocked = foes(s, p).some((o) => {
      const t = ((o.x - p.x) * dx + (o.z - p.z) * dz) / Math.max(lengthSq, 0.01);
      return t > 0.08 && t < 0.92 && Math.hypot(o.x - p.x - t * dx, o.z - p.z - t * dz) < 1.3;
    });
    if (blocked) continue;
    const value = open * 1.2 + Math.min(dx * dir, 12) * 0.25 - Math.sqrt(lengthSq) * 0.1;
    if (value > score) {
      score = value;
      best = q;
    }
  }
  decision.pass = true;
  decision.passDir = best
    ? { x: best.x - p.x, z: best.z - p.z }
    : { x: dir, z: Math.sign(p.z || (s.tick % 2 ? 1 : -1)) * 0.9 };
}
/** A carrier in tight walks into the paddle: jab when the puck comes within reach. */
function goaliePoke(s: MatchState, p: Skater, owner: Skater | null, decision: AIDecision) {
  if (!owner || owner.team === p.team || p.cooldown > 0 || committed(p)) return;
  const puck = s.puck,
    { side, depth } = goalieFrame(p, puck.x, puck.z),
    tune = cpuTune(s, p);
  const mood = Math.sin(s.tick * 0.017 + p.id * 1.7) > 0.35 / tune.bite;
  decision.poke = mood && depth > 0.2 && depth < 1.3 && Math.abs(side) < 0.9;
  decision.pokeAim = pokeAimAt(s, p, puck, tune.bite);
}
function carrierTarget(s: MatchState, p: Skater): Vec2 {
  const dir = attackDirection(p.team, s.period),
    lane = laneOf(p) || Math.sign(p.z || 1),
    press = nearestGap(s, p),
    zone = zoneOf(p, dir);
  if (zone < 8) {
    const wall = Math.abs(p.z) > 2.2 ? Math.sign(p.z) : lane;
    return { x: dir * deep(16), z: clamp(wall * wide(7.4), -wide(10), wide(10)) };
  }
  if (zone < 15) return { x: dir * deep(21), z: clamp(p.z * 0.28 + lane * 3.4, -7.6, 7.6) };
  if (press < 2.1) return { x: dir * deep(23.2), z: Math.sign(p.z || lane) * wide(8.8) };
  return { x: dir * deep(21.6), z: clamp(p.z * 0.22, -3.2, 3.2) };
}
/** Toward the slot: take away the middle instead of matching a wide cut. */
function insideOf(owner: Skater, fallback: number) {
  return Math.sign(-owner.z) || fallback;
}

/** Stay on a hip we already have so we don't skate through the carrier to swap sides. */
function wrapSide(p: Skater, owner: Skater) {
  if (Math.abs(p.z - owner.z) > 0.5) return Math.sign(p.z - owner.z);
  return insideOf(owner, p.id % 2 === 0 ? 1 : -1);
}

const AI_POKE_PATIENCE = 0.65,
  AI_POKE_WOBBLE = 0.5;
/** A CPU pokes at the puck with a hand that is only as steady as its bite. */
function pokeAimAt(s: MatchState, p: Skater, puck: Vec2, bite: number): Vec2 {
  const angle =
    Math.atan2(puck.x - p.x, puck.z - p.z) +
    Math.sin(s.tick * 0.23 + p.id * 3.1) * AI_POKE_WOBBLE * clamp(1.5 - bite * 0.5, 0.5, 1.4);
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

/**
 * The carrier's body sits across the line from the poker to the puck. Standing beside them, or
 * reaching past their hip, is not a shield; reaching through their back is.
 */
export function pokeShielded(p: Vec2, owner: Vec2, puck: Vec2) {
  const dx = puck.x - p.x,
    dz = puck.z - p.z,
    lengthSq = Math.max(dx * dx + dz * dz, 1e-6),
    t = clamp(((owner.x - p.x) * dx + (owner.z - p.z) * dz) / lengthSq, 0, 1);
  return (
    t > 0.05 &&
    t < 0.95 &&
    Math.hypot(p.x + dx * t - owner.x, p.z + dz * t - owner.z) < PHYSICS.pokeShield
  );
}
function chaseTarget(s: MatchState, p: Skater, owner: Skater | null): Vec2 {
  const puck = s.puck;
  if (!owner || owner.role === 'G')
    return { x: puck.x + puck.vx * 0.14, z: puck.z + puck.vz * 0.14 };
  const dir = attackDirection(p.team, s.period),
    gap = distance(p, owner),
    goalSide = (owner.x - p.x) * dir,
    ownerSpeed = Math.hypot(owner.vx, owner.vz),
    side = wrapSide(p, owner),
    inside = insideOf(owner, side),
    tune = cpuTune(s, p);
  if (goalSide < 1.5) {
    // Beaten: angle to the puck. Matching their z is how a magnet follows every cut;
    // skating onto their spine is how a CPU freezes when the carrier stops.
    if (gap < 3.0) {
      const lead = ownerSpeed > 3 ? clamp(gap / PHYSICS.maxSpeed, 0.05, 0.2) * tune.lead : 0;
      return {
        x: owner.x + owner.vx * lead - dir * 0.75,
        z: clamp(owner.z + side * 1.05 + owner.vz * lead * 0.2, -wide(11), wide(11)),
      };
    }
    const lead = clamp(gap / PHYSICS.maxSpeed, 0.08, 0.36) * tune.lead;
    return {
      x: owner.x + owner.vx * lead * 0.7 - dir * Math.min(0.35, gap * 0.04),
      z: clamp(owner.z * 0.82 + owner.vz * 0.05 + inside * 0.7, -wide(11), wide(11)),
    };
  }
  // Still between them and the net: hold a gap and shade the slot, don't glue to their hip.
  const cushion = clamp(1.7 + Math.min(gap, 6) * 0.18, 1.7, 3.8) * tune.gap;
  return {
    x: owner.x - dir * cushion,
    z: clamp(owner.z * 0.48 + owner.vz * 0.05, -wide(8.2), wide(8.2)),
  };
}

function pressureCarrier(s: MatchState, p: Skater, owner: Skater, decision: AIDecision) {
  const puck = s.puck,
    gap = distance(p, owner),
    tune = cpuTune(s, p);
  if (p.cooldown > 0 || owner.role === 'G' || gap > 3.1) return;
  const dir = attackDirection(p.team, s.period),
    toward = normalized(owner.x - p.x, owner.z - p.z),
    toPuck = normalized(puck.x - p.x, puck.z - p.z),
    faceBody = facing(p, toward.x, toward.z),
    facePuck = facing(p, toPuck.x, toPuck.z),
    beside = Math.abs(p.z - owner.z) > 0.55,
    behind = (owner.x - p.x) * dir < 0.4,
    ownerSpeed = Math.hypot(owner.vx, owner.vz),
    closing = (p.vx - owner.vx) * toward.x + (p.vz - owner.vz) * toward.z,
    speed = Math.hypot(p.vx, p.vz);
  if (beside || !behind) {
    const hx = speed > 0.4 ? p.vx / speed : Math.sin(p.angle),
      hz = speed > 0.4 ? p.vz / speed : Math.cos(p.angle),
      across = (owner.x - p.x) * hz - (owner.z - p.z) * hx;
    decision.stickX = clamp(-Math.sign(across || wrapSide(p, owner)) * 0.82, -1, 1);
  }
  const pokeLook =
    !pokeShielded(p, owner, puck) &&
    distance(p, puck) < 1.7 * (0.72 + 0.28 * tune.bite) &&
    facePuck > 0.18 &&
    (beside || !behind);
  // An aimed poke takes the puck, so a CPU picks its moments instead of jabbing on every cooldown.
  const pokeMood =
    Math.sin(s.tick * 0.019 + p.id * 1.3) > Math.min(0.9, AI_POKE_PATIENCE + (1 - tune.bite) * 0.3);
  decision.poke = pokeLook && pokeMood;
  decision.pokeSweep = decision.poke && beside && ownerSpeed < 3.5;
  decision.pokeAim = pokeAimAt(s, p, puck, tune.bite);
  const mood = Math.sin(s.tick * 0.011 + p.id * 2.3) > 0.2 / tune.bite;
  const bumpSlow = ownerSpeed < 2.6 && beside && gap < 1.9 && closing > 0.4;
  decision.check =
    !pokeLook &&
    mood &&
    gap < 2.15 * (0.78 + 0.22 * tune.bite) &&
    p.stamina > 0.12 &&
    ((closing > (isDefense(p) ? 3.2 : 4.5) / tune.bite && faceBody > 0.55) || bumpSlow);
  decision.checkAim = toward;
  decision.checkPower = isDefense(p) && closing > 6 ? 0.5 : 0;
}
function supportTarget(s: MatchState, p: Skater, ours: boolean, hunters: Skater[]): Vec2 {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck,
    lane = laneOf(p),
    defense = isDefense(p),
    netX = defendNet(p.team, s.period);
  const inOwn = puck.x * dir < -deep(7.5);
  const owner = puck.owner === null ? null : s.skaters[puck.owner];
  if (ours) {
    const oz = zoneOf(puck, dir) > 11;
    if (defense)
      return {
        x: clamp(dir * (oz ? deep(12.5) : puck.x * dir - 5), -deep(22), deep(22)),
        z: clamp(puck.z * 0.12 + lane * wide(6.8), -wide(10), wide(10)),
      };
    if (!oz)
      return {
        x: clamp(puck.x + dir * (p.role === 'C' ? 8 : 12.5), -deep(22), deep(23)),
        z: clamp(lane * wide(7.2), -wide(10), wide(10)),
      };
    if (p.role === 'C') return { x: dir * deep(22.2), z: clamp(puck.z * 0.12, -2.2, 2.2) };
    const strong = Math.sign(puck.z || lane) === lane || lane === 0;
    return strong
      ? { x: dir * deep(21.2), z: clamp(lane * wide(8.2), -wide(10), wide(10)) }
      : { x: dir * deep(22.4), z: clamp(lane * 4.2, -10, 10) };
  }
  if (puck.shot && puck.vx * dir < 0 && Math.abs(puck.x - netX) < 14) {
    return {
      x: netX + dir * (defense ? 3.2 : 5.5),
      z: clamp(puck.z * 0.45 + lane * (defense ? 2.4 : 3.8), -7.5, 7.5),
    };
  }
  if (defense && owner && !ours) {
    // Protect a useful gap and the middle of the rink while the other defender pressures.
    const depth = clamp(3 + Math.max(0, -owner.vx * dir) * 0.32, 3, 6);
    return {
      x: clamp(owner.x - dir * depth, -deep(22), deep(22)),
      z: clamp(owner.z * 0.62 + lane * 2.1, -wide(8.5), wide(8.5)),
    };
  }
  if (inOwn)
    return {
      x: clamp(netX + dir * (defense ? 4.2 : 7.5), -deep(23), deep(23)),
      z: clamp(puck.z * 0.42 + lane * (defense ? 3.2 : 5.4), -wide(8.2), wide(8.2)),
    };
  if (hunters[1]?.id === p.id)
    return {
      x: clamp(puck.x - dir * 3.2, -deep(22), deep(22)),
      z: clamp(puck.z * 0.38 + lane * 3.4, -wide(9), wide(9)),
    };
  if (defense)
    return {
      x: clamp(puck.x - dir * 8.5, -deep(22), deep(22)),
      z: clamp(puck.z * 0.28 + lane * wide(5.1), -wide(9.2), wide(9.2)),
    };
  return {
    x: clamp(-dir * 3.5 + puck.x * 0.2, -deep(20), deep(20)),
    z: clamp(lane * wide(6.4) + puck.z * 0.12, -wide(10), wide(10)),
  };
}
function crashNet(s: MatchState, p: Skater): Vec2 | null {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck;
  if (puck.owner !== null || !puck.shot || puck.vx * dir <= 2 || zoneOf(puck, dir) < 12)
    return null;
  if (isDefense(p))
    return {
      x: dir * deep(13.5),
      z: clamp(puck.z * 0.2 + laneOf(p) * wide(6), -wide(9), wide(9)),
    };
  return {
    x: dir * (RINK.goalX - 2.15),
    z: clamp(puck.z * 0.5 + laneOf(p) * 1.35, -2.6, 2.6),
  };
}
type BreakawayMove = 'cutIn' | 'toeDrag' | 'delay' | 'wideDrive' | 'shelfFake';
function breakawayMove(s: MatchState, p: Skater): BreakawayMove {
  const pick = (s.shootoutRound * 4 + s.shootoutTaken[p.team] + p.id * 3) % 5;
  switch (pick) {
    case 0:
      return 'cutIn';
    case 1:
      return 'toeDrag';
    case 2:
      return 'delay';
    case 3:
      return 'wideDrive';
    default:
      return 'shelfFake';
  }
}
/** In-tight shootout rush: cut, toe-drag, delay, or fake before releasing. */
function shootoutBreakaway(s: MatchState, p: Skater, decision: AIDecision): Vec2 {
  const dir = attackDirection(p.team, s.period),
    zone = zoneOf(p, dir),
    goalie = goalieOf(s, p.team === 0 ? 1 : 0),
    move = breakawayMove(s, p),
    side = move === 'wideDrive' || move === 'delay' ? -1 : 1;
  const facingNet = facing(p, dir, 0) > 0.08;
  decision.hustle = zone < 16.5 && p.stamina > 0.12;
  decision.shotPower = 0.38;
  decision.shotHeight = 0.55;
  decision.shotAim = -side * 0.78;
  let target: Vec2;
  switch (move) {
    case 'cutIn':
      if (zone < 13) target = { x: dir * deep(17.5), z: side * 4.2 };
      else if (zone < 19.2) {
        target = { x: dir * deep(21.8), z: -side * 1.1 };
        decision.stickX = -side * 0.82;
      } else {
        target = { x: dir * deep(23.4), z: -side * 0.45 };
        decision.stickX = -side;
      }
      decision.shotHeight = 0.74;
      break;
    case 'toeDrag':
      if (zone < 14.5) target = { x: dir * deep(19), z: side * 2.4 };
      else if (zone < 20.6) {
        target = { x: dir * deep(22.2), z: side * 2.9 };
        decision.stickX = side * 0.72;
        decision.toeDrag = true;
      } else {
        target = { x: dir * deep(23.5), z: -side * 1.15 };
        decision.stickX = -side * 0.95;
      }
      decision.shotHeight = 0.16;
      decision.shotPower = 0.32;
      break;
    case 'delay':
      if (zone < 15.5) target = { x: dir * deep(18.2), z: side * 1.4 };
      else if (zone < 20.2) {
        target = { x: p.x + dir * 1.1, z: -side * 0.55 };
        decision.hustle = false;
        decision.stickX = side * 0.55;
      } else {
        target = { x: dir * deep(23.6), z: -side * 1 };
        decision.stickX = -side * 0.88;
        decision.hustle = p.stamina > 0.2;
      }
      decision.shotHeight = 0.68;
      break;
    case 'wideDrive':
      if (zone < 13.5) target = { x: dir * deep(16.5), z: side * 7.6 };
      else if (zone < 19.8) {
        target = { x: dir * deep(21.2), z: side * 6.4 };
        decision.stickX = side * 0.45;
      } else {
        target = { x: dir * deep(23.2), z: side * 1.3 };
        decision.stickX = -side * 0.92;
      }
      decision.shotAim = -side * 0.7;
      break;
    case 'shelfFake':
      if (zone < 14.8) target = { x: dir * deep(18.8), z: side * 0.6 };
      else if (zone < 20) {
        target = { x: dir * deep(22), z: side * 2.3 };
        decision.stickX = side;
      } else {
        target = { x: dir * deep(23.5), z: -side * 1.7 };
        decision.stickX = -side;
      }
      decision.shotHeight = 0.84;
      decision.shotPower = 0.44;
      break;
    default: {
      const _exhaustive: never = move;
      return _exhaustive;
    }
  }
  if (goalie && zone > 17.5) {
    const open = Math.abs(p.z - goalie.z) > 0.35 ? Math.sign(p.z - goalie.z) : -side;
    decision.shotAim = clamp(open * 0.86, -1, 1);
  }
  const netDist = Math.hypot(dir * RINK.goalX - p.x, p.z);
  const onDoorstep = !!goalie && distance(p, goalie) < 3.5 && zone > 18.5;
  const tight = zone > 21.4 || netDist < 4.1 || onDoorstep;
  const tune = cpuTune(s, p);
  decision.shotAim = clamp(
    decision.shotAim + Math.sin(s.tick * 0.03 + p.id) * (tune.wobble - 0.32),
    -1,
    1,
  );
  decision.shoot = p.cooldown <= 0 && facingNet && tight && zone > 19.2;
  return target;
}
/** A defender in the lane: pull the puck to the open side and cut around them instead of into them. */
function sidestep(s: MatchState, p: Skater, target: Vec2, decision: AIDecision) {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 2) return;
  const tune = cpuTune(s, p);
  if (tune.handle < 1 && Math.sin(s.tick * 0.019 + p.id) > tune.handle * 2 - 1) return;
  const hx = p.vx / speed,
    hz = p.vz / speed;
  for (const foe of foes(s, p)) {
    const dx = foe.x - p.x,
      dz = foe.z - p.z,
      ahead = dx * hx + dz * hz,
      across = dx * hz - dz * hx;
    if (ahead < 0.6 || ahead > 4.5 * tune.handle || Math.abs(across) > 2) continue;
    const side = across >= 0 ? 1 : -1;
    // Player-space right is −across; the skill stick's +X is the player's right.
    decision.stickX = side * 0.85;
    target.x = p.x + hx * 4 - side * hz * 3.2;
    target.z = p.z + hz * 4 + side * hx * 3.2;
    return;
  }
}
/** Team-aware positioning: angling, support lanes, slot coverage, rebound crashes, and patient looks. */
export function decideAI(s: MatchState, p: Skater): AIDecision {
  if (p.downTimer > 0) return idle();
  const dir = attackDirection(p.team, s.period),
    puck = s.puck,
    owner = puck.owner === null ? null : s.skaters[puck.owner],
    ours = owner?.team === p.team,
    decision = idle(),
    tune = cpuTune(s, p);
  decision.passDir = { x: dir, z: 0 };
  let target: Vec2;
  if (p.role === 'G') {
    target = goalieTarget(s, p);
    if (puck.owner === p.id) goaliePlayPuck(s, p, decision);
    else goaliePoke(s, p, owner, decision);
    // A play in tight that has got away from the stance gets the explosive push, not a shuffle.
    const near = Math.hypot(puck.x - p.x, puck.z - p.z) < 9;
    decision.hustle = near && distance(p, target) > GOALIE.pushGap && !onPads(p);
  } else if (puck.owner === p.id) {
    const look = scoringLook(s, p),
      press = nearestGap(s, p),
      outlet = bestOutlet(s, p),
      zone = zoneOf(p, dir);
    target = carrierTarget(s, p);
    const facingNet = facing(p, dir, 0) > 0.08;
    if (s.mode === 'shootout') target = shootoutBreakaway(s, p, decision);
    else {
      sidestep(s, p, target, decision);
      const outletLook = outlet ? scoringLook(s, outlet) : 0;
      decision.shoot =
        p.cooldown <= 0 &&
        facingNet &&
        zone > 13 &&
        (look >= tune.shootLook || (look >= tune.shootPress && press < 2.4 && zone > 16.5));
      const outletAhead = !!outlet && (outlet.x - p.x) * dir > 2.4;
      decision.pass =
        !decision.shoot &&
        p.cooldown <= 0 &&
        !!outlet &&
        (outletLook > look + 0.15 / tune.pass ||
          (press < 2.2 && outletAhead) ||
          (zone < 10 && outletAhead && press < 2.8));
      if (outlet) decision.passDir = { x: outlet.x - p.x, z: outlet.z - p.z };
      const goalie = goalieOf(s, p.team === 0 ? 1 : 0);
      const far = goalie ? (goalie.z >= 0 ? -0.58 : 0.58) : 0;
      decision.shotAim = clamp(far + Math.sin(s.tick * 0.03 + p.id) * tune.wobble, -1, 1);
      decision.shotHeight = Math.sin(s.tick * 0.05 + p.id) > 0.35 ? 0.78 : 0.18;
      decision.shotPower = look > 0.7 ? 0.38 : 0.62;
      const route = normalized(target.x - p.x, target.z - p.z);
      const openLane = !foes(s, p).some((o) => {
        const ahead = (o.x - p.x) * route.x + (o.z - p.z) * route.z;
        const across = (o.x - p.x) * route.z - (o.z - p.z) * route.x;
        return ahead > 0 && ahead < 8 && Math.abs(across) < 2.8;
      });
      decision.hustle =
        p.stamina > 0.2 / tune.hustle && press > 4 && openLane && Math.abs(decision.stickX) < 0.5;
    }
  } else {
    const mates = skaters(s, p);
    const pursuitCost = (q: Skater) => {
      if (!owner || ours) return distance(q, puck);
      const goalSide = (owner.x - q.x) * dir;
      return distance(q, owner) + (goalSide < 0 ? -goalSide * 0.7 : 0);
    };
    const hunters = [...mates].sort((a, b) => pursuitCost(a) - pursuitCost(b));
    const chaser = hunters[0];
    const rebound = crashNet(s, p);
    if (rebound) target = rebound;
    else if (!ours && chaser?.id === p.id) {
      target = chaseTarget(s, p, owner);
      if (owner) pressureCarrier(s, p, owner, decision);
      const mark = owner ?? puck,
        gap = distance(p, mark),
        markSpeed = Math.hypot(mark.vx, mark.vz);
      // Catch a rush, but don't sprint into the back of a stopped carrier.
      decision.hustle =
        p.stamina > 0.18 / tune.hustle &&
        (gap > 3.4 / tune.hustle || markSpeed > 5.5 / tune.hustle) &&
        !(owner && markSpeed < 2.8 && gap < 2.6);
    } else target = supportTarget(s, p, ours, hunters);
    if (!ours && owner && (isDefense(p) || chaser?.id === p.id)) {
      const goalSide = (owner.x - p.x) * dir;
      const rushSpeed = Math.max(0, -owner.vx * dir);
      const retreatSpeed = Math.max(0, -p.vx * dir);
      const projectedGap = goalSide - Math.max(0, rushSpeed - retreatSpeed) * 0.6;
      decision.backskate =
        goalSide > 2.5 &&
        projectedGap > 2 &&
        (rushSpeed < PHYSICS.maxSpeed * PHYSICS.backskateSpeed || goalSide > 6) &&
        (target.x - p.x) * dir < 0;
      if (!decision.backskate && (goalSide < 3 || rushSpeed > 7)) {
        const gap = distance(p, owner);
        decision.hustle =
          p.stamina > 0.18 / tune.hustle && (goalSide > 0 || rushSpeed > 4 || gap > 2.8);
      }
    }
  }
  // A goalie steers for where their own momentum will not carry them past, or a push overshoots.
  if (p.role === 'G')
    target = { x: target.x - p.vx * GOALIE.brake, z: target.z - p.vz * GOALIE.brake };
  const d = distance(p, target),
    move = normalized(target.x - p.x, target.z - p.z);
  const chasing = !ours && puck.owner !== p.id && p.role !== 'G';
  const ease = p.role === 'G' ? 0.7 : puck.owner === p.id ? 1.7 : chasing ? tune.chaseEase : 2.1;
  const scale = clamp(d / ease, 0, 1);
  decision.move = { x: move.x * scale, z: move.z * scale };
  if (p.role !== 'G' && !ours && puck.owner !== p.id && distance(p, puck) > 7 && p.stamina > 0.35)
    decision.hustle = decision.hustle || (isDefense(p) && puck.x * dir < -2);
  return decision;
}
