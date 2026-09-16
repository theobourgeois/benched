import { MathUtils } from 'three';
import { GOALIE, PHYSICS } from '../game/config';
import { activeDeke, dekeDuration } from '../game/dekes';
import { activeCelly } from '../game/cellys';
import type { Puck, Skater } from '../game/types';
import { SHOT_DOWNSWING, GOALIE_SAVE_TIME } from '../game/actionTiming';

const { clamp, lerp, smoothstep } = MathUtils;

/** The loaded pose unwinds to exact contact before the simulation releases a charged shot. */
export function shotWindup(p: Skater, charge: number) {
  if (!p.pendingShot) return charge;
  const progress = 1 - p.pendingShot.timer / SHOT_DOWNSWING;
  return p.pendingShot.load * (1 - smoothstep(progress, 0, 1));
}

export interface GoalieAction {
  /** Into the butterfly, 0 to 1. */
  drop: number;
  /** Lean toward the save: −1 blocker side to 1 glove side. */
  side: number;
  /** How far the save has been thrown, 0 to 1. */
  reach: number;
  high: number;
  /** Mitt thrown to a point in the goalie's frame: x toward the glove, y up. */
  glove: number;
  gloveX: number;
  gloveY: number;
  /** Blocker and paddle thrown out on the blocker side. */
  blocker: number;
  blockerX: number;
  blockerY: number;
  /** One pad stacked out to a side: −1 blocker side, 1 glove side. */
  stack: number;
  /** Kneeling on a frozen puck, glove over it. */
  cover: number;
}
export function createGoalieAction(): GoalieAction {
  return {
    drop: 0,
    side: 0,
    reach: 0,
    high: 0,
    glove: 0,
    gloveX: 0.34,
    gloveY: 0.92,
    blocker: 0,
    blockerX: -0.36,
    blockerY: 0.86,
    stack: 0,
    cover: 0,
  };
}

/**
 * Read an approaching shot; a recorded commitment then throws the part it names, holds it and
 * returns to the ready stance. A frozen puck is knelt on.
 */
export function sampleGoalieAction(p: Skater, puck: Puck, out: GoalieAction, dt = 1 / 60) {
  let weight = 0,
    side = 0,
    height = 0;
  const kind = (p.saveTimer ?? 0) > 0 ? (p.saveKind ?? 'body') : null;
  if (kind) {
    // The throw takes the simulation's extension time to arrive, holds, then comes home.
    const u = clamp(1 - p.saveTimer! / GOALIE_SAVE_TIME, 0, 1);
    weight = smoothstep(u, 0, GOALIE.extend / GOALIE_SAVE_TIME) * (1 - smoothstep(u, 0.52, 1));
    side = clamp(p.saveSide ?? 0, -1.2, 1.2);
    height = p.saveHeight ?? 0;
  } else if (puck.shot && puck.owner === null) {
    const dx = puck.x - p.x,
      dz = puck.z - p.z;
    const speed2 = puck.vx * puck.vx + puck.vz * puck.vz;
    const time = speed2 > 1 ? -(dx * puck.vx + dz * puck.vz) / speed2 : -1;
    const nearX = dx + puck.vx * time,
      nearZ = dz + puck.vz * time;
    if (time >= 0 && time < 0.24 && Math.hypot(nearX, nearZ) < 1.35) {
      weight = 0.6 * (1 - smoothstep(time, 0, 0.24));
      side = clamp(nearX * Math.cos(p.angle) - nearZ * Math.sin(p.angle), -1, 1);
      height = Math.max(0, puck.y + puck.vy * time - 4.9 * time * time);
    }
  }
  const cover =
    puck.owner === p.id && (p.coverTimer ?? 0) > 0 ? clamp(p.coverTimer! / 0.2, 0, 1) : 0;
  out.high = smoothstep(height, 0.5, 1.2);
  out.glove = out.blocker = out.stack = 0;
  out.gloveX = 0.34;
  out.gloveY = 0.92;
  out.blockerX = -0.36;
  out.blockerY = 0.86;
  switch (kind) {
    case 'butterfly':
      out.drop = weight;
      break;
    case 'pad':
      out.drop = weight * 0.9;
      out.stack = weight * (Math.sign(side) || 1);
      break;
    case 'glove':
      out.drop = weight * 0.3;
      out.glove = weight;
      out.gloveX = Math.max(0.3, side);
      out.gloveY = Math.max(0.5, height);
      break;
    case 'blocker':
      out.drop = weight * 0.3;
      out.blocker = weight;
      out.blockerX = Math.min(-0.3, side);
      out.blockerY = Math.max(0.45, height);
      break;
    case 'body':
      out.drop = weight * 0.35;
      out.glove = out.blocker = weight * 0.6;
      out.gloveX = 0.16;
      out.gloveY = 0.95;
      out.blockerX = -0.18;
      out.blockerY = 0.9;
      break;
    case 'stick':
      out.drop = weight * 0.6;
      out.blocker = weight * 0.5;
      out.blockerX = -0.2;
      out.blockerY = 0.45;
      break;
    case null:
      // Reading a shot: a small lean toward it, dropping for a low one.
      out.drop = weight * (1 - out.high * 0.8);
      break;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
  // Going down onto the puck is a drop, not a cut; a scrub can land on any frame of it.
  out.cover += (cover - out.cover) * (1 - Math.exp(-Math.min(dt, 0.1) * 11));
  if (Math.abs(cover - out.cover) < 0.01) out.cover = cover;
  out.drop = Math.max(out.drop, out.cover);
  out.side = side * weight;
  out.reach = Math.max(weight, out.cover);
  return out;
}
type Key = readonly [time: number, value: number];
type Track = readonly Key[];

/** Shape-preserving Hermite tracks. Flat contact/weight keys stay flat without clipped overshoot. */
export function sampleTrack(keys: Track, time: number): number {
  if (time <= keys[0][0]) return keys[0][1];
  const last = keys.length - 1;
  if (time >= keys[last][0]) return keys[last][1];
  for (let i = 0; i < last; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (time > b[0]) continue;
    const span = b[0] - a[0],
      t = (time - a[0]) / span;
    const tangent = (k: number) => {
      if (k === 0 || k === last) return 0;
      const before = keys[k - 1],
        at = keys[k],
        after = keys[k + 1];
      const h0 = at[0] - before[0],
        h1 = after[0] - at[0];
      const d0 = (at[1] - before[1]) / h0,
        d1 = (after[1] - at[1]) / h1;
      if (d0 * d1 <= 0) return 0;
      const w0 = 2 * h1 + h0,
        w1 = h1 + 2 * h0;
      return (w0 + w1) / (w0 / d0 + w1 / d1);
    };
    const m0 = tangent(i) * span,
      m1 = tangent(i + 1) * span;
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

// Contact under the hip -> loaded glide as the body passes over -> push out to the side and a
// little back -> low recovery back under the hip -> contact. A hockey stride is sideways: the
// skate lands under the hip rather than ahead, drives out at about 60° off the line of travel
// and comes back low along the ice, so from the front the legs open and close like scissors
// rather than swinging fore and aft like running.
const FORWARD = {
  x: [
    [0, 0.02],
    [0.2, 0.0],
    [0.44, 0.14],
    [0.66, 0.5],
    [0.8, 0.36],
    [0.92, 0.08],
    [1, 0.02],
  ],
  z: [
    [0, 0.06],
    [0.24, 0.0],
    [0.46, -0.12],
    [0.66, -0.3],
    [0.82, -0.14],
    [1, 0.06],
  ],
  y: [
    [0, 0],
    [0.62, 0],
    [0.72, 0.03],
    [0.84, 0.07],
    [0.95, 0.02],
    [1, 0],
  ],
  yaw: [
    [0, 0.05],
    [0.34, 0.08],
    [0.62, 0.6],
    [0.76, 0.5],
    [0.92, 0.0],
    [1, 0.05],
  ],
  pitch: [
    [0, 0],
    [0.58, 0],
    [0.71, 0.25],
    [0.84, 0.1],
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

// A shot's release: the snap builds over a few frames (a real wrist snap, not a teleport), the
// follow-through rises and holds, then everything settles gently — a fast tail whips the stick
// back to the carry and reads as a snap-back.
const SNAP = [
  [0, 0],
  [0.12, 0.45],
  [0.25, 1],
  [0.4, 0.85],
  [0.55, 0.5],
  [0.75, 0.22],
  [0.9, 0.06],
  [1, 0],
] satisfies Track;
const LIFT = [
  [0, 0],
  [0.15, 0.12],
  [0.5, 1],
  [0.68, 0.9],
  [0.85, 0.35],
  [0.95, 0.08],
  [1, 0],
] satisfies Track;
const TRANSFER = [
  [0, 0],
  [0.22, 0.85],
  [0.38, 1],
  [0.6, 0.9],
  [0.8, 0.35],
  [0.92, 0.08],
  [1, 0],
] satisfies Track;
/** The follow-through holds through the middle of the window and settles by its end. */
const SHOT_TAIL = 1;
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
  /** Weight bias between the skates: −1 loaded on the back (right) skate, +1 driven onto the left. */
  weightTo: number;
  /** Windup chest lift: the back arches as the body coils. */
  arch: number;
  /** Head toward the target: −1 down at the puck, +1 up at the net. */
  look: number;
  /** Trailing toe drag: positive = right skate, negative = left skate on a backhand. */
  drag: number;
  /** Pelvis leads the shoulders into a shot; skates retain a stable support base. */
  pelvisYaw: number;
  plant: number;
  handForward: number;
}

/** Adds the windup pose for a load of `c` onto the action. */
function applyWindup(out: HockeyAction, c: number, backhand = false) {
  const slap = c * c;
  const side = backhand ? -1 : 1;
  out.bend += c * 0.06;
  out.twist += c * (backhand ? -0.3 : 0.68);
  out.pelvisYaw += c * 0.22 * side;
  out.plant = Math.max(out.plant, c);
  out.hipX -= c * 0.08 * side;
  out.hipZ -= c * 0.08;
  out.hipDrop += c * 0.05;
  out.bladeSide += c * (backhand ? -0.18 : 0.55);
  out.bladeReach -= c * (backhand ? 0.3 : lerp(0.4, 1.65, c));
  out.bladeLift += slap * c * (backhand ? 0.12 : 1.7);
  out.handLift += c * 0.06;
  out.handSpread += c * 0.09;
  out.weightTo -= c * 0.85 * side;
  out.arch += c;
  out.look -= c * 0.4;
}

export function sampleHockeyAction(p: Skater, charge: number, out: HockeyAction) {
  out.bend = 0;
  out.twist = 0;
  out.hipX = 0;
  out.hipZ = 0;
  out.hipDrop = 0;
  out.bladeSide = 0;
  out.bladeReach = 0;
  out.bladeLift = 0;
  out.handLift = 0;
  out.handSpread = 0.34;
  out.releaseHand = 0;
  out.check = 0;
  out.weightTo = 0;
  out.arch = 0;
  out.look = 0;
  out.drag = 0;
  out.pelvisYaw = 0;
  out.plant = 0;
  out.handForward = 0;
  applyWindup(out, p.pendingShot?.load ?? charge, p.stickSide < 0);
  if (p.pendingShot) {
    // Traverse the loaded arc once. Feeding a fading charge back through the nonlinear loading
    // curve compressed almost the entire downswing into one frame at medium charge.
    const remaining = 1 - smoothstep(1 - p.pendingShot.timer / SHOT_DOWNSWING, 0, 1);
    for (const key of Object.keys(out) as (keyof HockeyAction)[]) {
      if (key === 'handSpread') out[key] = 0.34 + (out[key] - 0.34) * remaining;
      else out[key] *= remaining;
    }
  }
  // Keep the body braced through impact; returning to neutral at the exact release frame
  // made the hips recoil before the follow-through had even started.
  const impact = p.pendingShot
    ? smoothstep(1 - p.pendingShot.timer / SHOT_DOWNSWING, 0, 1)
    : p.shotTimer > 0 && p.shotStyle === 'slap'
      ? 1 - smoothstep(1 - p.shotTimer / (p.shotDuration ?? 0.6), 0, 0.75)
      : 0;
  out.plant = Math.max(out.plant, impact);
  out.bend += impact * 0.12;
  out.hipDrop += impact * 0.025;
  out.weightTo += impact * 0.3;
  out.pelvisYaw -= impact * 0.08;
  if (p.shotTimer > 0) {
    const u = clamp(1 - p.shotTimer / ((p.shotDuration ?? 0.34) * SHOT_TAIL), 0, 1);
    const snap = sampleTrack(SNAP, u),
      lift = sampleTrack(LIFT, u);
    const transfer = sampleTrack(TRANSFER, u);
    // A quick release keeps the windup it was charged with and unwinds it through the snap,
    // so the blade and hands drive through the puck instead of teleporting to the carry pose.
    applyWindup(out, (p.shotLoad ?? 0) * (1 - smoothstep(u, 0, 0.3)), p.shotStyle === 'backhand');
    const backhand = p.shotStyle === 'backhand' ? -1 : 1;
    const strength =
      p.shotStyle === 'slap'
        ? 1
        : p.shotStyle === 'pass'
          ? 0.35
          : p.shotStyle === 'backhand'
            ? 0.75
            : 0.7;
    out.bend += snap * 0.2 * strength;
    out.twist -= snap * 0.65 * strength * backhand;
    out.pelvisYaw -= transfer * 0.25 * strength * backhand;
    out.plant = Math.max(out.plant, transfer * strength);
    out.hipX += transfer * 0.1 * strength * backhand;
    out.hipZ += snap * 0.11 * strength;
    out.bladeSide -= lift * 0.65 * strength * backhand;
    out.bladeReach += snap * 0.25 * strength;
    out.bladeLift += lift * 0.8 * strength;
    out.handLift += lift * 0.12 * strength;
    out.handForward += snap * 0.16 * strength;
    out.handSpread += snap * 0.07;
    out.weightTo += transfer * 1.1 * strength * backhand;
    out.look += snap * 0.35 * strength;
    out.drag += transfer * strength * backhand;
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
    out.bladeReach -= shoulder * 0.05;
    out.bladeSide += shoulder * 0.3;
    out.releaseHand = shoulder;
  }
  const deke = activeDeke(p);
  if (deke && p.dekeKind) {
    const u = p.dekeTimer / dekeDuration(p.dekeKind);
    const gather = Math.sin(Math.PI * clamp(u, 0, 1)) ** 2;
    out.hipDrop += gather * 0.05 + deke.dip * 0.05;
    out.hipX -= deke.lean * 0.3;
    out.pelvisYaw -= deke.lean * 0.34;
    out.plant = Math.max(out.plant, gather * 0.85);
    switch (p.dekeKind) {
      case 'stride':
        out.twist += deke.lean * 0.5;
        out.plant = Math.max(out.plant, gather);
        break;
      case 'burst':
        out.hipZ += gather * 0.14;
        out.look += gather * 0.4;
        out.arch += gather * 0.18;
        out.twist += (p.stickSide - 0.58) * 0.22 * gather;
        break;
      case 'protect':
        out.releaseHand = gather * 0.9;
        out.twist += deke.yaw * 0.4;
        out.bend += gather * 0.14;
        break;
      case 'spin':
        out.plant = Math.max(out.plant, 0.95);
        break;
      case 'jump':
        out.twist += (p.stickSide - 0.58) * 0.22 * gather;
        break;
      case 'throughLegs':
      case 'windmill':
        out.twist += (p.stickSide - 0.58) * 0.22 * gather;
        out.releaseHand = smoothstep(u, 0.08, 0.25) * (1 - smoothstep(u, 0.7, 0.96));
        break;
      default: {
        const _never: never = p.dekeKind;
        void _never;
      }
    }
  }
  const celly = activeCelly(p);
  if (celly && p.cellyKind) {
    out.hipDrop += celly.hipDrop;
    out.hipX += celly.hipX;
    out.hipZ += celly.hipZ;
    out.twist += celly.twist;
    out.bend += celly.dip * 0.25;
    out.bladeSide += celly.bladeSide;
    out.bladeReach += celly.bladeReach;
    out.bladeLift += celly.bladeLift;
    out.handLift += celly.handLift;
    out.releaseHand = Math.max(out.releaseHand, celly.releaseHand);
    out.look += celly.headYaw * 0.35;
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
    handSpread: 0.34,
    releaseHand: 0,
    check: 0,
    weightTo: 0,
    arch: 0,
    look: 0,
    drag: 0,
    pelvisYaw: 0,
    plant: 0,
    handForward: 0,
  };
}
