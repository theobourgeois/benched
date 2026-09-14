import { attackDirection, RINK } from './config';
import { clamp, distance, normalized } from './math';
import { isOnIce } from './modes';
import type { MatchState, Skater, Vec2 } from './types';
export interface AIDecision {
  move: Vec2;
  shoot: boolean;
  pass: boolean;
  poke: boolean;
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
const facing = (p: Skater, x: number, z: number) => Math.sin(p.angle) * x + Math.cos(p.angle) * z;
function goalieOf(s: MatchState, team: number) {
  return s.skaters.find((p) => p.role === 'G' && p.team === team && isOnIce(s, p));
}
/** How open a look the carrier has: slot, angle, and whether the goalie is cheating. */
export function scoringLook(s: MatchState, p: Skater) {
  const dir = attackDirection(p.team, s.period),
    netX = attackNet(p.team, s.period);
  const dist = Math.hypot(netX - p.x, p.z);
  if (dir * p.x < 12.5 || dist > 16 || dir * p.x > RINK.goalX - 0.4) return 0;
  const goalie = goalieOf(s, p.team === 0 ? 1 : 0);
  const farSide = goalie ? Math.abs(p.z - goalie.z) : 1.2;
  const pressure = Math.max(0, 2.8 - nearestGap(s, p)) * 0.12;
  let look = 0;
  if (Math.abs(p.z) < 4.2 && dist < 11) look = 0.88;
  else if (Math.abs(p.z) < 6.6 && dist < 13.2) look = 0.56;
  else if (dist < 10) look = 0.3;
  else if (dir * p.x > 16 && dist < 14) look = 0.18;
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
function goalieTarget(s: MatchState, p: Skater): Vec2 {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck,
    netX = defendNet(p.team, s.period);
  const depth = clamp(0.5 + (16 - Math.abs(puck.x - netX)) * 0.07, 0.42, 1.85);
  return {
    x: netX + dir * depth,
    z: clamp(puck.z * clamp(0.26 + depth * 0.09, 0.24, 0.48), -1.32, 1.32),
  };
}
function carrierTarget(s: MatchState, p: Skater): Vec2 {
  const dir = attackDirection(p.team, s.period),
    lane = laneOf(p) || Math.sign(p.z || 1),
    press = nearestGap(s, p),
    zone = p.x * dir;
  if (zone < 8) {
    const wall = Math.abs(p.z) > 2.2 ? Math.sign(p.z) : lane;
    return { x: dir * 16, z: clamp(wall * 7.4, -10, 10) };
  }
  if (zone < 15) return { x: dir * 21, z: clamp(p.z * 0.28 + lane * 3.4, -7.6, 7.6) };
  if (press < 2.1) return { x: dir * 23.2, z: Math.sign(p.z || lane) * 8.8 };
  return { x: dir * 21.6, z: clamp(p.z * 0.22, -3.2, 3.2) };
}
function chaseTarget(s: MatchState, p: Skater, owner: Skater | null): Vec2 {
  const puck = s.puck;
  if (!owner || owner.role === 'G')
    return { x: puck.x + puck.vx * 0.14, z: puck.z + puck.vz * 0.14 };
  const netX = defendNet(p.team, s.period),
    gap = distance(p, owner);
  if (gap < 2.7) return { x: owner.x + owner.vx * 0.08, z: owner.z + owner.vz * 0.08 };
  const squeeze = clamp(gap / 8.5, 0.2, 0.52);
  return {
    x: owner.x * (1 - squeeze) + netX * squeeze + owner.vx * 0.1,
    z: owner.z * (1 - squeeze * 0.35) + owner.vz * 0.08,
  };
}
function supportTarget(s: MatchState, p: Skater, ours: boolean, hunters: Skater[]): Vec2 {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck,
    lane = laneOf(p),
    defense = isDefense(p),
    netX = defendNet(p.team, s.period);
  const inOwn = puck.x * dir < -7.5;
  if (ours) {
    const oz = puck.x * dir > 11;
    if (defense)
      return {
        x: clamp(dir * (oz ? 12.5 : puck.x * dir - 5), -22, 22),
        z: clamp(puck.z * 0.12 + lane * 6.8, -10, 10),
      };
    if (!oz)
      return {
        x: clamp(puck.x + dir * (p.role === 'C' ? 8 : 12.5), -22, 23),
        z: clamp(lane * 7.2, -10, 10),
      };
    if (p.role === 'C') return { x: dir * 22.2, z: clamp(puck.z * 0.12, -2.2, 2.2) };
    const strong = Math.sign(puck.z || lane) === lane || lane === 0;
    return strong
      ? { x: dir * 21.2, z: clamp(lane * 8.2, -10, 10) }
      : { x: dir * 22.4, z: clamp(lane * 4.2, -10, 10) };
  }
  if (puck.shot && puck.vx * dir < 0 && Math.abs(puck.x - netX) < 14) {
    return {
      x: netX + dir * (defense ? 3.2 : 5.5),
      z: clamp(puck.z * 0.45 + lane * (defense ? 2.4 : 3.8), -7.5, 7.5),
    };
  }
  if (inOwn)
    return {
      x: clamp(netX + dir * (defense ? 4.2 : 7.5), -23, 23),
      z: clamp(puck.z * 0.42 + lane * (defense ? 3.2 : 5.4), -8.2, 8.2),
    };
  if (hunters[1]?.id === p.id)
    return {
      x: clamp(puck.x - dir * 3.2, -22, 22),
      z: clamp(puck.z * 0.38 + lane * 3.4, -9, 9),
    };
  if (defense)
    return {
      x: clamp(puck.x - dir * 8.5, -22, 22),
      z: clamp(puck.z * 0.28 + lane * 5.1, -9.2, 9.2),
    };
  return {
    x: clamp(-dir * 3.5 + puck.x * 0.2, -20, 20),
    z: clamp(lane * 6.4 + puck.z * 0.12, -10, 10),
  };
}
function crashNet(s: MatchState, p: Skater): Vec2 | null {
  const dir = attackDirection(p.team, s.period),
    puck = s.puck;
  if (puck.owner !== null || !puck.shot || puck.vx * dir <= 2 || dir * puck.x < 12) return null;
  if (isDefense(p)) return { x: dir * 13.5, z: clamp(puck.z * 0.2 + laneOf(p) * 6, -9, 9) };
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
    zone = dir * p.x,
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
      if (zone < 13) target = { x: dir * 17.5, z: side * 4.2 };
      else if (zone < 19.2) {
        target = { x: dir * 21.8, z: -side * 1.1 };
        decision.stickX = -side * 0.82;
      } else {
        target = { x: dir * 23.4, z: -side * 0.45 };
        decision.stickX = -side;
      }
      decision.shotHeight = 0.74;
      break;
    case 'toeDrag':
      if (zone < 14.5) target = { x: dir * 19, z: side * 2.4 };
      else if (zone < 20.6) {
        target = { x: dir * 22.2, z: side * 2.9 };
        decision.stickX = side * 0.72;
        decision.toeDrag = true;
      } else {
        target = { x: dir * 23.5, z: -side * 1.15 };
        decision.stickX = -side * 0.95;
      }
      decision.shotHeight = 0.16;
      decision.shotPower = 0.32;
      break;
    case 'delay':
      if (zone < 15.5) target = { x: dir * 18.2, z: side * 1.4 };
      else if (zone < 20.2) {
        target = { x: p.x + dir * 1.1, z: -side * 0.55 };
        decision.hustle = false;
        decision.stickX = side * 0.55;
      } else {
        target = { x: dir * 23.6, z: -side * 1 };
        decision.stickX = -side * 0.88;
        decision.hustle = p.stamina > 0.2;
      }
      decision.shotHeight = 0.68;
      break;
    case 'wideDrive':
      if (zone < 13.5) target = { x: dir * 16.5, z: side * 7.6 };
      else if (zone < 19.8) {
        target = { x: dir * 21.2, z: side * 6.4 };
        decision.stickX = side * 0.45;
      } else {
        target = { x: dir * 23.2, z: side * 1.3 };
        decision.stickX = -side * 0.92;
      }
      decision.shotAim = -side * 0.7;
      break;
    case 'shelfFake':
      if (zone < 14.8) target = { x: dir * 18.8, z: side * 0.6 };
      else if (zone < 20) {
        target = { x: dir * 22, z: side * 2.3 };
        decision.stickX = side;
      } else {
        target = { x: dir * 23.5, z: -side * 1.7 };
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
  decision.shoot = p.cooldown <= 0 && facingNet && tight && zone > 19.2;
  return target;
}
/** A defender in the lane: pull the puck to the open side and cut around them instead of into them. */
function sidestep(s: MatchState, p: Skater, target: Vec2, decision: AIDecision) {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 2) return;
  const hx = p.vx / speed,
    hz = p.vz / speed;
  for (const foe of foes(s, p)) {
    const dx = foe.x - p.x,
      dz = foe.z - p.z,
      ahead = dx * hx + dz * hz,
      across = dx * hz - dz * hx;
    if (ahead < 0.6 || ahead > 4.5 || Math.abs(across) > 2) continue;
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
    decision = idle();
  decision.passDir = { x: dir, z: 0 };
  let target: Vec2;
  if (p.role === 'G') target = goalieTarget(s, p);
  else if (puck.owner === p.id) {
    const look = scoringLook(s, p),
      press = nearestGap(s, p),
      outlet = bestOutlet(s, p),
      zone = dir * p.x;
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
        (look >= 0.42 || (look >= 0.2 && press < 2.4 && zone > 16.5));
      const outletAhead = !!outlet && (outlet.x - p.x) * dir > 2.4;
      decision.pass =
        !decision.shoot &&
        p.cooldown <= 0 &&
        !!outlet &&
        (outletLook > look + 0.15 ||
          (press < 2.2 && outletAhead) ||
          (zone < 10 && outletAhead && press < 2.8));
      if (outlet) decision.passDir = { x: outlet.x - p.x, z: outlet.z - p.z };
      const goalie = goalieOf(s, p.team === 0 ? 1 : 0);
      decision.shotAim = goalie ? (goalie.z >= 0 ? -0.72 : 0.72) : Math.sin(s.tick * 0.17) * 0.7;
      decision.shotHeight = Math.sin(s.tick * 0.05 + p.id) > 0.35 ? 0.78 : 0.18;
      decision.shotPower = look > 0.7 ? 0.38 : 0.62;
      decision.hustle = p.stamina > 0.2 && (zone < 12 || press > 3.4);
    }
  } else {
    const mates = skaters(s, p);
    const hunters = [...mates].sort((a, b) => distance(a, puck) - distance(b, puck));
    const chaser = hunters[0];
    const rebound = crashNet(s, p);
    if (rebound) target = rebound;
    else if (!ours && chaser?.id === p.id) {
      target = chaseTarget(s, p, owner);
      if (owner && owner.role !== 'G' && p.cooldown <= 0 && distance(p, owner) < 2.8) {
        const toward = normalized(owner.x - p.x, owner.z - p.z),
          gap = distance(p, owner);
        const face = facing(p, toward.x, toward.z);
        decision.poke = distance(p, puck) < 1.15 && face > 0.35;
        // A real check needs closing speed, not a chase from behind, and some restraint: this
        // defender is in a hitting mood a little over half the time.
        const closing = (p.vx - owner.vx) * toward.x + (p.vz - owner.vz) * toward.z;
        const mood = Math.sin(s.tick * 0.011 + p.id * 2.3) > 0.55;
        decision.check =
          !decision.poke &&
          mood &&
          gap < 2.0 &&
          closing > (isDefense(p) ? 3.2 : 4.5) &&
          face > 0.55 &&
          p.stamina > 0.15;
        decision.checkAim = toward;
        decision.checkPower = isDefense(p) && closing > 6 ? 0.5 : 0;
      }
      decision.hustle =
        p.stamina > 0.18 && (distance(p, puck) > 4.5 || Math.hypot(puck.vx, puck.vz) > 6);
    } else target = supportTarget(s, p, ours, hunters);
    if (!ours && isDefense(p) && (target.x - p.x) * dir < 0) decision.backskate = true;
  }
  const d = distance(p, target),
    move = normalized(target.x - p.x, target.z - p.z);
  const scale = clamp(d / 2.1, 0, p.role === 'G' ? 0.68 : 1);
  decision.move = { x: move.x * scale, z: move.z * scale };
  if (p.role !== 'G' && !ours && puck.owner !== p.id && distance(p, puck) > 7 && p.stamina > 0.35)
    decision.hustle = decision.hustle || (isDefense(p) && puck.x * dir < -2);
  return decision;
}
