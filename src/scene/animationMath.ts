import * as THREE from 'three';

const direction = new THREE.Vector3();
const bend = new THREE.Vector3();
const fallback = new THREE.Vector3();

/** Analytic IK with a reachable endpoint and a stable bend plane, including collinear poles. */
export function solveTwoBone(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  upper: number,
  lower: number,
  minBend: number,
  maxBend: number,
  joint: THREE.Vector3,
  end: THREE.Vector3,
  normal: THREE.Vector3,
) {
  direction.subVectors(target, origin);
  const requested = direction.length();
  if (requested < 1e-7) direction.set(0, -1, 0);
  else direction.multiplyScalar(1 / requested);
  const reachAt = (angle: number) =>
    Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(angle));
  const distance = THREE.MathUtils.clamp(requested, reachAt(maxBend), reachAt(minBend));
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  bend.subVectors(pole, origin).addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    fallback.set(Math.abs(direction.x) < 0.8 ? 1 : 0, Math.abs(direction.x) < 0.8 ? 0 : 1, 0);
    bend.copy(fallback).addScaledVector(direction, -fallback.dot(direction));
  }
  bend.normalize();
  end.copy(origin).addScaledVector(direction, distance);
  joint.copy(origin).addScaledVector(direction, along).addScaledVector(bend, height);
  normal.crossVectors(direction, bend).normalize();
}

const twist = new THREE.Quaternion();
const swing = new THREE.Quaternion();
const inverseTwist = new THREE.Quaternion();
const identity = new THREE.Quaternion();

/** Limit deviation from a calibrated wrist rest pose; local Y follows the hand. */
export function limitWrist(q: THREE.Quaternion, maxSwing = 0.85, maxTwist = 0.65) {
  twist.set(0, q.y, 0, q.w);
  if (twist.lengthSq() < 1e-10) twist.identity();
  else twist.normalize();
  swing.copy(q).multiply(inverseTwist.copy(twist).invert());
  const angle = identity.angleTo(swing);
  if (angle > maxSwing) swing.slerp(identity, 1 - maxSwing / angle);
  const roll = 2 * Math.atan2(twist.y, twist.w);
  const wrapped = Math.atan2(Math.sin(roll), Math.cos(roll));
  twist.set(
    0,
    Math.sin(THREE.MathUtils.clamp(wrapped, -maxTwist, maxTwist) / 2),
    0,
    Math.cos(THREE.MathUtils.clamp(wrapped, -maxTwist, maxTwist) / 2),
  );
  return q.copy(swing).multiply(twist).normalize();
}
