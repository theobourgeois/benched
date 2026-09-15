import * as THREE from 'three';

/** Blade size in world units (a skater is about 2 units tall). */
export interface BladeSpec {
  length: number;
  height: number;
  /** Fixed hosel-to-knob length. */
  shaft: number;
}
// Slightly oversized against a real 30 cm blade so it still reads from the broadcast camera.
export const SKATER_BLADE: BladeSpec = { length: 0.34, height: 0.08, shaft: 1.42 };
export const GOALIE_BLADE: BladeSpec = { length: 0.4, height: 0.095, shaft: 1.48 };
const THICKNESS = 0.014,
  CURVE = 0.035,
  KNOB_PAST_HAND = 0.1;

/** Hooks the toe towards the forehand face (+z), more strongly near the toe. */
function bend(geometry: THREE.BufferGeometry, length: number) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getX(i) / length, 0, 1);
    position.setZ(i, position.getZ(i) + CURVE * t * t);
  }
  geometry.computeVertexNormals();
  return geometry;
}
/** Straight edge with intermediate points, so the bend stays smooth along it. */
function edge(shape: THREE.Shape, x0: number, y0: number, x1: number, y1: number, steps = 8) {
  for (let i = 1; i <= steps; i++)
    shape.lineTo(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
}
function bladeGeometry({ length, height }: BladeSpec) {
  // Side profile from the heel (x = 0): slight rocker, rounded toe, top edge tapering to the heel.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.006);
  shape.quadraticCurveTo(length * 0.5, -0.004, length - 0.035, 0.002);
  shape.quadraticCurveTo(length + 0.004, 0.006, length, height * 0.55);
  shape.quadraticCurveTo(length - 0.004, height, length - 0.05, height);
  edge(shape, length - 0.05, height, 0.03, height * 0.9);
  shape.quadraticCurveTo(-0.006, height * 0.8, 0, 0.006);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: THICKNESS,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 1,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -THICKNESS / 2);
  return bend(geometry, length);
}
function tapeGeometry({ length, height }: BladeSpec) {
  const x0 = length * 0.18,
    x1 = length * 0.8,
    top = height * 0.9,
    depth = THICKNESS + 0.008;
  const shape = new THREE.Shape();
  shape.moveTo(x0, -0.001);
  edge(shape, x0, -0.001, x1, -0.001);
  shape.lineTo(x1, top);
  edge(shape, x1, top, x0, top);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return bend(geometry, length);
}
const blades = new Map<BladeSpec, { blade: THREE.BufferGeometry; tape: THREE.BufferGeometry }>();
export function bladeGeometries(spec: BladeSpec) {
  let geometries = blades.get(spec);
  if (!geometries)
    blades.set(spec, (geometries = { blade: bladeGeometry(spec), tape: tapeGeometry(spec) }));
  return geometries;
}
export const shaftGeometry = new THREE.BoxGeometry(0.03, 1, 0.022);
export const knobGeometry = new THREE.BoxGeometry(0.036, 0.09, 0.027);
export const paddleGeometry = new THREE.BoxGeometry(0.075, 1, 0.024);
export const STICK_MATERIALS = {
  shaft: new THREE.MeshStandardMaterial({ color: '#1c222b', roughness: 0.35, metalness: 0.1 }),
  blade: new THREE.MeshStandardMaterial({ color: '#15191f', roughness: 0.5 }),
  tape: new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.9 }),
};

export interface StickParts {
  root: THREE.Group;
  shaft: THREE.Mesh;
  knob: THREE.Mesh;
  paddle: THREE.Mesh | null;
}
const UP = new THREE.Vector3(0, 1, 0);
const _flat = new THREE.Vector3(),
  _heel = new THREE.Vector3(),
  _side = new THREE.Vector3(),
  _basis = new THREE.Matrix4();
/**
 * Poses a stick so the blade sits at `tip` on the ice and the shaft runs up through `grip`.
 * Like a real stick, the blade continues the shaft's line along the ice. `heading` keeps the last
 * blade direction for when the hands are directly above the tip. Writes the hosel (where the
 * shaft meets the blade) into `hosel`. Updates `grip` to the fixed-length shaft's top-hand socket;
 * all points share the stick parent's space.
 */
export function placeStick(
  parts: StickParts,
  spec: BladeSpec,
  grip: THREE.Vector3,
  tip: THREE.Vector3,
  heading: THREE.Vector3,
  hosel: THREE.Vector3,
  shoulder?: THREE.Vector3,
  armReach = 0.5,
) {
  _flat.set(tip.x - grip.x, 0, tip.z - grip.z);
  if (_flat.lengthSq() > 1e-4) heading.copy(_flat.normalize());
  _heel.copy(tip).addScaledVector(heading, -spec.length * 0.45);
  _heel.y = tip.y;
  _side.crossVectors(heading, UP);
  parts.root.position.copy(_heel);
  parts.root.quaternion.setFromRotationMatrix(_basis.makeBasis(heading, UP, _side));

  // The shaft lies in the stick's plane: from the hosel through the top hand, a little past it.
  const hx = HOSEL_X,
    hy = spec.height * 0.6;
  _flat.subVectors(grip, _heel);
  let gx = _flat.dot(heading) - hx,
    gy = _flat.y - hy;
  let angle = Math.atan2(gx, gy);
  const reach = spec.shaft - KNOB_PAST_HAND;
  hosel.copy(_heel).addScaledVector(heading, hx).addScaledVector(UP, hy);
  if (shoulder) {
    // Intersect the fixed socket circle in the blade plane with the shoulder's reach sphere.
    // Constrain shaft tilt before posing the arm, instead of stretching either the arm or stick.
    _flat.subVectors(shoulder, hosel);
    const sx = _flat.dot(heading),
      sy = _flat.y,
      depth = _flat.dot(_side);
    const distance = Math.hypot(sx, sy);
    const radius2 = Math.max(0, armReach * armReach - depth * depth);
    if (distance > 1e-5) {
      const center = Math.atan2(sx, sy);
      const halfAngle = Math.acos(
        THREE.MathUtils.clamp(
          (reach * reach + distance * distance - radius2) / (2 * reach * distance),
          -1,
          1,
        ),
      );
      let delta = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
      // Keep enough room to bend the elbow: a socket against the shoulder is unreachable too.
      const innerRadius2 = Math.max(0, 0.25 * 0.25 - depth * depth);
      const innerAngle = Math.acos(
        THREE.MathUtils.clamp(
          (reach * reach + distance * distance - innerRadius2) / (2 * reach * distance),
          -1,
          1,
        ),
      );
      if (Math.abs(delta) < innerAngle) delta = (Math.sign(delta) || -1) * innerAngle;
      angle = center + THREE.MathUtils.clamp(delta, -halfAngle, halfAngle);
    }
  }
  gx = Math.sin(angle);
  gy = Math.cos(angle);
  layoutShaft(parts, spec, -angle, spec.shaft);
  grip
    .copy(hosel)
    .addScaledVector(heading, gx * reach)
    .addScaledVector(UP, gy * reach);
  return hosel;
}

const HOSEL_X = 0.015;
/** Lays the shaft, knob and paddle out in the stick's plane at a tilt from vertical and a length. */
export function layoutShaft(parts: StickParts, spec: BladeSpec, tilt: number, length: number) {
  const hx = HOSEL_X,
    hy = spec.height * 0.6,
    ux = -Math.sin(tilt),
    uy = Math.cos(tilt);
  parts.shaft.position.set(hx + (ux * length) / 2, hy + (uy * length) / 2, 0);
  parts.shaft.rotation.set(0, 0, tilt);
  parts.shaft.scale.y = length;
  parts.knob.position.set(hx + ux * (length - 0.045), hy + uy * (length - 0.045), 0);
  parts.knob.rotation.set(0, 0, tilt);
  if (parts.paddle) {
    const paddle = Math.min(0.6, length * 0.42);
    parts.paddle.position.set(hx + (ux * paddle) / 2, hy + (uy * paddle) / 2, 0);
    parts.paddle.rotation.set(0, 0, tilt);
    parts.paddle.scale.y = paddle;
  }
}
