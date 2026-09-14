import * as THREE from 'three';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Uniform } from '../game/clubs';

/** Mixamo-rigged character (see public/models/CREDITS.txt). Any mixamorig_* skeleton can drop in. */
export const SKATER_URL = `${import.meta.env.BASE_URL}models/skater.fbx`;
const HEIGHT = 2;
const HAND_REACH = 0.08;

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
  return name.replace(/^mixamorig[:_]?/i, '');
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

export function createSkaterRig(template: THREE.Object3D, uniform: Uniform): SkaterRig {
  const root = cloneRig(template);
  const scale = HEIGHT / templateHeight(template);
  root.scale.setScalar(scale);
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const joint = /joint/i.test(mesh.name);
    mesh.material = new THREE.MeshStandardMaterial({
      color: joint ? uniform.trim : uniform.jersey,
      roughness: joint ? 0.35 : 0.55,
      metalness: joint ? 0.25 : 0.05,
    });
  });

  let mesh: THREE.SkinnedMesh | undefined;
  root.traverse((object) => {
    if (!mesh && (object as THREE.SkinnedMesh).isSkinnedMesh) mesh = object as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error('Skater model has no skinned mesh');
  const skinned = mesh;

  const byName = new Map<string, THREE.Bone>();
  for (const bone of skinned.skeleton.bones) {
    const key = canonical(bone.name);
    if (!byName.has(key)) byName.set(key, bone);
  }
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
