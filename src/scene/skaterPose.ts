import * as THREE from 'three';
import type { Skater } from '../game/types';
import { activeDeke } from '../game/dekes';
import { activeCelly, cellyRagdoll } from '../game/cellys';
import {
  createHockeyAction,
  sampleHockeyAction,
  sampleForwardStride,
  type HockeyAction,
  type GoalieAction,
} from './hockeyMotion';
import {
  NAMES,
  faceGoaliePads,
  SIDES,
  plantFoot,
  poseBone,
  reachLimb,
  sideSign,
  type BoneName,
  type Side,
  type SkaterRig,
} from './skaterModel';

/** Seconds at the end of a knockdown spent getting back up. */
export const GET_UP = 0.8;
const TAU = Math.PI * 2;
/** The rig root sits a hair above the ice; ankles aim just below zero so the skates bite. */
const ICE_Y = -0.02;
const _slerp = new THREE.Quaternion();
const _spinQ = new THREE.Quaternion();
const _e = new THREE.Euler();
const { clamp, lerp } = THREE.MathUtils;
type Knockdown = 'up' | 'limp' | 'getup';
function knockdown(downTimer: number): Knockdown {
  if (downTimer <= 0) return 'up';
  if (downTimer > GET_UP) return 'limp';
  return 'getup';
}

function hash(id: number, i: number) {
  const x = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const LEG = /^(thigh|shin|foot)/;
function limitExtra(name: BoneName, q: THREE.Quaternion) {
  _e.setFromQuaternion(q, 'XYZ');
  const leg = LEG.test(name);
  _e.x = clamp(_e.x, leg ? -0.5 : -1.05, leg ? 0.7 : 1.15);
  _e.y = clamp(_e.y, -0.85, 0.85);
  _e.z = clamp(_e.z, leg ? -0.45 : -1, leg ? 0.45 : 1);
  q.setFromEuler(_e);
}

function seedRagdoll(rig: SkaterRig, skater: Skater) {
  const { extra, spin } = rig.ragdoll;
  let i = 0;
  for (const name of NAMES) {
    extra[name].identity();
    const scale = LEG.test(name) ? 0.5 : 1;
    spin[name].set(
      (hash(skater.id, i++) - 0.4) * 6 * scale,
      (hash(skater.id, i++) - 0.5) * 5 * scale,
      (hash(skater.id, i++) - 0.5) * 6 * scale,
    );
  }
  spin.pelvis.x += 3.5;
  spin.spine.x += 2.4;
  spin.chest.z += (hash(skater.id, 99) - 0.5) * 3;
  spin.head.x += 1.8;
}

function stepRagdoll(rig: SkaterRig, dt: number) {
  const damp = Math.exp(-dt * 2.6);
  for (const name of NAMES) {
    const w = rig.ragdoll.spin[name];
    w.multiplyScalar(damp);
    w.clampLength(0, 8);
    _spinQ.setFromEuler(_e.set(w.x * dt, w.y * dt, w.z * dt));
    rig.ragdoll.extra[name].multiply(_spinQ);
    limitExtra(name, rig.ragdoll.extra[name]);
  }
}

function applyMix(rig: SkaterRig, name: BoneName, x: number, y: number, z: number, limp: number) {
  poseBone(rig, name, x, y, z);
  if (limp <= 0) return;
  _slerp.identity().slerp(rig.ragdoll.extra[name], limp);
  rig.bones[name].quaternion.multiply(_slerp);
}

/** One skate through a stride cycle, relative to the skater's centre line. */
interface Step {
  x: number;
  y: number;
  z: number;
  /** Toe turned out (+ toward the skater's left). */
  yaw: number;
  /** Toe dipped toward the ice. */
  pitch: number;
  /** How much weight the skate carries. */
  weight: number;
  /** Push-off effort, peaking mid-extension. */
  push: number;
}
const steps: Record<Side, Step> = {
  L: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
  R: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
};
/**
 * A hockey stride: the skate lands ahead (t = 0), the body glides over it, then it pushes out and
 * back (0.4–0.7), leaves the ice on the toe and swings back under the hips. The other skate runs
 * half a cycle behind, so the push always happens with the other skate already planted.
 */
/** How far a skater is from upright, 0 to 1, from the knockdown and dive timers alone. */
export function fallenAmount(skater: Skater) {
  if (cellyRagdoll(skater)) return 1;
  const phase = knockdown(skater.downTimer);
  const getup = phase === 'getup' ? 1 - skater.downTimer / GET_UP : phase === 'up' ? 1 : 0;
  const dive = clamp(skater.diveTimer > 0.22 ? 1 : skater.diveTimer / 0.22, 0, 1);
  return 1 - getup + dive * 0.82 * getup;
}

/** Backward skating: both skates stay down and alternate C-cuts, toes turned in on the push. */
function ccutStep(out: number, t: number, drive: number, stance: number, o: Step) {
  const push = 0.5 - 0.5 * Math.cos(TAU * t);
  o.x = out * (stance + 0.3 * drive * push);
  o.z = 0.04 + 0.22 * drive * push;
  o.y = 0;
  o.yaw = -out * (0.1 + 0.45 * drive * push);
  o.pitch = 0;
  o.weight = 1 - 0.55 * push;
  o.push = Math.sin(Math.PI * clamp(t * 2, 0, 1)) * (t < 0.5 ? 1 : 0);
}
function mixStep(a: Step, b: Step, t: number, o: Step) {
  o.x = lerp(a.x, b.x, t);
  o.y = lerp(a.y, b.y, t);
  o.z = lerp(a.z, b.z, t);
  o.yaw = lerp(a.yaw, b.yaw, t);
  o.pitch = lerp(a.pitch, b.pitch, t);
  o.weight = lerp(a.weight, b.weight, t);
  o.push = lerp(a.push, b.push, t);
}
const strideSteps: Record<Side, Step> = {
  L: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
  R: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
};
const ccutSteps: Record<Side, Step> = {
  L: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
  R: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 1, push: 0 },
};

export interface Posture {
  stickBlend: number;
  fallen: number;
  /** Pelvis position in the skater frame. */
  pelvis: THREE.Vector3;
  /** Free-arm swing, −1 back to 1 forward. */
  swing: number;
  crouch: number;
  /** Whole-body lean, + toward the skater's right; the free arm balances against it. */
  lean: number;
  action: HockeyAction;
}
const posture: Posture = {
  stickBlend: 1,
  fallen: 0,
  pelvis: new THREE.Vector3(),
  swing: 0,
  crouch: 0.5,
  lean: 0,
  action: createHockeyAction(),
};

const legBones: BoneName[] = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const fk = legBones.map(() => new THREE.Quaternion());
const _hip = new THREE.Vector3(),
  _foot = new THREE.Vector3(),
  _knee = new THREE.Vector3();

/**
 * Skating posture. Pelvis and torso are keyed directly; the skates are planted on the ice with
 * leg IK so they never float or sink. A knockdown ragdoll gathers itself before standing.
 */
export function poseSkater(
  rig: SkaterRig,
  skater: Skater,
  dt: number,
  goalie: boolean,
  twoHand: number,
  /** Shot charge, 0 to 1: the stick is drawn back and the body loads onto the back skate. */
  windup: number,
  frame: THREE.Object3D,
  recoveryProgress = 1,
  save?: GoalieAction,
): Posture {
  const recovering = 1 - THREE.MathUtils.smoothstep(recoveryProgress, 0.32, 1);
  const butterfly = goalie && skater.downTimer <= 0 ? (save?.drop ?? 0) : 0;
  const phase: Knockdown = cellyRagdoll(skater) ? 'limp' : knockdown(skater.downTimer);
  switch (phase) {
    case 'up':
      if (rig.ragdoll.active) {
        rig.ragdoll.active = false;
        for (const name of NAMES) rig.ragdoll.extra[name].identity();
      }
      break;
    case 'limp':
      if (!rig.ragdoll.active) {
        rig.ragdoll.active = true;
        seedRagdoll(rig, skater);
      }
      stepRagdoll(rig, dt);
      break;
    case 'getup':
      stepRagdoll(rig, dt * 0.35);
      break;
    default: {
      const _never: never = phase;
      return _never;
    }
  }
  const getup = phase === 'getup' ? 1 - skater.downTimer / GET_UP : phase === 'up' ? 1 : 0;
  const limp = 1 - THREE.MathUtils.smoothstep(getup, 0.15, 0.92);
  const dive = clamp(skater.diveTimer > 0.22 ? 1 : skater.diveTimer / 0.22, 0, 1);
  const speed = Math.hypot(skater.vx, skater.vz);
  const along = skater.vx * Math.sin(skater.angle) + skater.vz * Math.cos(skater.angle);
  const backward = goalie ? 0 : clamp((-along - 1) / 1.5, 0, 1);
  const deke = clamp(skater.stickSide / 0.85, -1, 1);
  const move = activeDeke(skater);
  const celly = activeCelly(skater);
  const skate = Math.min(speed / 8.2, 1);
  const action = sampleHockeyAction(skater, windup, posture.action);
  const drive =
    phase === 'up' && dive <= 0
      ? goalie
        ? skate * 0.25
        : skater.skateDrive * (1 - action.plant * 0.85)
      : 0;
  const hop = (move?.hop ?? 0) + (celly?.hop ?? 0),
    tuck = skater.dekeKind === 'jump' || skater.cellyKind === 'jump' ? clamp(hop / 0.22, 0, 1) : 0;
  // A one-touch cut is a hard lateral push: the outside skate drives out while the inside one
  // glides under the hips. Signed by the cut direction, + toward the skater's right.
  const cut =
    move && skater.dekeKind !== 'spin'
      ? THREE.MathUtils.smoothstep(move.cut, 0, 16) * skater.dekeDir
      : 0;
  const stumble = Math.min(1, skater.stumbleTimer / 0.25),
    lurch = stumble * Math.sin(skater.stumbleTimer * 22);
  // With both hands on the stick the skater sits lower and hunches over it, and the bottom-hand
  // shoulder dips, so the bottom hand can reach well down the shaft.
  const handSupport = twoHand * (1 - action.releaseHand);
  const carry = goalie ? 0 : handSupport;
  const checking = action.check;
  const lifting = Math.min(1, skater.liftTimer / 0.18);
  const blocking = Math.min(1, skater.blockTimer / 0.12);
  const crouch =
    phase === 'limp'
      ? 0.2
      : goalie
        ? 0.85
        : clamp(
            0.36 +
              carry * 0.1 +
              skate * 0.27 +
              Math.abs(deke) * 0.06 +
              (move?.dip ?? 0) * 0.38 +
              (celly?.dip ?? 0) * 0.28 +
              checking * 0.2 +
              tuck * 0.3 +
              backward * 0.12 +
              action.arch * 0.15,
            0,
            1,
          );
  // Lean into the turn: + is toward the skater's right (−x). The pose builds it from a hip shift,
  // splayed skates and a rolled torso, so the skater carves rather than tips over.
  const leanRight = clamp(
    (move?.lean ?? 0) * 1.35 + (celly?.lean ?? 0) * 1.1 - skater.edgeLean * 0.55 + lurch * 0.15,
    -0.85,
    0.85,
  );

  // Stride cycle. The left skate leads; the right runs half a cycle behind.
  const stance = goalie ? 0.29 : 0.19;
  const cycle = (skater.stride / TAU) % 1;
  sampleForwardStride(1, (cycle + 1) % 1, drive, stance, strideSteps.L);
  sampleForwardStride(-1, (cycle + 0.5) % 1, drive, stance, strideSteps.R);
  ccutStep(1, (cycle + 1) % 1, drive, stance, ccutSteps.L);
  ccutStep(-1, (cycle + 0.5) % 1, drive, stance, ccutSteps.R);
  mixStep(strideSteps.L, ccutSteps.L, backward, steps.L);
  mixStep(strideSteps.R, ccutSteps.R, backward, steps.R);
  const { L, R } = steps;
  // The centre of mass travels ahead of the next contact. Normalizing the instantaneous blade
  // weights stalled it over one skate, then snapped it across when the other skate touched down.
  const sway = Math.sin(skater.stride) * 0.58 * drive;
  const pushing = L.push + R.push;
  // Weight transfer: shots load the back skate and drive onto the front one through the release.
  const weightTo = clamp(action.weightTo, -1, 1);

  // Pelvis: sits over the gliding skate, dips into each push and shifts inside a turn.
  const hipAbove = lerp(
    lerp(
      (goalie ? 0.78 : 0.86) -
        (goalie ? 0.29 : 0.25) * crouch -
        0.038 * pushing -
        0.1 * tuck -
        action.hipDrop -
        Math.abs(weightTo) * 0.02,
      0.31,
      butterfly,
    ),
    0.39,
    recovering,
  );
  // Loading a shot sits the weight on the back (right) skate; the release drives it onto the left.
  const pelvis = posture.pelvis.set(
    sway * 0.18 - leanRight * 0.24 + action.hipX + weightTo * 0.07 + (save?.side ?? 0) * 0.09,
    ICE_Y + rig.ankleHeight + hipAbove - rig.hipOffset.y,
    -0.065 * crouch - backward * 0.06 + action.hipZ,
  );
  const pelvisPitch = 0.15 + 0.18 * crouch + dive * 0.5 - stumble * 0.1 - action.arch * 0.05;
  const pelvisYaw =
    0.13 * drive * (L.push - R.push) + deke * 0.06 + action.pelvisYaw + (celly?.twist ?? 0) * 0.35;
  const pelvisRoll = leanRight * 0.22 - 0.04 * drive * (R.weight - L.weight) + lurch * 0.1;
  rig.bones.pelvis.position
    .copy(rig.pelvisBind)
    .addScaledVector(pelvis, 1 / rig.scale)
    .addScaledVector(rig.pelvisBind, -1);
  applyMix(rig, 'pelvis', pelvisPitch, pelvisYaw, pelvisRoll, limp);

  // Torso: forward lean spread down the spine, shoulders countering the hips and turning toward
  // the puck, head kept level and looking up ice.
  const bend =
    0.5 +
    0.22 * carry +
    (goalie ? 0.6 : 0.45) * crouch +
    action.bend -
    action.arch * 0.16 +
    recovering * 0.2 -
    dive * 0.35 +
    lifting * 0.15 +
    blocking * 0.2 -
    backward * 0.2;
  // Shoulders sit slightly open toward the top hand, as a left-shot skater carries the stick.
  // A windup coils them toward the blade side; the release unwinds through the shot.
  const twist = -0.08 + deke * 0.2 - pelvisYaw * 0.8 + action.twist;
  const dip = 0.09 * carry;
  applyMix(
    rig,
    'spine',
    bend * 0.3 + lurch * 0.2,
    twist * 0.3,
    leanRight * 0.32 - lurch * 0.2,
    limp,
  );
  applyMix(rig, 'spine1', bend * 0.28, twist * 0.35, leanRight * 0.3 - dip * 0.25, limp);
  applyMix(
    rig,
    'chest',
    bend * 0.2 + checking * 0.2,
    twist * 0.35,
    leanRight * 0.2 - dip * 0.75,
    limp,
  );
  const nod = pelvisPitch + bend * 0.78;
  // The eyes stay on the puck through the load, then come up to the target through the release.
  const look = clamp(action.look, -1, 1);
  applyMix(
    rig,
    'neck',
    -nod * 0.35 - look * 0.1,
    -twist * 0.2,
    -leanRight * 0.35 + dip * 0.3,
    limp,
  );
  applyMix(
    rig,
    'head',
    0.04 - nod * 0.5 - dive * 0.6 - look * 0.3,
    -twist * 0.25 + deke * 0.2 + (move?.headYaw ?? 0) + (celly?.headYaw ?? 0),
    -leanRight * 0.45 + dip * 0.45 + lurch * 0.15,
    limp,
  );

  // Legs. Forward-kinematic fallback for the ragdoll and the belly-flop, then planted IK on top.
  const swing = Math.sin(skater.stride);
  for (const side of SIDES) {
    const out = sideSign(side);
    const leg = out * swing * drive;
    // Fallen skaters trail their legs along the ice rather than folding them under.
    const flex = 0.34 * crouch + Math.max(0, leg) * 0.5 - dive * 0.3 - limp * 0.35;
    const knee = Math.max(0.08, 0.8 * crouch - dive * 0.45 + limp * 0.15);
    applyMix(rig, `thigh${side}`, flex, 0, out * (0.06 + dive * 0.12), limp);
    applyMix(rig, `shin${side}`, -knee, 0, 0, limp);
    applyMix(rig, `foot${side}`, pelvisPitch - flex + knee, 0, 0, limp);
  }
  const blendFk = Math.max(limp, dive);
  if (blendFk < 0.999) {
    legBones.forEach((name, i) => fk[i].copy(rig.bones[name].quaternion));
    for (const side of SIDES) {
      const out = sideSign(side),
        step = steps[side];
      const lateral = skater.vx * Math.cos(skater.angle) - skater.vz * Math.sin(skater.angle);
      const slip = Math.atan2(lateral, Math.max(0.8, Math.abs(along)));
      const stopping = Math.abs(slip) * (1 - drive) * Math.min(1, speed / 3);
      const crossover = Math.max(0, Math.abs(skater.edgeLean) - 0.35) * drive * (1 - backward);
      const swingArc = Math.sin(
        Math.PI * clamp((((cycle + (side === 'R' ? 0.5 : 0)) % 1) - 0.65) / 0.35, 0, 1),
      );
      const crossing = crossover * swingArc * Math.max(0, -out * Math.sign(skater.edgeLean));
      const splay = out * 0.15 * Math.max(0, out * leanRight);
      // Outside skate of a cut: the one opposite the cut direction.
      const outside = Math.max(0, out * cut),
        inside = Math.max(0, -out * cut);
      // Through a follow-through the back (right) skate unweights and drags its toe behind.
      const toeDrag =
        Math.max(0, (side === 'R' ? 1 : -1) * action.drag) * (1 - backward) * (1 - limp);
      _foot.set(
        lerp(step.x + splay - out * crossing * 0.55, out * 0.42, outside) +
          lerp(0, -out * 0.05, inside),
        ICE_Y +
          rig.ankleHeight +
          lerp(step.y, 0.02, outside + inside) +
          (skater.cellyKind === 'jump' ? 0.55 : 0.2) * tuck +
          crossing * 0.14 +
          toeDrag * 0.05,
        lerp(step.z, -0.15, outside) + lerp(0, 0.1, inside) - 0.1 * tuck - toeDrag * 0.14,
      );
      if (goalie) {
        // Lateral shuffle blades stay on the ice; save pads fan outward from the knees.
        _foot.y = ICE_Y + rig.ankleHeight;
        _foot.x = lerp(_foot.x, out * 0.54, butterfly);
        _foot.z = lerp(_foot.z, -0.14, butterfly);
      }
      if (recovering > 0) {
        _foot.x = lerp(_foot.x, out * 0.19, recovering);
        _foot.z = lerp(_foot.z, side === 'L' ? 0.36 : -0.4, recovering);
        _foot.y = lerp(_foot.y, ICE_Y + rig.ankleHeight, recovering);
      }
      const yaw =
        step.yaw +
        out * 0.15 * Math.abs(leanRight) +
        out * 0.5 * outside +
        slip * (goalie ? 0.1 : 0.6) +
        Math.sign(slip) * stopping * 0.2 +
        out * butterfly * 0.9;
      _knee
        .copy(_foot)
        .add(_hip.set(Math.sin(yaw) * 0.7, 0.55, Math.cos(yaw) * 0.7))
        .setX(_knee.x + out * 0.05 - leanRight * 0.15);
      if (side === 'R' && recovering > 0) {
        _knee.y = lerp(_knee.y, ICE_Y + 0.08, recovering);
        _knee.z = lerp(_knee.z, 0.2, recovering);
      }
      if (butterfly > 0) {
        _knee.x = lerp(_knee.x, out * 0.16, butterfly);
        _knee.y = lerp(_knee.y, ICE_Y + 0.08, butterfly);
        _knee.z = lerp(_knee.z, 0.18, butterfly);
      }
      frame.localToWorld(_foot);
      frame.localToWorld(_knee);
      reachLimb(rig, 'leg', side, _foot, _knee);
      plantFoot(
        rig,
        side,
        frame,
        yaw,
        -(step.pitch + 0.45 * tuck + toeDrag * 0.55) - (side === 'R' ? recovering * 1.1 : 0),
        leanRight * 0.35 + out * butterfly * 0.8,
      );
    }
    if (blendFk > 0)
      legBones.forEach((name, i) => rig.bones[name].quaternion.slerp(fk[i], blendFk));
  }
  for (const side of SIDES) poseBone(rig, `toe${side}`, 0, 0, 0);
  if (goalie) faceGoaliePads(rig, frame);

  // Arms. Stick hands are placed by the caller; this is the rest pose and the free-arm swing.
  const armDive = dive * 0.8 + lifting * 0.35 + blocking * 0.25;
  const pump = -swing * drive;
  for (const side of SIDES) {
    const s = sideSign(side);
    // The bottom-hand clavicle drops and rolls forward to bring that shoulder to the shaft.
    const low = side === 'L' ? carry : 0;
    poseBone(rig, `shoulder${side}`, low * 0.2, 0, s * (0.035 + low * 0.14 + checking * 0.05));
    applyMix(rig, `upperArm${side}`, 0.55 + armDive, 0, s * (0.15 + pump * 0.4), limp);
    applyMix(rig, `forearm${side}`, 0.5 + dive * 0.4, 0, 0, limp);
    applyMix(rig, `hand${side}`, 0.1, 0, 0, limp);
  }
  posture.stickBlend = getup;
  posture.fallen = 1 - getup + dive * 0.82 * getup;
  posture.swing = pump;
  posture.crouch = crouch;
  posture.lean = leanRight;
  return posture;
}
