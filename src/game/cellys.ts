import { clamp } from './math';
import type { CellyKind, MatchState, Skater } from './types';

export type CellyPose = {
  hop: number;
  yaw: number;
  lean: number;
  /** Extra backward pitch on the whole body, in radians. */
  pitch: number;
  dip: number;
  headYaw: number;
  twist: number;
  hipX: number;
  hipZ: number;
  hipDrop: number;
  bladeSide: number;
  bladeReach: number;
  bladeLift: number;
  handLift: number;
  releaseHand: number;
  /** Stick rotor angle for the helicopter celly. */
  rotor: number;
  ragdoll: boolean;
};

function ease(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function pulse(t: number, peak: number) {
  if (t <= peak) return ease(t / Math.max(peak, 1e-4));
  return 1 - ease((t - peak) / Math.max(1 - peak, 1e-4));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function cellyDuration(kind: CellyKind): number {
  switch (kind) {
    case 'helicopter':
      return 2.4;
    case 'jump':
      return 1.7;
    case 'limp':
      return 2.8;
    case 'dance':
      return 2.6;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function canStartCelly(s: MatchState, p: Skater) {
  if (s.phase !== 'goal' || s.scoringTeam !== p.team) return false;
  if (p.role === 'G' || p.downTimer > 0 || p.diveTimer > 0 || p.stumbleTimer > 0) return false;
  return !p.cellyKind;
}

export function hasActiveCelly(s: MatchState) {
  return s.skaters.some((p) => p.cellyKind);
}

export function cellyRagdoll(p: Skater) {
  return p.cellyKind === 'limp';
}

/** True while the jump celly is off the ice, so they keep momentum but cannot steer. */
export function cellyAirborne(p: Skater) {
  if (p.cellyKind !== 'jump') return false;
  const u = p.cellyTimer / cellyDuration('jump');
  return u > 0.14 && u < 0.82;
}

function helicopterPose(u: number): CellyPose {
  const spin = ease(clamp((u - 0.04) / 0.9, 0, 1));
  const hover = pulse(u, 0.18) * (1 - ease(clamp((u - 0.82) / 0.18, 0, 1)));
  return {
    hop: 0.7 * hover + 0.12 * Math.sin(u * Math.PI * 14) * hover,
    yaw: spin * Math.PI * 4.2,
    lean: 0.18 * Math.sin(u * Math.PI * 6) * hover,
    pitch: -0.55 * hover,
    dip: 0.2 * hover,
    headYaw: 0.7 * Math.sin(u * Math.PI * 8),
    twist: 0.4 * Math.sin(u * Math.PI * 5),
    hipX: 0.04 * Math.sin(u * Math.PI * 9),
    hipZ: -0.06 * hover,
    hipDrop: 0.04 * hover,
    bladeSide: 0,
    bladeReach: 0,
    bladeLift: 1.4 * hover,
    handLift: 0.55 * hover,
    releaseHand: hover,
    rotor: u * Math.PI * 18,
    ragdoll: false,
  };
}

function jumpPose(u: number): CellyPose {
  const crouch = u < 0.14 ? ease(u / 0.14) : 0;
  const flight = u < 0.14 ? 0 : Math.sin(Math.PI * clamp((u - 0.14) / 0.68, 0, 1));
  const land = ease(clamp((u - 0.82) / 0.18, 0, 1));
  const hop = flight * 2.45 - crouch * 0.08;
  return {
    hop,
    yaw: Math.PI * 2 * ease(clamp((u - 0.16) / 0.62, 0, 1)),
    lean: 0.35 * Math.sin(u * Math.PI * 3) * flight,
    pitch: -0.45 * flight + 0.2 * land,
    dip: crouch * 0.85 + flight * 0.55 + land * 0.4,
    headYaw: 0.5 * Math.sin(flight * Math.PI * 2),
    twist: 0.55 * flight,
    hipX: 0,
    hipZ: -0.08 * flight,
    hipDrop: 0.06 * flight,
    bladeSide: mix(0, -0.42, flight),
    bladeReach: mix(0, -0.55, flight),
    bladeLift: 1.15 * flight,
    handLift: 0.42 * flight,
    releaseHand: 0.35 * flight,
    rotor: 0,
    ragdoll: false,
  };
}

function limpPose(): CellyPose {
  return {
    hop: 0,
    yaw: 0,
    lean: 0,
    pitch: 0,
    dip: 0,
    headYaw: 0,
    twist: 0,
    hipX: 0,
    hipZ: 0,
    hipDrop: 0,
    bladeSide: 0,
    bladeReach: 0,
    bladeLift: 0,
    handLift: 0,
    releaseHand: 1,
    rotor: 0,
    ragdoll: true,
  };
}

function dancePose(u: number): CellyPose {
  const in_ = ease(clamp(u / 0.1, 0, 1));
  const out = 1 - ease(clamp((u - 0.88) / 0.12, 0, 1));
  const on = in_ * out;
  const wiggle = u * Math.PI;
  return {
    hop: 0.16 * Math.abs(Math.sin(wiggle * 7)) * on,
    yaw: 0.55 * Math.sin(wiggle * 3.4) * on + u * Math.PI * 1.35,
    lean: 0.72 * Math.sin(wiggle * 5.2) * on,
    pitch: 0.18 * Math.sin(wiggle * 4) * on,
    dip: (0.45 + 0.4 * Math.abs(Math.sin(wiggle * 7))) * on,
    headYaw: 0.85 * Math.sin(wiggle * 6.1) * on,
    twist: 0.8 * Math.sin(wiggle * 4.6) * on,
    hipX: 0.16 * Math.sin(wiggle * 5.2) * on,
    hipZ: 0.1 * Math.sin(wiggle * 3.1) * on,
    hipDrop: 0.07 * Math.abs(Math.sin(wiggle * 7)) * on,
    bladeSide: 0.7 * Math.sin(wiggle * 4.2) * on,
    bladeReach: 0.35 * Math.sin(wiggle * 3.6) * on - 0.2 * on,
    bladeLift: 0.55 * (0.4 + 0.6 * Math.abs(Math.sin(wiggle * 5))) * on,
    handLift: 0.22 * Math.abs(Math.sin(wiggle * 5)) * on,
    releaseHand: 0.55 * on,
    rotor: 0,
    ragdoll: false,
  };
}

export function sampleCelly(kind: CellyKind, u: number): CellyPose {
  const t = clamp(u, 0, 1);
  switch (kind) {
    case 'helicopter':
      return helicopterPose(t);
    case 'jump':
      return jumpPose(t);
    case 'limp':
      return limpPose();
    case 'dance':
      return dancePose(t);
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function activeCelly(p: Skater): CellyPose | null {
  if (!p.cellyKind) return null;
  return sampleCelly(p.cellyKind, p.cellyTimer / cellyDuration(p.cellyKind));
}

export function startCelly(p: Skater, kind: CellyKind) {
  p.cellyKind = kind;
  p.cellyTimer = 0;
  if (kind === 'limp') p.fallAngle = p.angle;
  return true;
}

export function clearCelly(p: Skater) {
  p.cellyKind = null;
  p.cellyTimer = 0;
}

export function stepCelly(p: Skater, dt: number) {
  if (!p.cellyKind) return null;
  const duration = cellyDuration(p.cellyKind);
  const before = sampleCelly(p.cellyKind, p.cellyTimer / duration);
  p.cellyTimer += dt;
  if (p.cellyKind === 'dance') {
    p.stride += dt * 16;
    p.skateDrive = Math.max(p.skateDrive, 0.88);
  }
  if (p.cellyTimer >= duration) {
    const end = sampleCelly(p.cellyKind, 1);
    p.angle += end.yaw - before.yaw;
    clearCelly(p);
    return end;
  }
  const after = sampleCelly(p.cellyKind, p.cellyTimer / duration);
  p.angle += after.yaw - before.yaw;
  return after;
}
