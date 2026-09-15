import * as THREE from 'three';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Uniform } from '../game/clubs';
import { makeNumberTexture } from './textures';

/** Mixamo-rigged character (see public/models/CREDITS.txt). mixamorig / mixamorig12 both work. */
export const SKATER_URL = `${import.meta.env.BASE_URL}models/skater.fbx`;
export const HELMET_PLAYER_URL = `${import.meta.env.BASE_URL}models/helmet-player.glb`;
export const HELMET_GOALIE_URL = `${import.meta.env.BASE_URL}models/helmet-goalie.glb`;
const HEIGHT = 2;
/** Wrist to the middle of the palm, and palm thickness, in world units. */
const PALM_ALONG = 0.068;
const PALM_THICK = 0.03;
/** Helmet height in Mixamo centimetres, parented to the head bone. */
const HELMET_CM = { player: 30, goalie: 30 } as const;

export const SIDES = ['L', 'R'] as const; // L is the skater's left (+x), R their right (-x).
export type Side = (typeof SIDES)[number];
export type BoneName =
  | 'pelvis'
  | 'spine'
  | 'spine1'
  | 'chest'
  | 'neck'
  | 'head'
  | `shoulder${Side}`
  | `thigh${Side}`
  | `shin${Side}`
  | `foot${Side}`
  | `toe${Side}`
  | `upperArm${Side}`
  | `forearm${Side}`
  | `hand${Side}`;

const MIXAMO: Record<BoneName, string[]> = {
  pelvis: ['Hips'],
  spine: ['Spine'],
  spine1: ['Spine1'],
  chest: ['Spine2'],
  neck: ['Neck'],
  head: ['Head'],
  shoulderL: ['LeftShoulder'],
  thighL: ['LeftUpLeg'],
  shinL: ['LeftLeg'],
  footL: ['LeftFoot'],
  toeL: ['LeftToeBase'],
  upperArmL: ['LeftArm'],
  forearmL: ['LeftForeArm'],
  handL: ['LeftHand'],
  shoulderR: ['RightShoulder'],
  thighR: ['RightUpLeg'],
  shinR: ['RightLeg'],
  footR: ['RightFoot'],
  toeR: ['RightToeBase'],
  upperArmR: ['RightArm'],
  forearmR: ['RightForeArm'],
  handR: ['RightHand'],
};
export const NAMES = Object.keys(MIXAMO) as BoneName[];
export const sideSign = (side: Side) => (side === 'L' ? 1 : -1);

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export interface FingerBone {
  bone: THREE.Bone;
  bind: THREE.Quaternion;
  finger: Finger;
  /** 1 at the knuckle, 3 at the last joint. */
  joint: number;
}
const FINGER = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([123])$/;

function canonical(name: string) {
  return name.replace(/^mixamorig\d*[:_]?/i, '');
}

export interface Ragdoll {
  active: boolean;
  extra: Record<BoneName, THREE.Quaternion>;
  spin: Record<BoneName, THREE.Vector3>;
}
export interface SkaterRig {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  bind: Record<BoneName, THREE.Quaternion>;
  /** Bind-pose bone rotations relative to the rig root, where the character faces +z. */
  bindWorld: Record<BoneName, THREE.Quaternion>;
  fingers: Record<Side, FingerBone[]>;
  ragdoll: Ragdoll;
  /** Model units (Mixamo centimetres) to world units. */
  scale: number;
  /** Bind-pose ankle height above the ice: put the ankle here and a flat skate is planted. */
  ankleHeight: number;
  /** Bind-pose pelvis (Hips) position in model units. */
  pelvisBind: THREE.Vector3;
  /** Pelvis origin to the left hip joint, world units, unrotated. Mirror x for the right. */
  hipOffset: THREE.Vector3;
  /** Foot orientation relative to the rig root that puts the blade flat on the ice. */
  footFlat: Record<Side, THREE.Quaternion>;
  /** Segment lengths in world units. */
  limbs: { upperArm: number; forearm: number; thigh: number; shin: number };
  armReach: number;
  dispose(): void;
}

const heights = new WeakMap<THREE.Object3D, number>();
function templateHeight(template: THREE.Object3D) {
  const cached = heights.get(template);
  if (cached) return cached;
  template.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(template);
  const height = Math.max(box.max.y - box.min.y, 1);
  heights.set(template, height);
  return height;
}

function sourceMaterial(mesh: THREE.Mesh) {
  return (
    Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  ) as THREE.MeshStandardMaterial;
}

function paintClothes(root: THREE.Object3D, uniform: Uniform) {
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const src = sourceMaterial(mesh);
    if (/shirt/i.test(mesh.name)) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: uniform.jersey,
        roughness: 0.72,
        metalness: 0,
      });
      return;
    }
    if (/pant/i.test(mesh.name)) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: uniform.trim,
        roughness: 0.82,
        metalness: 0,
      });
      return;
    }
    if (/sneaker|shoe/i.test(mesh.name)) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: '#14161a',
        roughness: 0.45,
        metalness: 0.12,
      });
      return;
    }
    mesh.material = new THREE.MeshStandardMaterial({
      map: src.map,
      color: src.color,
      roughness: 0.62,
      metalness: 0,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
      side: src.side,
    });
  });
}

const _box = new THREE.Box3(),
  _size = new THREE.Vector3(),
  _center = new THREE.Vector3(),
  _world = new THREE.Vector3(),
  _toward = new THREE.Vector3();
function cloneMaterials(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();
  });
}

function numberInk(jersey: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(jersey.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#1a1d22' : '#f1f4f8';
}

/** Centers a Sketchfab prop, scales it to `heightCm`, and hangs it on the head. */
function attachHelmet(source: THREE.Object3D, head: THREE.Bone, kind: keyof typeof HELMET_CM) {
  const wrapper = new THREE.Group();
  const inner = new THREE.Group();
  const clone = source.clone(true);
  cloneMaterials(clone);
  inner.add(clone);
  wrapper.add(inner);
  wrapper.updateWorldMatrix(true, true);
  _box.setFromObject(wrapper);
  _box.getSize(_size);
  _box.getCenter(_center);
  inner.position.sub(_center);
  wrapper.scale.setScalar(HELMET_CM[kind] / Math.max(_size.y, 1e-3));
  wrapper.position.set(0, kind === 'goalie' ? 9 : 7, kind === 'goalie' ? 2.4 : 1.5);
  // The player helmet is modelled with its visor along +x; turn it to face the head's +z.
  wrapper.rotation.set(kind === 'goalie' ? 0.08 : 0.08, kind === 'goalie' ? 0 : -Math.PI / 2, 0);
  head.add(wrapper);
}

function decal(map: THREE.Texture, width: number, height: number) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      roughness: 0.55,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

/** In bind pose the Mixamo character faces world +Z; this puts a stamp on the chest or back. */
function stampOnChest(
  bone: THREE.Bone,
  mesh: THREE.Mesh,
  forward: number,
  distance: number,
  lift: number,
) {
  bone.add(mesh);
  mesh.position.set(0, lift, 0);
  bone.updateWorldMatrix(true, true);
  mesh.getWorldPosition(_world);
  mesh.lookAt(_toward.set(_world.x, _world.y, _world.z + forward));
  mesh.translateZ(distance);
}

export function createSkaterRig(
  template: THREE.Object3D,
  helmet: THREE.Object3D,
  uniform: Uniform,
  number: number,
  crest: THREE.Texture,
  goalie: boolean,
): SkaterRig {
  const root = cloneRig(template);
  const scale = HEIGHT / templateHeight(template);
  root.scale.setScalar(scale);
  paintClothes(root, uniform);

  let mesh: THREE.SkinnedMesh | undefined;
  const byName = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (!mesh && (object as THREE.SkinnedMesh).isSkinnedMesh) mesh = object as THREE.SkinnedMesh;
    if ((object as THREE.Bone).isBone) {
      const key = canonical(object.name);
      if (!byName.has(key)) byName.set(key, object as THREE.Bone);
    }
  });
  if (!mesh) throw new Error('Skater model has no skinned mesh');
  const skinned = mesh;

  const bones = {} as Record<BoneName, THREE.Bone>;
  const bind = {} as Record<BoneName, THREE.Quaternion>;
  const extra = {} as Record<BoneName, THREE.Quaternion>;
  const spin = {} as Record<BoneName, THREE.Vector3>;
  for (const name of NAMES) {
    const bone = MIXAMO[name].map((key) => byName.get(key)).find(Boolean);
    if (!bone) throw new Error(`Mixamo rig is missing ${MIXAMO[name][0]}`);
    bones[name] = bone;
    bind[name] = bone.quaternion.clone();
    extra[name] = new THREE.Quaternion();
    spin[name] = new THREE.Vector3();
  }
  const fingers: Record<Side, FingerBone[]> = { L: [], R: [] };
  for (const [key, bone] of byName) {
    const match = FINGER.exec(key);
    if (!match) continue;
    fingers[match[1] === 'Left' ? 'L' : 'R'].push({
      bone,
      bind: bone.quaternion.clone(),
      finger: match[2].toLowerCase() as Finger,
      joint: Number(match[3]),
    });
  }

  attachHelmet(helmet, bones.head, goalie ? 'goalie' : 'player');
  crest.colorSpace = THREE.SRGBColorSpace;
  stampOnChest(bones.chest, decal(crest, 32, 21), 1, 13, 7);
  const numberTexture = makeNumberTexture(number, numberInk(uniform.jersey));
  stampOnChest(bones.chest, decal(numberTexture, 20, 20), -1, 11, 4);

  root.updateMatrixWorld(true);
  const ankle = new THREE.Vector3();
  bones.footL.getWorldPosition(ankle);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bindWorld = {} as Record<BoneName, THREE.Quaternion>;
  for (const name of NAMES)
    bindWorld[name] = rootQ.clone().multiply(bones[name].getWorldQuaternion(new THREE.Quaternion()));
  const footFlat = {
    L: rootQ.clone().multiply(bones.footL.getWorldQuaternion(new THREE.Quaternion())),
    R: rootQ.clone().multiply(bones.footR.getWorldQuaternion(new THREE.Quaternion())),
  };
  const limbs = {
    upperArm: bones.forearmL.position.length() * scale,
    forearm: bones.handL.position.length() * scale,
    thigh: bones.shinL.position.length() * scale,
    shin: bones.footL.position.length() * scale,
  };
  return {
    root,
    mesh: skinned,
    bones,
    bind,
    bindWorld,
    fingers,
    ragdoll: { active: false, extra, spin },
    scale,
    ankleHeight: ankle.y,
    pelvisBind: bones.pelvis.position.clone(),
    hipOffset: bones.thighL.position.clone().multiplyScalar(scale),
    footFlat,
    limbs,
    armReach: limbs.upperArm + limbs.forearm,
    dispose() {
      root.traverse((object) => {
        const mat = (object as THREE.Mesh).material;
        if ((object as THREE.Mesh).isMesh && mat && 'dispose' in mat) mat.dispose();
      });
      numberTexture.dispose();
      skinned.skeleton.dispose();
    },
  };
}

const _basis = new THREE.Matrix4(),
  _worldQ = new THREE.Quaternion(),
  _parentQ = new THREE.Quaternion();
/** Sets a bone's world orientation. The parent's world matrix is refreshed first. */
export function setWorldQuaternion(bone: THREE.Bone, world: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_parentQ);
  bone.quaternion.copy(_parentQ.invert()).multiply(world);
}
function setWorldBasis(bone: THREE.Bone, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
  setWorldQuaternion(bone, _worldQ.setFromRotationMatrix(_basis.makeBasis(x, y, z)));
}

const _rootPos = new THREE.Vector3(),
  _toTarget = new THREE.Vector3(),
  _bend = new THREE.Vector3(),
  _mid = new THREE.Vector3(),
  _along = new THREE.Vector3(),
  _hinge = new THREE.Vector3(),
  _third = new THREE.Vector3();
export type Limb = 'arm' | 'leg';
/**
 * Two-bone IK. Places the wrist or ankle at `target` (world) with the elbow or knee pushed toward
 * `pole` (world point). Both segments get a full orientation from the bend plane, so the mesh
 * never twists about the limb: Mixamo arms hinge on local Z and legs on local X, with local Y
 * running down the bone toward the child.
 */
export function reachLimb(
  rig: SkaterRig,
  limb: Limb,
  side: Side,
  target: THREE.Vector3,
  pole: THREE.Vector3,
) {
  const upper =
      rig.bones[limb === 'arm' ? (`upperArm${side}` as const) : (`thigh${side}` as const)],
    lower = rig.bones[limb === 'arm' ? (`forearm${side}` as const) : (`shin${side}` as const)];
  const a = limb === 'arm' ? rig.limbs.upperArm : rig.limbs.thigh,
    b = limb === 'arm' ? rig.limbs.forearm : rig.limbs.shin;
  upper.getWorldPosition(_rootPos);
  _toTarget.subVectors(target, _rootPos);
  const distance = THREE.MathUtils.clamp(
    _toTarget.length(),
    Math.abs(a - b) + 1e-3,
    (a + b) * 0.995,
  );
  _toTarget.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance),
    lift = Math.sqrt(Math.max(a * a - along * along, 0));
  _bend.subVectors(pole, _rootPos);
  _bend.addScaledVector(_toTarget, -_bend.dot(_toTarget));
  if (_bend.lengthSq() < 1e-8) _bend.set(0, 0, 1).addScaledVector(_toTarget, -_toTarget.z);
  _bend.normalize();
  _mid.copy(_rootPos).addScaledVector(_toTarget, along).addScaledVector(_bend, lift);
  _hinge.crossVectors(_toTarget, _bend).normalize();
  if (limb === 'arm') _hinge.multiplyScalar(sideSign(side));
  const orient = (bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    _along.subVectors(to, from).normalize();
    if (limb === 'leg') {
      _third.crossVectors(_hinge, _along);
      setWorldBasis(bone, _hinge, _along, _third);
    } else {
      _third.crossVectors(_along, _hinge);
      setWorldBasis(bone, _third, _along, _hinge);
    }
  };
  orient(upper, _rootPos, _mid);
  orient(lower, _mid, target);
}

const _yawQ = new THREE.Quaternion(),
  _frameQ = new THREE.Quaternion(),
  _e2 = new THREE.Euler();
/**
 * Plants the skate flat on the ice: toe turned by `yaw` (+ toward the skater's left), lifted by
 * `pitch`, and the blade rolled onto its edge by `roll` (+ toward the skater's right).
 */
export function plantFoot(
  rig: SkaterRig,
  side: Side,
  frame: THREE.Object3D,
  yaw: number,
  pitch: number,
  roll: number,
) {
  frame.getWorldQuaternion(_frameQ);
  _yawQ.setFromEuler(_e2.set(pitch, yaw, roll, 'YXZ'));
  _worldQ.copy(_frameQ).multiply(_yawQ).multiply(rig.footFlat[side]);
  setWorldQuaternion(rig.bones[`foot${side}`], _worldQ);
}

const _palm = new THREE.Vector3(),
  _fingersDir = new THREE.Vector3(),
  _across = new THREE.Vector3(),
  _wrist = new THREE.Vector3(),
  _elbow = new THREE.Vector3(),
  _elbowPole = new THREE.Vector3(),
  _forearmQ = new THREE.Quaternion(),
  _handQ = new THREE.Quaternion(),
  _rollQ = new THREE.Quaternion(),
  _yAxis = new THREE.Vector3(0, 1, 0);
/**
 * Share of the wrist's twist the forearm takes as pronation. Mixamo rigs have no forearm twist
 * bones, so leaving it all at the wrist collapses the skin there like a candy wrapper.
 */
const FOREARM_TWIST = 0.6;
/**
 * Wraps a hand around the stick. `point` is on the shaft axis and `along` runs up the shaft toward
 * the knob. The knuckle line lies along the shaft and the fingers carry on from the forearm, so the
 * wrist only deviates sideways rather than folding over. Thumbs point down the shaft toward the
 * blade, like a real grip.
 */
export function holdStick(
  rig: SkaterRig,
  side: Side,
  point: THREE.Vector3,
  along: THREE.Vector3,
  pole: THREE.Vector3,
  curl: number,
) {
  const forearm = rig.bones[`forearm${side}`],
    hand = rig.bones[`hand${side}`];
  _elbowPole.copy(pole);
  // A first reach to the shaft finds the elbow, which sets where the forearm points.
  reachLimb(rig, 'arm', side, point, _elbowPole);
  forearm.getWorldPosition(_elbow);
  _fingersDir.subVectors(point, _elbow);
  _fingersDir.addScaledVector(along, -_fingersDir.dot(along));
  if (_fingersDir.lengthSq() < 1e-8) _fingersDir.set(0, -1, 0).addScaledVector(along, along.y);
  _fingersDir.normalize();
  _across.copy(along).multiplyScalar(sideSign(side));
  _palm.crossVectors(_across, _fingersDir);
  _wrist.copy(point).addScaledVector(_fingersDir, -PALM_ALONG).addScaledVector(_palm, -PALM_THICK);
  reachLimb(rig, 'arm', side, _wrist, _elbowPole);
  // Pronate the forearm part of the way toward the hand; the wrist keeps the rest.
  forearm.getWorldQuaternion(_forearmQ);
  _handQ.setFromRotationMatrix(_basis.makeBasis(_across, _fingersDir, _palm));
  _rollQ.copy(_forearmQ).invert().multiply(_handQ);
  const twist = 2 * Math.atan2(_rollQ.y, _rollQ.w);
  const wrapped = Math.atan2(Math.sin(twist), Math.cos(twist));
  forearm.quaternion.multiply(_rollQ.setFromAxisAngle(_yAxis, wrapped * FOREARM_TWIST));
  setWorldQuaternion(hand, _handQ);
  curlFingers(rig, side, curl);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** Closes the fingers around a shaft: 0 is the open bind hand, 1 a full grip. */
export function curlFingers(rig: SkaterRig, side: Side, curl: number) {
  const s = sideSign(side);
  for (const { bone, bind, finger, joint } of rig.fingers[side]) {
    if (finger === 'thumb') {
      // Thumb folds across the shaft rather than curling with the fingers.
      if (joint === 1) _e.set(0.15 * curl, -s * 0.35 * curl, s * 0.55 * curl);
      else _e.set(0.5 * curl, 0, s * 0.15 * curl);
    } else {
      const spread = joint === 1 ? (finger === 'index' ? -0.06 : finger === 'pinky' ? 0.08 : 0) : 0;
      _e.set((joint === 1 ? 1.15 : joint === 2 ? 1.35 : 0.9) * curl, 0, s * spread * curl);
    }
    bone.quaternion.copy(bind).multiply(_q.setFromEuler(_e));
  }
}

/** Adds a local pose on top of the Mixamo bind so other characters keep their T-pose rest. */
export function poseBone(rig: SkaterRig, name: BoneName, x: number, y: number, z: number) {
  rig.bones[name].quaternion.copy(rig.bind[name]).multiply(_q.setFromEuler(_e.set(x, y, z)));
}
