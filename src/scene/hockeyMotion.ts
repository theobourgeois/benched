import { MathUtils } from 'three';
import { PHYSICS } from '../game/config';
import { activeDeke, dekeDuration } from '../game/dekes';
import type { Skater } from '../game/types';

const { clamp, lerp, smoothstep } = MathUtils;
type Key = readonly [time: number, value: number];
type Track = readonly Key[];

/** Cubic Hermite tracks with shared tangents. Keys are editable poses, time is normalized. */
export function sampleTrack(keys: Track, time: number): number {
  if (time <= keys[0][0]) return keys[0][1];
  const last = keys.length - 1;
  if (time >= keys[last][0]) return keys[last][1];
  for (let i = 0; i < last; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (time > b[0]) continue;
    const before = keys[Math.max(0, i - 1)],
      after = keys[Math.min(last, i + 2)];
    const span = b[0] - a[0],
      t = (time - a[0]) / span;
    const m0 = i === 0 ? 0 : ((b[1] - before[1]) / (b[0] - before[0])) * span;
    const m1 = i + 1 === last ? 0 : ((after[1] - a[1]) / (after[0] - a[0])) * span;
    const t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * a[1] +
      (t3 - 2 * t2 + t) * m0 +
      (-2 * t3 + 3 * t2) * b[1] +
      (t3 - t2) * m1
    );
  }
  return keys[last][1];
}

// Contact -> loaded glide -> lateral extension -> recovery under the hip -> contact.
// The supporting blade travels along its edge; the recovering blade is lifted and turned in.
const FORWARD = {
  x: [
    [0, 0],
    [0.22, -0.035],
    [0.48, 0.09],
    [0.66, 0.38],
    [0.79, 0.25],
    [0.92, -0.025],
    [1, 0],
  ],
  z: [
    [0, 0.23],
    [0.25, 0.08],
    [0.48, -0.17],
    [0.66, -0.4],
    [0.82, -0.22],
    [1, 0.23],
  ],
  y: [
    [0, 0],
    [0.6, 0],
    [0.7, 0.035],
    [0.82, 0.17],
    [0.94, 0.045],
    [1, 0],
  ],
  yaw: [
    [0, 0.05],
    [0.34, 0.1],
    [0.62, 0.64],
    [0.76, 0.46],
    [0.92, -0.12],
    [1, 0.05],
  ],
  pitch: [
    [0, 0],
    [0.58, 0],
    [0.71, 0.28],
    [0.84, 0.12],
    [1, 0],
  ],
  weight: [
    [0, 0.8],
    [0.12, 1],
    [0.44, 1],
    [0.66, 0],
    [0.91, 0],
    [1, 0.8],
  ],
  push: [
    [0, 0],
    [0.3, 0],
    [0.51, 1],
    [0.68, 0],
    [1, 0],
  ],
} satisfies Record<string, Track>;

export interface SkateStep {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  weight: number;
  push: number;
}

export function sampleForwardStride(
  side: number,
  phase: number,
  drive: number,
  stance: number,
  out: SkateStep,
) {
  const t = ((phase % 1) + 1) % 1;
  out.x = side * (stance + sampleTrack(FORWARD.x, t) * drive);
  out.z = 0.015 + sampleTrack(FORWARD.z, t) * drive;
  out.y = Math.max(0, sampleTrack(FORWARD.y, t)) * drive;
  out.yaw = side * lerp(0.08, sampleTrack(FORWARD.yaw, t), drive);
  out.pitch = Math.max(0, sampleTrack(FORWARD.pitch, t)) * drive;
  out.weight = lerp(1, clamp(sampleTrack(FORWARD.weight, t), 0, 1), drive);
  out.push = Math.max(0, sampleTrack(FORWARD.push, t)) * drive;
}

const RELEASE = {
  sweep: [
    [0, 0],
    [0.22, 1],
    [0.5, 0.8],
    [1, 0],
  ],
  lift: [
    [0, 0],
    [0.25, 0.4],
    [0.48, 0.65],
    [1, 0],
  ],
  transfer: [
    [0, -0.3],
    [0.2, 1],
    [0.5, 0.75],
    [1, 0],
  ],
} satisfies Record<string, Track>;
const CHECK = {
  load: [
    [0, 0],
    [0.13, 0.7],
    [0.32, 1],
    [0.58, 0.65],
    [1, 0],
  ],
  shoulder: [
    [0, 0],
    [0.16, 0.35],
    [0.38, 1],
    [0.67, 0.85],
    [1, 0],
  ],
} satisfies Record<string, Track>;

export interface HockeyAction {
  bend: number;
  twist: number;
  hipX: number;
  hipZ: number;
  hipDrop: number;
  bladeSide: number;
  bladeReach: number;
  bladeLift: number;
  handLift: number;
  handSpread: number;
  releaseHand: number;
  check: number;
}

export function sampleHockeyAction(p: Skater, charge: number, out: HockeyAction) {
  out.bend = charge * 0.12;
  out.twist = charge * 0.45;
  out.hipX = -charge * 0.065;
  out.hipZ = -charge * 0.07;
  out.hipDrop = charge * 0.035;
  out.bladeSide = charge * 0.12;
  out.bladeReach = -charge * 0.8;
  out.bladeLift = charge * charge * 0.65;
  out.handLift = charge * 0.15;
  out.handSpread = 0.38 + charge * 0.08;
  out.releaseHand = 0;
  out.check = 0;
  if (p.shotTimer > 0) {
    const u = clamp(1 - p.shotTimer / (p.shotDuration ?? 0.34), 0, 1);
    const sweep = sampleTrack(RELEASE.sweep, u),
      lift = sampleTrack(RELEASE.lift, u);
    const transfer = sampleTrack(RELEASE.transfer, u);
    const backhand = p.shotStyle === 'backhand' ? -1 : 1;
    const strength = p.shotStyle === 'slap' ? 1 : p.shotStyle === 'pass' ? 0.4 : 0.65;
    out.bend += sweep * 0.13 * strength;
    out.twist -= sweep * 0.65 * strength * backhand;
    out.hipX += transfer * 0.07 * backhand;
    out.hipZ += sweep * 0.06;
    out.bladeSide -= sweep * 0.5 * strength * backhand;
    out.bladeReach += sweep * 0.24;
    out.bladeLift += lift * strength;
    out.handLift += lift * 0.35;
    out.handSpread += sweep * 0.06;
  }
  if (p.checkTimer > 0) {
    const u = clamp(1 - p.checkTimer / PHYSICS.checkWindow, 0, 1);
    const load = sampleTrack(CHECK.load, u),
      shoulder = sampleTrack(CHECK.shoulder, u);
    out.check = shoulder;
    out.bend += load * 0.2;
    out.twist += shoulder * 0.55;
    out.hipDrop += load * 0.08;
    out.hipZ += shoulder * 0.12;
    out.bladeReach -= shoulder * 0.25;
    out.releaseHand = shoulder;
  }
  const deke = activeDeke(p);
  if (deke && p.dekeKind) {
    const u = p.dekeTimer / dekeDuration(p.dekeKind);
    const gather = Math.sin(Math.PI * clamp(u, 0, 1));
    out.hipDrop += gather * 0.045;
    out.hipX -= deke.lean * 0.16;
    out.twist += (p.stickSide - 0.58) * 0.16;
    if (p.dekeKind === 'throughLegs' || p.dekeKind === 'windmill')
      out.releaseHand = smoothstep(u, 0.08, 0.25) * (1 - smoothstep(u, 0.7, 0.96));
  }
  return out;
}

export function createHockeyAction(): HockeyAction {
  return {
    bend: 0,
    twist: 0,
    hipX: 0,
    hipZ: 0,
    hipDrop: 0,
    bladeSide: 0,
    bladeReach: 0,
    bladeLift: 0,
    handLift: 0,
    handSpread: 0.38,
    releaseHand: 0,
    check: 0,
  };
}
