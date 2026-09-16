import { attackDirection, PHYSICS } from './config';
import { activeDeke } from './dekes';
import { cellyAirborne, cellyRagdoll } from './cellys';
import { clamp, turnToward } from './math';
import { isOnIce } from './modes';
import type { MatchState, Skater } from './types';

const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Carrier with a head of steam going to the net. Empty-handed skaters behind them cannot outrun this. */
export function rushingCarrier(s: MatchState): Skater | null {
  if (s.puck.owner === null) return null;
  const carrier = s.skaters[s.puck.owner];
  if (!carrier || carrier.role === 'G' || !isOnIce(s, carrier)) return null;
  const dir = attackDirection(carrier.team, s.period);
  if (carrier.vx * dir < PHYSICS.maxSpeed * 0.45) return null;
  return carrier;
}

/** True when this skater is chasing a rushing carrier from behind. */
export function isBackcheckingRush(s: MatchState, p: Skater): boolean {
  const carrier = rushingCarrier(s);
  if (!carrier || p.id === carrier.id || p.team === carrier.team || p.role === 'G') return false;
  if (!isOnIce(s, p) || p.downTimer > 0) return false;
  const dir = attackDirection(carrier.team, s.period);
  return (carrier.x - p.x) * dir > 0.2;
}

/** A rush with a beaten defender behind the carrier: open-ice stride, no catch-up from behind. */
export function isBreakawayRush(s: MatchState) {
  return s.skaters.some((p) => isBackcheckingRush(s, p));
}

/** Push and top-speed scales: beaten defenders cannot outskate a rushing carrier's open stride. */
export function backcheckScales(s: MatchState, p: Skater, push: number, speed: number) {
  if (!isBackcheckingRush(s, p)) return { push, speed };
  return { push: Math.min(push, 1), speed: Math.min(speed, 1) };
}

/** A shoulder thrown from behind a rush cannot use the lunge as a catch-up burst. */
export function backcheckLaunchCap(s: MatchState, p: Skater, cap: number) {
  if (!isBackcheckingRush(s, p)) return cap;
  return Math.min(cap, PHYSICS.hustleSpeed);
}

/** Shared locomotion for human and CPU skaters. Velocity owns the skating arc; facing can pivot
 * independently for backskating. Both forward push and lateral edge force have physical limits. */
export function skateVelocity(
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
  const mag = Math.min(1, Math.hypot(x, z));
  const speed = Math.hypot(p.vx, p.vz);
  const disabled =
    p.downTimer > 0 || p.diveTimer > 0 || p.stumbleTimer > 0 || cellyRagdoll(p) || cellyAirborne(p);
  const committed = p.checkTimer > PHYSICS.checkRecovery && !p.checkLanded;
  const goalie = p.role === 'G';
  const want = Math.atan2(x, z);
  const travel = speed > 0.05 ? Math.atan2(p.vx, p.vz) : want;
  const error = angleDelta(travel, want);
  const alignment = Math.cos(error);
  const sprint = hustle && !backskate && !disabled && !committed && mag > 0.8 && alignment > 0.94;
  // The extra pace only arrives once the skater has built speed and has room to open their stride.
  const effort = sprint ? clamp((speed - 3) / 4, 0, 1) * clamp(p.stamina / 0.18, 0, 1) : 0;
  p.stamina = clamp(
    p.stamina + (effort > 0 ? -PHYSICS.hustleDrain * effort : PHYSICS.staminaRecover) * dt,
    0,
    1,
  );
  let drive = 0,
    lean = 0;
  if (disabled || committed) {
    const drag = p.diveTimer > 0 ? 0.82 : p.downTimer > 0 ? 2.4 : committed ? 0.65 : 1.1;
    const decay = Math.exp(-drag * dt);
    p.vx *= decay;
    p.vz *= decay;
    // A committed shoulder follows its launch momentum. Left-stick input cannot cancel it or
    // steer it onto a dodging target. Stumbles likewise cannot be accelerated out of.
  } else if (goalie) {
    const max = PHYSICS.maxSpeed * 0.64 * speedScale;
    const scale = Math.max(1, Math.hypot(x, z));
    const blend = 1 - Math.exp(-2.6 * dt);
    p.vx += ((x / scale) * max - p.vx) * blend;
    p.vz += ((z / scale) * max - p.vz) * blend;
    drive = mag;
  } else if (mag > 0.05) {
    const stopping = alignment < PHYSICS.stopAlign && speed > 0.8;
    let nextSpeed: number, heading: number;
    if (stopping) {
      nextSpeed = Math.max(0, speed - PHYSICS.stopDeceleration * dt);
      heading = travel;
      lean = Math.sign(error || 1) * Math.min(1, speed / 7);
    } else {
      // A bounded lateral force gives a speed-dependent turning radius, rather than erasing
      // sideways velocity whenever the body rotates. Low-speed pivots remain responsive.
      const edge = ((PHYSICS.edgeAcceleration * grip) / PHYSICS.edgeGrip) * (1 - effort * 0.22);
      const turn =
        p.dekeKind === 'spin'
          ? 0
          : clamp(
              error,
              -Math.min(PHYSICS.pivotRate, edge / Math.max(speed, 1)) * dt,
              Math.min(PHYSICS.pivotRate, edge / Math.max(speed, 1)) * dt,
            );
      heading = travel + turn;
      const top =
        (PHYSICS.maxSpeed + (PHYSICS.hustleSpeed - PHYSICS.maxSpeed) * effort) *
        speedScale *
        (backskate ? PHYSICS.backskateSpeed : 1) *
        (carrying ? (effort > 0 ? PHYSICS.carryHustle : PHYSICS.carrySpeed) : 1);
      const target = top * mag;
      // Sharp cuts load the edges: acceleration resumes as the path lines up with the stick.
      const push =
        PHYSICS.skateAcceleration *
        pushScale *
        (backskate ? 0.8 : 1) *
        clamp(1 - Math.abs(error) / Math.PI, 0.3, 1);
      const acceleration = clamp(
        (target - speed) * 3,
        -(mag < 0.8 ? PHYSICS.stopDeceleration * 0.65 : 3),
        push,
      );
      nextSpeed = Math.max(
        0,
        speed + acceleration * dt - speed * Math.abs(turn) * PHYSICS.carveBleed,
      );
      drive =
        acceleration > 0 ? mag * (0.45 + (0.55 * acceleration) / PHYSICS.skateAcceleration) : 0;
      lean = ((turn / Math.max(dt, 0.0001)) * speed) / PHYSICS.edgeAcceleration;
    }
    p.vx = Math.sin(heading) * nextSpeed;
    p.vz = Math.cos(heading) * nextSpeed;
    if (p.dekeKind !== 'spin') {
      const face = stopping ? want : heading;
      p.angle = turnToward(
        p.angle,
        face + (backskate ? Math.PI : 0),
        1 - Math.exp(-PHYSICS.pivotRate * dt),
      );
    }
  } else {
    const decay = Math.exp(-PHYSICS.coastDrag * dt);
    p.vx *= decay;
    p.vz *= decay;
  }
  const deke = activeDeke(p);
  if (deke && !disabled && !committed && !goalie) {
    const current = Math.hypot(p.vx, p.vz);
    const heading = current > 0.1 ? Math.atan2(p.vx, p.vz) : p.angle;
    const top =
      (PHYSICS.maxSpeed + (PHYSICS.hustleSpeed - PHYSICS.maxSpeed) * effort) *
      speedScale *
      (carrying ? PHYSICS.carrySpeed : 1);
    const budget = Math.max(0, PHYSICS.skateAcceleration * dt - Math.max(0, current - speed));
    const surge =
      deke.surge < 0
        ? deke.surge * dt
        : Math.min(deke.surge * dt, budget, Math.max(0, top - current) * dt * 3);
    const cut =
      p.dekeKind === 'spin'
        ? 0
        : clamp((-p.dekeDir * deke.cut) / Math.max(current, 2), -3.6, 3.6) * dt;
    const next = Math.max(0, current + surge);
    p.vx = Math.sin(heading + cut) * next;
    p.vz = Math.cos(heading + cut) * next;
  }
  p.skateDrive += (drive - p.skateDrive) * (1 - Math.exp(-10 * dt));
  p.edgeLean += (clamp(lean, -1, 1) - p.edgeLean) * (1 - Math.exp(-12 * dt));
}
