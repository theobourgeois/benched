import * as THREE from 'three';
import type { ColliderDesc, RigidBody, World } from '@dimforge/rapier3d-compat';
import { RINK } from '../game/config';
import { clamp } from '../game/math';
import { REPLAY_HZ, type ReplayFrame } from '../game/replay';
import type { Skater } from '../game/types';
import { NAMES, setWorldQuaternion, type BoneName, type SkaterRig } from './skaterModel';
import { layoutShaft, type BladeSpec, type StickParts } from './stick';

/**
 * Knockdown ragdolls. Purely visual: the simulation still owns where a skater is and when they
 * get up; this only decides how the body lands. One Rapier world holds the ice, boards, nets and
 * a capsule for every standing skater, so a falling body slides, hits the boards and gets bumped.
 */
type Rapier = typeof import('@dimforge/rapier3d-compat');
interface RawJoints {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
  jointConfigureMotorVelocity(handle: number, axis: number, target: number, factor: number): void;
}

let R: Rapier | null = null;
let world: World | null = null;
// Loaded off the critical path; knockdowns use the procedural fall until it is ready.
void import('@dimforge/rapier3d-compat').then(async (mod) => {
  const api = ((mod as unknown as { default?: Rapier }).default ?? mod) as Rapier;
  await api.init();
  R = api;
  world = buildWorld(api);
});
export const physicsReady = () => world !== null;

const STEP = 1 / 120;
const MAX_STEPS = 6;
/** Ice surface height, and the boards and glass as one wall. */
const ICE_TOP = 0.012;
const WALL_TOP = 2.5;
const WALL_DEPTH = 0.4;
/** Ice is nearly frictionless under a sliding body; boards grab a little and give a little back. */
const ICE_FRICTION = 0.06;
/** Joint damping. Enough to stop limbs ringing like springs, not enough to look braced. */
const JOINT_DAMPING = 0.08;
/** Collision groups: static rink, standing skaters, then one bit per ragdoll so a body never collides with itself. */
const WORLD_BIT = 1,
  SKATER_BIT = 2,
  DOLL_BITS = 0xfffc,
  SLOTS = 14;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;

function buildWorld(api: Rapier) {
  const w = new api.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = STEP;
  const ground = w.createRigidBody(api.RigidBodyDesc.fixed());
  const fixed = (desc: ColliderDesc) =>
    w.createCollider(desc.setCollisionGroups(groups(WORLD_BIT, 0xffff)), ground);
  fixed(
    api.ColliderDesc.cuboid(RINK.halfLength + 6, 0.5, RINK.halfWidth + 6)
      .setTranslation(0, ICE_TOP - 0.5, 0)
      .setFriction(ICE_FRICTION)
      .setFrictionCombineRule(api.CoefficientCombineRule.Min)
      .setRestitution(0.05),
  );
  // Boards and glass: one panel per segment of the rounded rink outline, set just outside it.
  const points = rinkOutline();
  const yaw = new THREE.Quaternion();
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const dx = b.x - a.x,
      dz = b.y - a.y,
      length = Math.hypot(dx, dz);
    if (length < 1e-3) continue;
    let nx = dz / length,
      nz = -dx / length;
    const mx = (a.x + b.x) / 2,
      mz = (a.y + b.y) / 2;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    yaw.setFromAxisAngle(UP, Math.atan2(-dz, dx));
    fixed(
      api.ColliderDesc.cuboid(length / 2 + 0.05, WALL_TOP / 2, WALL_DEPTH / 2)
        .setTranslation(mx + (nx * WALL_DEPTH) / 2, WALL_TOP / 2, mz + (nz * WALL_DEPTH) / 2)
        .setRotation(yaw)
        .setFriction(0.35)
        .setRestitution(0.2),
    );
  }
  // Nets as solid boxes behind each goal line.
  for (const side of [-1, 1])
    fixed(
      api.ColliderDesc.cuboid(0.45, RINK.goalHeight / 2, RINK.goalHalfWidth)
        .setTranslation(side * (RINK.goalX + 0.45), RINK.goalHeight / 2, 0)
        .setFriction(0.3)
        .setRestitution(0.1),
    );
  return w;
}

/** Same rounded rectangle the arena draws its boards along. */
function rinkOutline() {
  const points: THREE.Vector2[] = [],
    r = RINK.corner,
    cx = RINK.halfLength - r,
    cz = RINK.halfWidth - r;
  for (const [x, z, start] of [
    [cx, cz, 0],
    [-cx, cz, 90],
    [-cx, -cz, 180],
    [cx, -cz, 270],
  ]) {
    for (let i = 0; i <= 12; i++) {
      const a = ((start + i * 7.5) * Math.PI) / 180;
      points.push(new THREE.Vector2(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
  }
  return points;
}

let lastFrame = -1,
  accumulator = 0;
/** Advances the shared world once per rendered frame, whichever skater asks first. */
export function stepPhysics(frame: number, dt: number, live: boolean) {
  if (!world || frame === lastFrame) return;
  lastFrame = frame;
  // Replays, pauses and hitstop hold every body where it is. With nobody down there is nothing
  // for the kinematic skater bodies to collide with, so the world is not stepped at all.
  if (!live || !slots.size) {
    accumulator = 0;
    return;
  }
  accumulator = Math.min(accumulator + dt, STEP * MAX_STEPS);
  while (accumulator >= STEP) {
    world.step();
    accumulator -= STEP;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _pq = new THREE.Quaternion();

/**
 * Body parts, parents first. Each body is oriented as its bone relative to the bind pose, so a
 * joint at rest means the T-pose, and limits read in the skater's own axes: x toward their left
 * (bend forward is + for the spine and head, − for the hips), y up (twist), z forward.
 * Limits are [xMin, xMax, yMin, yMax, zMin, zMax] in radians.
 */
interface PartSpec {
  bone: BoneName;
  parent?: BoneName;
  limits?: readonly number[];
}
const PARTS: PartSpec[] = [
  { bone: 'pelvis' },
  { bone: 'spine', parent: 'pelvis', limits: [-0.35, 0.8, -0.45, 0.45, -0.4, 0.4] },
  { bone: 'chest', parent: 'spine', limits: [-0.35, 0.75, -0.5, 0.5, -0.35, 0.35] },
  { bone: 'head', parent: 'chest', limits: [-1, 0.8, -1, 1, -0.5, 0.5] },
  // Arms bind straight out to the side: x is twist along the arm, y swings it fore and aft.
  { bone: 'upperArmL', parent: 'chest', limits: [-1.5, 1.5, -1.6, 0.9, -1.6, 1.3] },
  { bone: 'forearmL', parent: 'upperArmL', limits: [-1.6, 1.6, -2.5, 0, -0.12, 0.12] },
  { bone: 'upperArmR', parent: 'chest', limits: [-1.5, 1.5, -0.9, 1.6, -1.3, 1.6] },
  { bone: 'forearmR', parent: 'upperArmR', limits: [-1.6, 1.6, 0, 2.5, -0.12, 0.12] },
  { bone: 'thighL', parent: 'pelvis', limits: [-1.9, 0.5, -0.5, 0.5, -0.35, 0.9] },
  { bone: 'shinL', parent: 'thighL', limits: [0, 2.4, -0.15, 0.15, -0.1, 0.1] },
  { bone: 'thighR', parent: 'pelvis', limits: [-1.9, 0.5, -0.5, 0.5, -0.9, 0.35] },
  { bone: 'shinR', parent: 'thighR', limits: [0, 2.4, -0.15, 0.15, -0.1, 0.1] },
];
const DRIVEN = new Set(PARTS.map((p) => p.bone));
/** Bones between the bodies (clavicles, neck, hands, skates) keep the angle they had at impact. */
const HELD = NAMES.filter((name) => !DRIVEN.has(name));

type Shape =
  | { kind: 'capsule'; a: THREE.Vector3; b: THREE.Vector3; r: number }
  | { kind: 'box'; center: THREE.Vector3; half: THREE.Vector3 }
  | { kind: 'ball'; center: THREE.Vector3; r: number };

/** Collision shapes in world space, from where the joints sit at impact. */
function shapesFor(bone: BoneName, at: (b: BoneName) => THREE.Vector3, bodyQ: THREE.Quaternion) {
  const capsule = (a: THREE.Vector3, b: THREE.Vector3, r: number): Shape => ({
    kind: 'capsule',
    a,
    b,
    r,
  });
  const past = (from: THREE.Vector3, to: THREE.Vector3, extra: number) =>
    to.clone().add(_v.subVectors(to, from).setLength(extra));
  switch (bone) {
    case 'pelvis':
      return [capsule(at('thighL'), at('thighR'), 0.13)];
    case 'spine':
      return [capsule(at('spine'), at('chest'), 0.13)];
    case 'chest': {
      const chest = at('chest'),
        neck = at('neck');
      return [
        {
          kind: 'box',
          center: chest.clone().lerp(neck, 0.5),
          half: new THREE.Vector3(0.17, chest.distanceTo(neck) / 2 + 0.04, 0.11),
        } as Shape,
      ];
    }
    case 'head':
      return [
        {
          kind: 'ball',
          center: at('head').add(_v2.set(0, 0.11, 0.02).applyQuaternion(bodyQ)),
          r: 0.125,
        } as Shape,
      ];
    case 'upperArmL':
    case 'upperArmR': {
      const side = bone.slice(-1) as 'L' | 'R';
      return [capsule(at(`upperArm${side}`), at(`forearm${side}`), 0.06)];
    }
    case 'forearmL':
    case 'forearmR': {
      const side = bone.slice(-1) as 'L' | 'R';
      const elbow = at(`forearm${side}`);
      return [capsule(elbow, past(elbow, at(`hand${side}`), 0.09), 0.05)];
    }
    case 'thighL':
    case 'thighR': {
      const side = bone.slice(-1) as 'L' | 'R';
      return [capsule(at(`thigh${side}`), at(`shin${side}`), 0.085)];
    }
    case 'shinL':
    case 'shinR': {
      const side = bone.slice(-1) as 'L' | 'R';
      // The skate rides rigidly on the shin, so it gets a capsule too.
      return [
        capsule(at(`shin${side}`), at(`foot${side}`), 0.065),
        capsule(at(`foot${side}`), at(`toe${side}`), 0.045),
      ];
    }
    default:
      return [];
  }
}

function colliderFor(api: Rapier, shape: Shape, p: THREE.Vector3, q: THREE.Quaternion) {
  const inv = _pq.copy(q).invert();
  const local = (v: THREE.Vector3) => v.clone().sub(p).applyQuaternion(inv);
  if (shape.kind === 'ball') {
    const c = local(shape.center);
    return api.ColliderDesc.ball(shape.r).setTranslation(c.x, c.y, c.z);
  }
  if (shape.kind === 'box') {
    const c = local(shape.center);
    return api.ColliderDesc.cuboid(shape.half.x, shape.half.y, shape.half.z).setTranslation(
      c.x,
      c.y,
      c.z,
    );
  }
  const a = local(shape.a),
    b = local(shape.b);
  const span = b.clone().sub(a),
    length = span.length();
  const c = a.lerp(b, 0.5);
  const rot = new THREE.Quaternion().setFromUnitVectors(UP, span.normalize());
  return api.ColliderDesc.capsule(Math.max(0.01, length / 2 - shape.r * 0.6), shape.r)
    .setTranslation(c.x, c.y, c.z)
    .setRotation(rot);
}

interface Part {
  bone: BoneName;
  body: RigidBody;
}
export interface Ragdoll {
  parts: Part[];
  stick: RigidBody;
  held: [BoneName, THREE.Quaternion][];
  /** Shaft layout at impact; the dropped stick keeps it. */
  tilt: number;
  length: number;
  slot: number;
}

const slots = new Set<number>();
function claimSlot() {
  for (let i = 0; i < SLOTS; i++)
    if (!slots.has(i)) {
      slots.add(i);
      return i;
    }
  return -1;
}

const jitter = (scale: number) => (Math.random() - 0.5) * 2 * scale;

/**
 * Swaps a skater's pose for physics at the moment of a knockdown. The bones must still hold the
 * last drawn pose; each body starts there, moving with the skater. The upper body carries the
 * hit and the skates stay behind, so the skater is laid out along the hit direction rather than
 * dropped in place.
 */
export function createRagdoll(
  rig: SkaterRig,
  stick: StickParts,
  spec: BladeSpec,
  skater: Skater,
  opts?: { limp?: boolean; dive?: boolean },
): Ragdoll | null {
  if (!R || !world) return null;
  const slot = claimSlot();
  if (slot < 0) return null;
  const api = R,
    w = world;
  const member = 1 << (2 + slot);
  const collision = groups(member, (WORLD_BIT | SKATER_BIT | DOLL_BITS) & ~member);
  rig.root.updateMatrixWorld(true);
  const at = (b: BoneName) => rig.bones[b].getWorldPosition(new THREE.Vector3());

  const limp = opts?.limp === true;
  const dive = opts?.dive === true;
  const base = new THREE.Vector3(skater.vx, 0, skater.vz);
  const dir = new THREE.Vector3(Math.sin(skater.fallAngle), 0, Math.cos(skater.fallAngle));
  const drive = limp
    ? Math.max(0.4, base.length() * 0.25)
    : dive
      ? Math.max(2, base.length() * 0.85)
      : Math.max(3, base.dot(dir));
  const velocityAt = (height: number) =>
    dive
      ? base.clone().add(_v2.set(jitter(0.35), -1.1 + jitter(0.2), jitter(0.35)))
      : base
          .clone()
          .addScaledVector(dir, drive * (limp ? 0.15 : 0.75 * (height / 1.3) - 0.4))
          .add(
            _v2.set(
              jitter(limp ? 1.2 : 0.5),
              jitter(limp ? 0.8 : 0.2) + (limp ? 1.4 : 0),
              jitter(limp ? 1.2 : 0.5),
            ),
          );

  const bodies = new Map<BoneName, { body: RigidBody; p: THREE.Vector3; q: THREE.Quaternion }>();
  const parts: Part[] = [];
  for (const partSpec of PARTS) {
    const bone = rig.bones[partSpec.bone];
    const p = bone.getWorldPosition(new THREE.Vector3());
    const q = bone
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(_q.copy(rig.bindWorld[partSpec.bone]).invert());
    const v = velocityAt(p.y);
    const body = w.createRigidBody(
      api.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(q)
        .setLinvel(v.x, v.y, v.z)
        .setLinearDamping(0.08)
        .setAngularDamping(0.9)
        .setCcdEnabled(true)
        .setAdditionalSolverIterations(4),
    );
    if (partSpec.bone === 'pelvis')
      body.setAngvel(
        {
          x: (dive ? dir.z * 2.4 : 0) + jitter(limp ? 5 : dive ? 0.6 : 1.5),
          y: jitter(limp ? 6 : dive ? 1 : 2.5),
          z: (dive ? -dir.x * 2.4 : 0) + jitter(limp ? 5 : dive ? 0.6 : 1.5),
        },
        true,
      );
    for (const shape of shapesFor(partSpec.bone, at, q))
      w.createCollider(
        colliderFor(api, shape, p, q)
          .setDensity(1000)
          .setFriction(0.5)
          .setRestitution(0.05)
          .setCollisionGroups(collision),
        body,
      );
    if (partSpec.parent && partSpec.limits) {
      const parent = bodies.get(partSpec.parent)!;
      const anchor = p.clone().sub(parent.p).applyQuaternion(_q.copy(parent.q).invert());
      const joint = w.createImpulseJoint(
        api.JointData.spherical(anchor, { x: 0, y: 0, z: 0 }),
        parent.body,
        body,
        true,
      );
      joint.setContactsEnabled(false);
      const axes = [api.JointAxis.AngX, api.JointAxis.AngY, api.JointAxis.AngZ];
      // The typed wrapper only exposes limits and motors on some joint kinds; the raw set takes
      // them on any axis. A zero-velocity motor is plain joint damping.
      const raw = (w.impulseJoints as unknown as { raw: RawJoints }).raw;
      axes.forEach((axis, k) => {
        raw.jointSetLimits(
          joint.handle,
          axis,
          partSpec.limits![k * 2],
          partSpec.limits![k * 2 + 1],
        );
        raw.jointConfigureMotorVelocity(joint.handle, axis, 0, JOINT_DAMPING);
      });
    }
    bodies.set(partSpec.bone, { body, p, q });
    parts.push({ bone: partSpec.bone, body });
  }

  // The stick is dropped: its own body, starting where it was held.
  stick.root.updateMatrixWorld(true);
  const sp = stick.root.getWorldPosition(new THREE.Vector3()),
    sq = stick.root.getWorldQuaternion(new THREE.Quaternion());
  const sv = base.clone().addScaledVector(dir, drive * 0.2);
  const stickBody = w.createRigidBody(
    api.RigidBodyDesc.dynamic()
      .setTranslation(sp.x, sp.y, sp.z)
      .setRotation(sq)
      .setLinvel(sv.x + jitter(1), sv.y + 0.5, sv.z + jitter(1))
      .setAngvel({ x: jitter(3), y: jitter(4), z: jitter(3) })
      .setLinearDamping(0.1)
      .setAngularDamping(0.6)
      .setCcdEnabled(true),
  );
  const knob = stick.shaft.localToWorld(new THREE.Vector3(0, 0.5, 0)),
    hosel = stick.shaft.localToWorld(new THREE.Vector3(0, -0.5, 0));
  const stickShapes: Shape[] = [
    { kind: 'capsule', a: hosel, b: knob, r: 0.016 },
    {
      kind: 'box',
      center: stick.root.localToWorld(new THREE.Vector3(spec.length / 2, spec.height / 2, 0)),
      half: new THREE.Vector3(spec.length / 2, spec.height / 2, 0.012),
    },
  ];
  for (const shape of stickShapes) {
    const desc = colliderFor(api, shape, sp, sq);
    // Boxes are built in the body frame; the blade lies in the stick's own plane.
    w.createCollider(
      desc.setDensity(500).setFriction(0.3).setRestitution(0.15).setCollisionGroups(collision),
      stickBody,
    );
  }

  return {
    parts,
    stick: stickBody,
    held: HELD.map((name) => [name, rig.bones[name].quaternion.clone()]),
    tilt: stick.shaft.rotation.z,
    length: stick.shaft.scale.y,
    slot,
  };
}

/** How quickly the body's slide matches the simulated skater's, and how hard it is pulled back to them. */
const LEASH_MATCH = 3;
const LEASH_PULL = 1.5;
/**
 * Keeps the body sliding with the simulated skater, so it stays where the game (and the camera)
 * has them and the get-up doesn't glide across the ice. The whole body gets the same nudge, so
 * the tumble itself is untouched.
 */
export function leashRagdoll(
  doll: Ragdoll,
  x: number,
  z: number,
  vx: number,
  vz: number,
  dt: number,
) {
  const pelvis = doll.parts[0].body,
    t = pelvis.translation(),
    v = pelvis.linvel();
  const match = Math.min(1, dt * LEASH_MATCH);
  const dvx = (vx - v.x) * match + (x - t.x) * dt * LEASH_PULL,
    dvz = (vz - v.z) * match + (z - t.z) * dt * LEASH_PULL;
  for (const { body } of doll.parts) {
    const w = body.linvel();
    body.setLinvel({ x: w.x + dvx, y: w.y, z: w.z + dvz }, true);
  }
}

export function destroyRagdoll(doll: Ragdoll) {
  if (world) {
    for (const part of doll.parts) world.removeRigidBody(part.body);
    world.removeRigidBody(doll.stick);
  }
  slots.delete(doll.slot);
}

/** Puts an object at a world transform, whatever its parent is doing. */
function placeWorld(object: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion) {
  const parent = object.parent!;
  parent.updateWorldMatrix(true, false);
  object.position.copy(parent.worldToLocal(position));
  parent.getWorldQuaternion(_pq);
  object.quaternion.copy(_pq.invert().multiply(quaternion));
}

/** Poses the skeleton and stick from the bodies. The skater frame must be upright. */
export function driveRagdoll(doll: Ragdoll, rig: SkaterRig, stick: StickParts, spec: BladeSpec) {
  for (const [name, q] of doll.held) rig.bones[name].quaternion.copy(q);
  for (const part of doll.parts) {
    const r = part.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).multiply(rig.bindWorld[part.bone]);
    if (part.bone === 'pelvis') {
      const t = part.body.translation();
      placeWorld(rig.bones.pelvis, _v.set(t.x, t.y, t.z), _q);
    } else setWorldQuaternion(rig.bones[part.bone], _q);
  }
  const t = doll.stick.translation(),
    r = doll.stick.rotation();
  placeWorld(stick.root, _v.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w));
  layoutShaft(stick, spec, doll.tilt, doll.length);
}

/**
 * A drawn pose in world space, so it can be recorded, blended and replayed without physics:
 * pelvis position, stick position and rotation, shaft tilt and length, then every bone's rotation.
 */
export const POSE_SIZE = 12 + NAMES.length * 4;
export function capturePose(rig: SkaterRig, stick: StickParts, out: Float32Array) {
  rig.bones.pelvis.getWorldPosition(_v).toArray(out, 0);
  stick.root.getWorldPosition(_v).toArray(out, 3);
  stick.root.getWorldQuaternion(_q).toArray(out, 6);
  out[10] = stick.shaft.rotation.z;
  out[11] = stick.shaft.scale.y;
  NAMES.forEach((name, i) => rig.bones[name].getWorldQuaternion(_q).toArray(out, 12 + i * 4));
}
export function applyPose(rig: SkaterRig, stick: StickParts, spec: BladeSpec, pose: Float32Array) {
  NAMES.forEach((name, i) => {
    _q.fromArray(pose, 12 + i * 4);
    if (name === 'pelvis') placeWorld(rig.bones.pelvis, _v.fromArray(pose, 0), _q);
    else setWorldQuaternion(rig.bones[name], _q);
  });
  placeWorld(stick.root, _v.fromArray(pose, 3), _q.fromArray(pose, 6));
  layoutShaft(stick, spec, pose[10], pose[11]);
}
function slerpAt(a: Float32Array, b: Float32Array, t: number, out: Float32Array, i: number) {
  _q.fromArray(a, i).slerp(_q2.fromArray(b, i), t).toArray(out, i);
}
export function mixPose(a: Float32Array, b: Float32Array, t: number, out: Float32Array) {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  slerpAt(a, b, t, out, 6);
  out[10] = a[10] + (b[10] - a[10]) * t;
  out[11] = a[11] + (b[11] - a[11]) * t;
  for (let i = 12; i < POSE_SIZE; i += 4) slerpAt(a, b, t, out, i);
}

/** The pose each downed skater was last drawn in, keyed by skater index, for the recorder. */
const shown = new Map<number, Float32Array>();
export function showPose(id: number, pose: Float32Array | null) {
  if (pose) shown.set(id, pose);
  else shown.delete(id);
}
const recorded = new WeakMap<ReplayFrame, Map<number, Float32Array>>();
/** Called for every replay snapshot, so a replay shows the same fall that happened live. */
export function recordRagdollPoses(frame: ReplayFrame) {
  if (!shown.size) return;
  const poses = new Map<number, Float32Array>();
  for (const [id, pose] of shown) poses.set(id, pose.slice());
  recorded.set(frame, poses);
}
/** The recorded pose at a replay time, blended between snapshots. False if the skater was not down. */
export function replayPose(frames: ReplayFrame[], time: number, id: number, out: Float32Array) {
  const f = clamp(time * REPLAY_HZ, 0, frames.length - 1);
  const i = Math.floor(f);
  const a = recorded.get(frames[i])?.get(id),
    b = recorded.get(frames[Math.min(i + 1, frames.length - 1)])?.get(id);
  if (a && b) mixPose(a, b, f - i, out);
  else if (a || b) out.set((a ?? b)!);
  else return false;
  return true;
}

/**
 * A skater's presence in the physics world: a capsule that follows them while they stand, so
 * falling bodies bump into players, and their ragdoll while they are down.
 */
export class SkaterPhysics {
  private body: RigidBody | null = null;
  private on = false;
  doll: Ragdoll | null = null;
  follow(x: number, z: number, goalie: boolean, standing: boolean) {
    if (!R || !world) return;
    const y = 0.95;
    if (!this.body) {
      this.body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
      );
      world.createCollider(
        R.ColliderDesc.capsule(0.6, goalie ? 0.45 : 0.28)
          .setFriction(0.4)
          .setCollisionGroups(groups(SKATER_BIT, DOLL_BITS)),
        this.body,
      );
    }
    if (standing !== this.on) {
      this.on = standing;
      this.body.setEnabled(standing);
      // Re-enabling teleports, so the capsule doesn't sweep across the ice at infinite speed.
      if (standing) this.body.setTranslation({ x, y, z }, true);
    }
    if (!standing) return;
    const t = this.body.translation();
    if (Math.hypot(t.x - x, t.z - z) > 2) this.body.setTranslation({ x, y, z }, true);
    else this.body.setNextKinematicTranslation({ x, y, z });
  }
  release() {
    if (this.doll) destroyRagdoll(this.doll);
    this.doll = null;
  }
  dispose() {
    this.release();
    if (this.body && world) world.removeRigidBody(this.body);
    this.body = null;
  }
}
