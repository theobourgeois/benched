import * as THREE from 'three';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Uniform } from '../game/clubs';
import { makeNumberTexture } from './textures';

/** Mixamo-rigged character (see public/models/CREDITS.txt). mixamorig / mixamorig12 both work. */
export const SKATER_URL = `${import.meta.env.BASE_URL}models/skater.fbx`;
export const HELMET_PLAYER_URL = `${import.meta.env.BASE_URL}models/helmet-player.glb`;
export const HELMET_GOALIE_URL = `${import.meta.env.BASE_URL}models/helmet-goalie.glb`;
const HEIGHT = 2;
const HAND_REACH = 0.08;
/** Helmet height in Mixamo centimetres, parented to the head bone. */
const HELMET_CM = { player: 30, goalie: 30 } as const;

export const SIDES = ['L', 'R'] as const; // L is the skater's left (+x), R their right (-x).
export type Side = (typeof SIDES)[number];
export type BoneName =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'head'
  | `thigh${Side}`
  | `shin${Side}`
  | `foot${Side}`
  | `upperArm${Side}`
  | `forearm${Side}`
  | `hand${Side}`;

const MIXAMO: Record<BoneName, string[]> = {
  pelvis: ['Hips'],
  spine: ['Spine'],
  chest: ['Spine2', 'Spine1'],
  head: ['Head'],
  thighL: ['LeftUpLeg'],
  shinL: ['LeftLeg'],
  footL: ['LeftFoot'],
  upperArmL: ['LeftArm'],
  forearmL: ['LeftForeArm'],
  handL: ['LeftHand'],
  thighR: ['RightUpLeg'],
  shinR: ['RightLeg'],
  footR: ['RightFoot'],
  upperArmR: ['RightArm'],
  forearmR: ['RightForeArm'],
  handR: ['RightHand'],
};
export const NAMES = Object.keys(MIXAMO) as BoneName[];

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
  ragdoll: Ragdoll;
  /** Bind-pose ankle height, used to keep the skates on the ice. */
  ankleHeight: number;
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
  wrapper.position.set(0, kind === 'goalie' ? 9 : 6, kind === 'goalie' ? 2.4 : 2);
  wrapper.rotation.x = kind === 'goalie' ? 0.08 : 0.18;
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

  attachHelmet(helmet, bones.head, goalie ? 'goalie' : 'player');
  crest.colorSpace = THREE.SRGBColorSpace;
  stampOnChest(bones.chest, decal(crest, 32, 21), 1, 13, 7);
  const numberTexture = makeNumberTexture(number, numberInk(uniform.jersey));
  stampOnChest(bones.chest, decal(numberTexture, 20, 20), -1, 11, 4);

  root.updateMatrixWorld(true);
  const ankle = new THREE.Vector3();
  bones.footL.getWorldPosition(ankle);
  return {
    root,
    mesh: skinned,
    bones,
    bind,
    ragdoll: { active: false, extra, spin },
    ankleHeight: ankle.y,
    armReach:
      bones.forearmL.position.length() * scale + bones.handL.position.length() * scale + HAND_REACH,
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

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
/** Adds a local pose on top of the Mixamo bind so other characters keep their T-pose rest. */
export function poseBone(rig: SkaterRig, name: BoneName, x: number, y: number, z: number) {
  rig.bones[name].quaternion.copy(rig.bind[name]).multiply(_q.setFromEuler(_e.set(x, y, z)));
}

const _shoulder = new THREE.Vector3(),
  _toTarget = new THREE.Vector3(),
  _bend = new THREE.Vector3(),
  _elbow = new THREE.Vector3(),
  _segment = new THREE.Vector3(),
  _rest = new THREE.Vector3(),
  _parentQ = new THREE.Quaternion();
/** Rotates a Mixamo bone so its local +Y (the child) points along a world direction. */
function aimBone(bone: THREE.Bone, child: THREE.Bone, direction: THREE.Vector3) {
  _rest.copy(child.position);
  if (_rest.lengthSq() < 1e-8) return;
  _rest.normalize();
  bone.parent!.getWorldQuaternion(_parentQ);
  _segment.copy(direction).applyQuaternion(_parentQ.invert()).normalize();
  bone.quaternion.setFromUnitVectors(_rest, _segment);
}
/** Two-bone arm IK that places the wrist at `target`, elbow bent towards `pole`. */
export function reachArm(rig: SkaterRig, side: Side, target: THREE.Vector3, pole: THREE.Vector3) {
  const upper = rig.bones[`upperArm${side}`],
    fore = rig.bones[`forearm${side}`],
    hand = rig.bones[`hand${side}`];
  const a = fore.position.length() * rig.root.scale.x,
    b = hand.position.length() * rig.root.scale.x + HAND_REACH;
  upper.getWorldPosition(_shoulder);
  _toTarget.subVectors(target, _shoulder);
  const distance = THREE.MathUtils.clamp(_toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  _toTarget.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance),
    lift = Math.sqrt(Math.max(a * a - along * along, 0));
  _bend.subVectors(pole, _shoulder);
  _bend.addScaledVector(_toTarget, -_bend.dot(_toTarget)).normalize();
  _elbow.copy(_shoulder).addScaledVector(_toTarget, along).addScaledVector(_bend, lift);
  aimBone(upper, fore, _segment.subVectors(_elbow, _shoulder));
  upper.updateWorldMatrix(true, false);
  aimBone(fore, hand, _segment.subVectors(target, _elbow));
}
