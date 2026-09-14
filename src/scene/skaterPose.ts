import * as THREE from 'three';
import type { Skater } from '../game/types';
import { activeDeke } from '../game/dekes';
import { NAMES, poseBone, SIDES, type BoneName, type SkaterRig } from './skaterModel';

const GET_UP = 0.8;
const _slerp = new THREE.Quaternion();
const _spinQ = new THREE.Quaternion();
const _e = new THREE.Euler();

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

function limitExtra(q: THREE.Quaternion) {
  _e.setFromQuaternion(q, 'XYZ');
  _e.x = THREE.MathUtils.clamp(_e.x, -1.05, 1.15);
  _e.y = THREE.MathUtils.clamp(_e.y, -0.85, 0.85);
  _e.z = THREE.MathUtils.clamp(_e.z, -1, 1);
  q.setFromEuler(_e);
}

function seedRagdoll(rig: SkaterRig, skater: Skater) {
  const { extra, spin } = rig.ragdoll;
  let i = 0;
  for (const name of NAMES) {
    extra[name].identity();
    spin[name].set(
      (hash(skater.id, i++) - 0.4) * 6,
      (hash(skater.id, i++) - 0.5) * 5,
      (hash(skater.id, i++) - 0.5) * 6,
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
    limitExtra(rig.ragdoll.extra[name]);
  }
}

function applyMix(rig: SkaterRig, name: BoneName, x: number, y: number, z: number, limp: number) {
  poseBone(rig, name, x, y, z);
  if (limp <= 0) return;
  _slerp.identity().slerp(rig.ragdoll.extra[name], limp);
  rig.bones[name].quaternion.multiply(_slerp);
}

/** Skating posture, plus a knockdown ragdoll that gathers itself before standing. */
export function poseSkater(
  rig: SkaterRig,
  skater: Skater,
  dt: number,
  goalie: boolean,
  twoHand: boolean,
) {
  const phase = knockdown(skater.downTimer);
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
  const limp = 1 - THREE.MathUtils.smoothstep(0.15, 0.92, getup);
  const dive = THREE.MathUtils.clamp(skater.diveTimer > 0.22 ? 1 : skater.diveTimer / 0.22, 0, 1);
  const speed = Math.hypot(skater.vx, skater.vz);
  const deke = THREE.MathUtils.clamp(skater.stickSide / 0.85, -1, 1);
  const move = activeDeke(skater);
  const skate = Math.min(speed / 8.2, 1);
  // Mixamo thighs: +X swings the skate forward, +Z abducts toward the skater's left.
  const drive =
    phase === 'up' && dive <= 0
      ? goalie
        ? skate * 0.22
        : THREE.MathUtils.clamp((speed - 0.45) / 3.4, 0, 1)
      : 0;
  const swing = Math.sin(skater.stride);
  const crouch =
    phase === 'limp'
      ? 0.2
      : goalie
        ? 1
        : 0.5 + skate * 0.32 + Math.abs(deke) * 0.08 + dive * 0.7 + (move?.hop ?? 0) * 0.9;
  const stumble = Math.min(1, skater.stumbleTimer / 0.25),
    lurch = stumble * Math.sin(skater.stumbleTimer * 22);
  const checking = Math.min(1, skater.checkTimer / 0.18);
  const lifting = Math.min(1, skater.liftTimer / 0.18);
  const blocking = Math.min(1, skater.blockTimer / 0.12);
  const lean =
    0.1 +
    crouch * 0.3 -
    stumble * 0.25 +
    checking * 0.32 +
    dive * 0.85 +
    lifting * 0.15 +
    blocking * 0.2;
  const pelvisTilt = 0.1 * crouch + dive * 0.55;
  applyMix(
    rig,
    'pelvis',
    pelvisTilt + Math.abs(swing) * drive * 0.04,
    -swing * drive * 0.12 + deke * 0.14,
    lurch * 0.18 + checking * 0.12 + deke * 0.2,
    limp,
  );
  applyMix(
    rig,
    'spine',
    lean * 0.5 + lurch * 0.2 + dive * 0.4,
    -swing * drive * 0.18 + checking * 0.38 + deke * 0.32,
    -lurch * 0.25 - deke * 0.12,
    limp,
  );
  applyMix(
    rig,
    'chest',
    lean * 0.4 + checking * 0.28 + dive * 0.35,
    swing * drive * 0.22 + checking * 0.42 + deke * 0.22,
    -lurch * 0.15 - deke * 0.08,
    limp,
  );
  applyMix(
    rig,
    'head',
    0.05 - pelvisTilt - lean * 0.9 + dive * 0.25,
    deke * 0.18 - swing * drive * 0.08,
    lurch * 0.2,
    limp,
  );
  for (const side of SIDES) {
    const out = side === 'L' ? 1 : -1;
    const leg = out * swing;
    const push = Math.pow(Math.max(0, -leg), 1.2) * drive;
    const recover = Math.pow(Math.max(0, leg), 1.05) * drive;
    const onPuck = Math.max(0, deke * out),
      loaded = Math.max(0, -deke * out);
    const flex =
      0.34 * crouch + recover * 0.75 - push * 0.4 - loaded * 0.08 + onPuck * 0.04 - dive * 0.55;
    const knee = Math.max(
      0.08,
      0.8 * crouch + recover * 0.12 - push * 0.25 + loaded * 0.12 - dive * 0.5,
    );
    const abduct =
      out *
      (0.045 +
        push * 0.16 +
        onPuck * 0.08 +
        loaded * 0.04 +
        (goalie ? 0.16 : 0) +
        stumble * 0.1 +
        dive * 0.12);
    const twist = out * (push * 0.1 - recover * 0.04 + onPuck * 0.08);
    applyMix(rig, `thigh${side}`, flex, twist, abduct, limp);
    applyMix(rig, `shin${side}`, -knee, 0, goalie ? -out * 0.15 : -out * onPuck * 0.06, limp);
    applyMix(rig, `foot${side}`, pelvisTilt - flex + knee + recover * 0.1, 0, -abduct * 0.4, limp);
  }
  const armDive = dive * 0.8 + lifting * 0.35 + blocking * 0.25;
  if (twoHand) {
    for (const side of SIDES) {
      applyMix(rig, `upperArm${side}`, 0.32 + armDive, 0, side === 'L' ? 0.22 : -0.22, limp);
      applyMix(rig, `forearm${side}`, 0.4 + dive * 0.4, 0, 0, limp);
      applyMix(rig, `hand${side}`, 0, 0, 0, limp);
    }
  } else {
    const pump = -swing * drive;
    applyMix(
      rig,
      'upperArmL',
      0.72 + Math.max(0, -pump) * 0.12 + armDive,
      0,
      0.12 + pump * 0.62,
      limp,
    );
    applyMix(rig, 'forearmL', 0.62 + Math.max(0, -pump) * 0.22 + dive * 0.4, 0, 0, limp);
    applyMix(rig, 'handL', 0.12, 0, 0, limp);
    applyMix(rig, 'upperArmR', 0.28 + armDive, 0, -0.18, limp);
    applyMix(rig, 'forearmR', 0.32 + dive * 0.4, 0, 0, limp);
    applyMix(rig, 'handR', 0, 0, 0, limp);
  }
  return { stickBlend: getup, fallen: 1 - getup + dive * 0.82 * getup };
}
