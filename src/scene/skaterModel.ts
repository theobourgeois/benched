import * as THREE from 'three';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Uniform } from '../game/clubs';
import { makeNumberTexture } from './textures';
import { limitWrist, solveTwoBone } from './animationMath';
import { fitHockeyEquipment, SKATE_LIFT } from './hockeyEquipment';

/** Mixamo-rigged character (see public/models/CREDITS.txt). mixamorig / mixamorig12 both work. */
export const SKATER_URL = `${import.meta.env.BASE_URL}models/skater.fbx`;
export const HELMET_PLAYER_URL = `${import.meta.env.BASE_URL}models/helmet-player.glb`;
export const HELMET_GOALIE_URL = `${import.meta.env.BASE_URL}models/helmet-goalie.glb`;
const HEIGHT = 2;
/**
 * Ch01's arms are short for its height (0.55 shoulder to wrist on a 2 unit body, about 13% under
 * real proportions), which pinned the bottom hand against the top one. Both segments are lengthened.
 */
const ARM_STRETCH = 1.15;
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
  goaliePads: Partial<Record<Side, THREE.Group>>;
  /** Solver frame to the actual bone rest axes, calibrated once per imported rig. */
  limbFrame: Partial<Record<BoneName, THREE.Quaternion>>;
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

  for (const side of SIDES) {
    bones[`forearm${side}`].position.multiplyScalar(ARM_STRETCH);
    bones[`hand${side}`].position.multiplyScalar(ARM_STRETCH);
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
    bindWorld[name] = rootQ
      .clone()
      .multiply(bones[name].getWorldQuaternion(new THREE.Quaternion()));
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
  const { dispose: disposeEquipment, pads: goaliePads } = fitHockeyEquipment(
    bones,
    bindWorld,
    scale,
    ankle.y,
    goalie,
  );
  const limbFrame: Partial<Record<BoneName, THREE.Quaternion>> = {};
  for (const side of SIDES) {
    for (const [name, child, arm] of [
      [`upperArm${side}`, `forearm${side}`, true],
      [`forearm${side}`, `hand${side}`, true],
      [`thigh${side}`, `shin${side}`, false],
      [`shin${side}`, `foot${side}`, false],
    ] as [BoneName, BoneName, boolean][]) {
      const y = bones[child].position.clone().normalize().applyQuaternion(bindWorld[name]);
      const x = new THREE.Vector3(arm ? 0 : -1, arm ? -1 : 0, 0);
      x.addScaledVector(y, -x.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y).normalize();
      const reference = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(x, y, z),
      );
      limbFrame[name] = reference.invert().multiply(bindWorld[name]);
    }
  }
  return {
    root,
    mesh: skinned,
    bones,
    bind,
    bindWorld,
    fingers,
    ragdoll: { active: false, extra, spin },
    scale,
    ankleHeight: ankle.y + SKATE_LIFT,
    pelvisBind: bones.pelvis.position.clone(),
    hipOffset: bones.thighL.position.clone().multiplyScalar(scale),
    footFlat,
    limbs,
    armReach: limbs.upperArm + limbs.forearm,
    limbFrame,
    goaliePads,
    dispose() {
      disposeEquipment();
      const materials = new Set<THREE.Material>();
      const skeletons = new Set<THREE.Skeleton>();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            materials.add(material);
        }
        if ((object as THREE.SkinnedMesh).isSkinnedMesh)
          skeletons.add((object as THREE.SkinnedMesh).skeleton);
      });
      materials.forEach((material) => material.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
      numberTexture.dispose();
    },
  };
}

const _basis = new THREE.Matrix4(),
  _worldQ = new THREE.Quaternion(),
  _parentQ = new THREE.Quaternion();
/** Sets a bone's world orientation. The parent's world matrix is refreshed first. */
export function setWorldQuaternion(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_parentQ);
  bone.quaternion.copy(_parentQ.invert()).multiply(world);
}
const _rootPos = new THREE.Vector3(),
  _mid = new THREE.Vector3(),
  _end = new THREE.Vector3(),
  _along = new THREE.Vector3(),
  _hinge = new THREE.Vector3(),
  _third = new THREE.Vector3();
export type Limb = 'arm' | 'leg';
/** Calibrated two-bone IK. Bend limits avoid locked elbows and hyperextended knees. */
export function reachLimb(
  rig: SkaterRig,
  limb: Limb,
  side: Side,
  target: THREE.Vector3,
  pole: THREE.Vector3,
) {
  const upperName: BoneName = limb === 'arm' ? `upperArm${side}` : `thigh${side}`;
  const lowerName: BoneName = limb === 'arm' ? `forearm${side}` : `shin${side}`;
  const upper = rig.bones[upperName],
    lower = rig.bones[lowerName];
  // Measure each side: imported rigs need not have exactly symmetrical limbs.
  const a = lower.position.length() * rig.scale;
  const b =
    rig.bones[(limb === 'arm' ? `hand${side}` : `foot${side}`) as BoneName].position.length() *
    rig.scale;
  upper.getWorldPosition(_rootPos);
  solveTwoBone(
    _rootPos,
    target,
    pole,
    a,
    b,
    limb === 'arm' ? 0.18 : 0.08,
    limb === 'arm' ? 2.55 : 2.65,
    _mid,
    _end,
    _hinge,
  );
  // limbFrame reads the bind-pose hinge as straight down. With this sign the back of the elbow (the
  // olecranon) faces the pole; the other sign turned both arms half a turn, so the crease faced out
  // and the elbow looked bent backwards.
  if (limb === 'arm') _hinge.multiplyScalar(-sideSign(side));
  const orient = (name: BoneName, from: THREE.Vector3, to: THREE.Vector3) => {
    _along.subVectors(to, from).normalize();
    _third.crossVectors(_hinge, _along).normalize();
    _worldQ.setFromRotationMatrix(_basis.makeBasis(_hinge, _along, _third));
    _worldQ.multiply(rig.limbFrame[name]!);
    setWorldQuaternion(rig.bones[name], _worldQ);
  };
  orient(upperName, _rootPos, _mid);
  orient(lowerName, _mid, _end);
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

const _padY = new THREE.Vector3(),
  _padZ = new THREE.Vector3(),
  _padX = new THREE.Vector3(),
  _kneePos = new THREE.Vector3(),
  _anklePos = new THREE.Vector3(),
  _padFrame = new THREE.Quaternion();
/** Goal pads rotate around the shin to keep their broad face toward the puck in a butterfly. */
export function faceGoaliePads(rig: SkaterRig, frame: THREE.Object3D) {
  frame.getWorldQuaternion(_padFrame);
  for (const side of SIDES) {
    const pad = rig.goaliePads[side];
    if (!pad) continue;
    rig.bones[`shin${side}`].getWorldPosition(_kneePos);
    rig.bones[`foot${side}`].getWorldPosition(_anklePos);
    _padY.subVectors(_kneePos, _anklePos).normalize();
    _padZ.set(0, 0, 1).applyQuaternion(_padFrame);
    _padZ.addScaledVector(_padY, -_padZ.dot(_padY));
    if (_padZ.lengthSq() < 1e-8) {
      _padZ.set(0, 1, 0).applyQuaternion(_padFrame);
      _padZ.addScaledVector(_padY, -_padZ.dot(_padY));
    }
    _padZ.normalize();
    _padX.crossVectors(_padY, _padZ).normalize();
    _worldQ.setFromRotationMatrix(_basis.makeBasis(_padX, _padY, _padZ));
    setWorldQuaternion(pad, _worldQ);
  }
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
  _inverseHand = new THREE.Quaternion(),
  _yAxis = new THREE.Vector3(0, 1, 0);
/**
 * Share of the wrist's twist the forearm takes as pronation. Mixamo rigs have no forearm twist
 * bones, so leaving it all at the wrist collapses the skin there like a candy wrapper.
 */
const FOREARM_TWIST = 0.7;
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
  forearm.quaternion.multiply(
    _rollQ.setFromAxisAngle(_yAxis, THREE.MathUtils.clamp(wrapped * FOREARM_TWIST, -1.25, 1.25)),
  );
  // Limit the remaining wrist deviation relative to this character's rest hand.
  forearm.getWorldQuaternion(_forearmQ);
  _rollQ.copy(_forearmQ).multiply(rig.bind[`hand${side}`]);
  _handQ.premultiply(_inverseHand.copy(_rollQ).invert());
  limitWrist(_handQ);
  _handQ.premultiply(_rollQ);
  // Recompute the wrist from the constrained palm, so limiting rotation cannot open the grip.
  _fingersDir.set(0, 1, 0).applyQuaternion(_handQ);
  _palm.set(0, 0, 1).applyQuaternion(_handQ);
  _wrist.copy(point).addScaledVector(_fingersDir, -PALM_ALONG).addScaledVector(_palm, -PALM_THICK);
  reachLimb(rig, 'arm', side, _wrist, _elbowPole);
  forearm.quaternion.multiply(
    _rollQ.setFromAxisAngle(_yAxis, THREE.MathUtils.clamp(wrapped * FOREARM_TWIST, -1.25, 1.25)),
  );
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
