import * as THREE from 'three';

/** Blade size in world units (a skater is about 2 units tall). */
export interface BladeSpec {
  length: number;
  height: number;
  /** Fixed hosel-to-knob length. */
  shaft: number;
  /** Goalies hold near the paddle, below the knob. */
  grip?: number;
  /**
   * A rigid modelled stick: the shaft's rise off the ice, in radians, when the blade lies flat. The
   * whole stick then rocks onto its heel or toe. Without it the shaft pivots freely at the hosel
   * and the blade always lies flat.
   */
  lie?: number;
  /** Root to where the puck meets the blade; defaults to 45% of the length. */
  contact?: number;
}

/**
 * "Hockey Stick" by grimren13 on Sketchfab (CC BY-NC 4.0), see public/models/CREDITS.txt.
 * Measured on the source mesh, in its centimetres: the shaft runs up +y from the knob end at
 * y = -15.28 along x = z = 0. The flat middle of the blade's bottom edge passes through
 * (-5.96, 163.09) heading for the toe along (-0.671, 0.742), and the toe hooks toward -z.
 */
export const STICK_URL = `${import.meta.env.BASE_URL}models/hockey-stick.glb`;
const SRC_EDGE = new THREE.Vector3(-5.96, 163.09, 0);
const SRC_TOE = new THREE.Vector3(-0.671, 0.742, 0).normalize();
/** In the blade's plane, from the bottom edge toward the top edge. */
const SRC_UP = new THREE.Vector3(-SRC_TOE.y, SRC_TOE.x, 0);
const SRC_KNOB_Y = -15.28;
/** Along the bottom edge from SRC_EDGE to where the shaft's axis meets it. */
const SRC_AXIS = -SRC_EDGE.x / SRC_TOE.x;
/** From there up the shaft to the knob end. */
const SRC_SHAFT = SRC_EDGE.y + SRC_AXIS * SRC_TOE.y - SRC_KNOB_Y;
/** The source stick's lie, about 42 degrees. */
const SRC_LIE = Math.atan2(-SRC_UP.y, SRC_TOE.y);
/** Toe tip, and the end of the flat middle of the blade, along the bottom edge from SRC_EDGE. */
const SRC_TOE_TIP = 14.15,
  SRC_FLAT_END = 9.2;
/**
 * The lie the shaft is rebent to. Players pick a lie that lays the blade flat in their stance;
 * this one does so with the top hand at the belt and the puck at the carrying reach.
 */
const STICK_LIE = 0.84;
/** The source blade is barely wider than the oversized puck, so it is lengthened to read on camera. */
const BLADE_STRETCH = 1.6;
/** The source shaft is thin against the gloves; its section is widened toward a real one. */
const SHAFT_WIDE = 1.25,
  SHAFT_DEEP = 1.6;

const THICKNESS = 0.014,
  CURVE = 0.035,
  KNOB_PAST_HAND = 0.1,
  HOSEL_X = 0.015;
const SKATER_HEIGHT = 0.08,
  SKATER_SHAFT = 1.42;
/** Where the model's shaft axis meets the ice line in the stick frame, and its source scale. */
const MODEL_HEEL = HOSEL_X + (SKATER_HEIGHT * 0.6) / Math.tan(STICK_LIE),
  MODEL_SCALE = (SKATER_SHAFT + (SKATER_HEIGHT * 0.6) / Math.sin(STICK_LIE)) / SRC_SHAFT;
/** A point on the source blade's bottom edge, measured from SRC_EDGE, to the stick frame's x. */
const modelX = (edge: number) => MODEL_HEEL + stretchBlade(edge - SRC_AXIS)[0] * MODEL_SCALE;
// The stretched blade is oversized against a real 30 cm one so it still reads from the broadcast
// camera. The puck meets it in the middle of the flat.
export const SKATER_BLADE: BladeSpec = {
  length: modelX(SRC_TOE_TIP),
  height: SKATER_HEIGHT,
  shaft: SKATER_SHAFT,
  lie: STICK_LIE,
  contact: (modelX(0) + modelX(SRC_FLAT_END)) / 2,
};
export const GOALIE_BLADE: BladeSpec = { length: 0.4, height: 0.095, shaft: 1.48, grip: 0.82 };

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

/** C1 blend from 1:1 at the hosel to BLADE_STRETCH along the blade, in source centimetres. */
function stretchBlade(x: number): [position: number, slope: number] {
  const a = 1,
    b = 4,
    k = BLADE_STRETCH;
  if (x <= a) return [x, 1];
  const u = Math.min(x, b) - a;
  const blended = a + u + ((k - 1) * u * u) / (2 * (b - a));
  if (x < b) return [blended, 1 + ((k - 1) * u) / (b - a)];
  return [blended + k * (x - b), k];
}

const models = new WeakMap<
  THREE.Object3D,
  { geometry: THREE.BufferGeometry; material: THREE.Material }
>();
const _src = new THREE.Vector3();
/**
 * The modelled skater stick in the stick root's frame, like the procedural blade: heel on the ice
 * at the origin, toe along +x, forehand face +z, and the shaft axis through the hosel socket that
 * `layoutShaft` uses. Built once per loaded model.
 */
export function stickModel(scene: THREE.Object3D) {
  const cached = models.get(scene);
  if (cached) return cached;
  scene.updateMatrixWorld(true);
  let source: THREE.Mesh | undefined;
  scene.traverse((object) => {
    if (!source && (object as THREE.Mesh).isMesh) source = object as THREE.Mesh;
  });
  if (!source) throw new Error('Stick model has no mesh');
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  // Normal maps fall back to screen-space tangents, which stay right through the mirror below.
  for (const name of ['tangent', 'uv1', 'uv2', 'uv3']) geometry.deleteAttribute(name);
  const ux = -Math.cos(STICK_LIE),
    uy = Math.sin(STICK_LIE),
    srcUx = -Math.cos(SRC_LIE),
    srcUy = Math.sin(SRC_LIE);
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    // Source to the blade frame. z is mirrored so the toe hooks toward the forehand.
    _src.fromBufferAttribute(position, i).sub(SRC_EDGE);
    let x = _src.dot(SRC_TOE) - SRC_AXIS,
      y = _src.dot(SRC_UP),
      z = -_src.z;
    _src.fromBufferAttribute(normal, i);
    let nx = _src.dot(SRC_TOE),
      ny = _src.dot(SRC_UP),
      nz = -_src.z;
    // Rebend the shaft to the stick's lie just above the hosel.
    const turn = (SRC_LIE - STICK_LIE) * THREE.MathUtils.smoothstep(x * srcUx + y * srcUy, 2, 12);
    const c = Math.cos(turn),
      s = Math.sin(turn);
    [x, y] = [x * c - y * s, x * s + y * c];
    [nx, ny] = [nx * c - ny * s, nx * s + ny * c];
    // Widen the shaft's section above the hosel; the blade keeps its own.
    const along = x * ux + y * uy,
      across = x * uy - y * ux;
    const w = THREE.MathUtils.smoothstep(along, 4, 10);
    const wide = 1 + (SHAFT_WIDE - 1) * w,
      deep = 1 + (SHAFT_DEEP - 1) * w;
    x = along * ux + across * wide * uy;
    y = along * uy - across * wide * ux;
    z *= deep;
    const nAlong = nx * ux + ny * uy,
      nAcross = (nx * uy - ny * ux) / wide;
    nx = nAlong * ux + nAcross * uy;
    ny = nAlong * uy - nAcross * ux;
    nz /= deep;
    const [stretched, slope] = stretchBlade(x);
    position.setXYZ(i, MODEL_HEEL + stretched * MODEL_SCALE, y * MODEL_SCALE, z * MODEL_SCALE);
    _src.set(nx / slope, ny, nz).normalize();
    normal.setXYZ(i, _src.x, _src.y, _src.z);
  }
  // The mirror flips every triangle; restore the winding so front faces stay front.
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  } else {
    for (const attribute of Object.values(geometry.attributes)) {
      const a = attribute as THREE.BufferAttribute;
      for (let i = 0; i + 2 < a.count; i += 3)
        for (let k = 0; k < a.itemSize; k++) {
          const b = a.getComponent(i + 1, k);
          a.setComponent(i + 1, k, a.getComponent(i + 2, k));
          a.setComponent(i + 2, k, b);
        }
    }
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = (Array.isArray(source.material) ? source.material[0] : source.material).clone();
  const model = { geometry, material };
  models.set(scene, model);
  return model;
}

export interface StickParts {
  root: THREE.Group;
  shaft: THREE.Mesh;
  knob: THREE.Mesh;
  paddle: THREE.Mesh | null;
}
const UP = new THREE.Vector3(0, 1, 0),
  FORWARD_FACE = new THREE.Vector3(0, 0, 1);
const _flat = new THREE.Vector3(),
  _heel = new THREE.Vector3(),
  _side = new THREE.Vector3(),
  _basis = new THREE.Matrix4(),
  _planeQ = new THREE.Quaternion(),
  _rollQ = new THREE.Quaternion(),
  _local = new THREE.Vector3(),
  _socket = new THREE.Vector3(),
  _want = new THREE.Vector3(),
  _leadPos = new THREE.Vector3();
/** The top hand needs room to bend its elbow: a socket against the shoulder is unreachable too. */
const INNER_REACH = 0.25;
/** How far ahead of the skater's axis the rigid stick's top hand stays: the belly. */
const BODY_FRONT = 0.14;
/**
 * How far the top hand stays from the pelvis-to-neck line, square to it: the jersey reaches 0.09 to
 * 0.145 ahead of that line between the hips and the chest, plus the glove.
 */
const TORSO_FRONT = 0.17;
/**
 * How far a point is in front of the belly, measured flat; negative inside it. With the spine
 * direction the belly is taken at the point's own height: the torso leans forward, so at the hands
 * it is well ahead of the pelvis, and a plane through the pelvis let the hands sink into it.
 */
function clearance(
  point: THREE.Vector3,
  torso: NonNullable<StickReach['torso']>,
  height = point.y,
  deep = 1,
) {
  const flat = (point.x - torso.at.x) * torso.front.x + (point.z - torso.at.z) * torso.front.z;
  if (!torso.up || deep <= 0) return flat - BODY_FRONT;
  const upright = Math.max(torso.up.y, 0.3);
  const rise = (height - torso.at.y) / upright;
  const ahead = flat - (torso.up.x * torso.front.x + torso.up.z * torso.front.z) * rise;
  return THREE.MathUtils.lerp(flat - BODY_FRONT, ahead - TORSO_FRONT / upright, deep);
}
/**
 * How much of the leaning belly applies, by how far ahead the blade is. With the puck out front the
 * hands fit ahead of the belly. Pulled in to the skates they cannot, and holding them out there
 * jammed them up against the shoulder, so a close blade keeps the plane through the pelvis.
 */
function bellyDepth(tip: THREE.Vector3, torso: NonNullable<StickReach['torso']>) {
  const ahead = (tip.x - torso.at.x) * torso.front.x + (tip.z - torso.at.z) * torso.front.z;
  // Bent right over (a deep crouch, a jump's load) the hands hang under the chest, which the
  // leaning plane counts as inside the body and answers by standing the stick on its toe with
  // the hands at the chin. It fades back to the upright plane through the pelvis as the torso
  // pitches past about 40°.
  const upright = torso.up ? THREE.MathUtils.smoothstep(torso.up.y, 0.66, 0.82) : 1;
  return THREE.MathUtils.smoothstep(ahead, 0.9, 1.15) * upright;
}
/** How far a rigid stick may rock onto its heel or toe, and the search step for it. */
const MAX_ROLL = 0.9;

/** Where the top-hand socket may go. */
export interface StickReach {
  shoulder: THREE.Vector3;
  /** The socket stays within this of the shoulder. */
  armReach: number;
  /** 0 to 1: a raised blade follows the hands instead of lying flat. Rigid sticks only. */
  handsLead?: number;
  /** Roll to settle at when nothing else binds: + rocks onto the heel, toe up. Rigid sticks only. */
  restRoll?: number;
  /**
   * The skater's pelvis and horizontal facing: the socket stays in front of the belly. A plane
   * rather than a keep-out disc, so the top hand crosses in front of the body continuously instead
   * of snapping between passing in front and passing behind. Rigid sticks only.
   */
  torso?: {
    at: THREE.Vector3;
    front: THREE.Vector3;
    /** The pelvis-to-neck direction, so the belly plane follows the torso's lean. */
    up?: THREE.Vector3;
  };
}

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
  limits?: StickReach,
) {
  _flat.set(tip.x - grip.x, 0, tip.z - grip.z);
  if (_flat.lengthSq() > 1e-4) heading.copy(_flat.normalize());
  _side.crossVectors(heading, UP);
  _planeQ.setFromRotationMatrix(_basis.makeBasis(heading, UP, _side));
  if (spec.lie !== undefined)
    return placeRigid(parts, spec, spec.lie, grip, tip, heading, hosel, limits);
  const shoulder = limits?.shoulder,
    armReach = limits?.armReach ?? 0.5;

  _heel.copy(tip).addScaledVector(heading, -spec.length * 0.45);
  _heel.y = tip.y;
  parts.root.position.copy(_heel);
  parts.root.quaternion.copy(_planeQ);

  // The shaft lies in the stick's plane: from the hosel through the top hand, a little past it.
  const hx = HOSEL_X,
    hy = spec.height * 0.6;
  _flat.subVectors(grip, _heel);
  let gx = _flat.dot(heading) - hx,
    gy = _flat.y - hy;
  let angle = Math.atan2(gx, gy);
  const span = spec.grip ?? spec.shaft - KNOB_PAST_HAND;
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
          (span * span + distance * distance - radius2) / (2 * span * distance),
          -1,
          1,
        ),
      );
      let delta = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
      const innerRadius2 = Math.max(0, INNER_REACH * INNER_REACH - depth * depth);
      const innerAngle = Math.acos(
        THREE.MathUtils.clamp(
          (span * span + distance * distance - innerRadius2) / (2 * span * distance),
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
    .addScaledVector(heading, gx * span)
    .addScaledVector(UP, gy * span);
  return hosel;
}

/**
 * A rigid stick keeps its lie, so the blade lies flat when the hands allow it and otherwise rocks
 * onto its heel (toe up, hands lower) or its toe (hands higher) about the end still on the ice.
 * The roll nearest the preferred one that keeps the top hand reachable and in front of the belly
 * wins, preferring lower hands, refined to that boundary. Reach and the belly each allow one
 * interval of rolls, so the hands slide rather than jump. Also swinging the top hand around the
 * puck kept it lower with the puck in close, but it had to pick a side of the body and snapped
 * between sides as the blade crossed.
 */
function placeRigid(
  parts: StickParts,
  spec: BladeSpec,
  lie: number,
  grip: THREE.Vector3,
  tip: THREE.Vector3,
  heading: THREE.Vector3,
  hosel: THREE.Vector3,
  limits: StickReach | undefined,
) {
  const shoulder = limits?.shoulder,
    armReach = limits?.armReach ?? 0.5,
    handsLead = limits?.handsLead ?? 0,
    torso = limits?.torso;
  const hy = spec.height * 0.6,
    contact = spec.contact ?? spec.length * 0.45,
    heel = HOSEL_X + hy / Math.tan(lie),
    span = spec.shaft - KNOB_PAST_HAND;
  const socketX = HOSEL_X - Math.cos(lie) * span,
    socketY = hy + Math.sin(lie) * span;
  const place = (roll: number) => {
    const pivot = roll > 0 ? heel : roll < 0 ? spec.length : contact;
    parts.root.quaternion.copy(_planeQ).multiply(_rollQ.setFromAxisAngle(FORWARD_FACE, roll));
    parts.root.position
      .copy(tip)
      .addScaledVector(heading, pivot - contact)
      .sub(_local.set(pivot, 0, 0).applyQuaternion(parts.root.quaternion));
    _socket
      .copy(parts.root.position)
      .add(_local.set(socketX, socketY, 0).applyQuaternion(parts.root.quaternion));
    return shoulder ? _socket.distanceTo(shoulder) : 0;
  };
  // Only reach and the belly bound the roll. The flexible stick's elbow-room limit would punch a
  // hole around the shoulder and split the valid rolls in two, and the hands would jump across it;
  // the arm IK's own bend limit already handles a hand close to the shoulder. When nothing works,
  // as with the puck at the skates, the fallback weighs reach heavily: a hand off the stick looks
  // far worse than one pressed toward the belly.
  // The belly is taken at the flat blade's hand height, so it stays one upright plane over the
  // rolls. Taken at each roll's own height, it leaned back with the spine below the belt: hands
  // rocked down by the knees passed as clear, the valid rolls split in two, and the hands jumped
  // a metre between the ends.
  const belt = torso ? (place(0), _socket.y) : 0,
    deep = torso ? bellyDepth(tip, torso) : 0;

  let roll = 0;
  if (handsLead > 0) {
    _flat.subVectors(grip, tip);
    const want = Math.atan2(_flat.y, _flat.dot(heading)),
      flat = Math.atan2(socketY, socketX - contact);
    roll = handsLead * Math.atan2(Math.sin(want - flat), Math.cos(want - flat));
    roll = THREE.MathUtils.clamp(roll, -MAX_ROLL, MAX_ROLL);
  }
  if (limits && handsLead < 1) {
    // A soft clearance cost starts yielding before a reach limit. Choosing the first feasible
    // sample made the hand velocity discontinuous at tangency; choosing a discrete fallback
    // also quantized close toe drags. Minimize continuously around the best sampled interval.
    const preferred = roll + (limits.restRoll ?? 0) * (1 - handsLead);
    const soft = (x: number) => (x + Math.sqrt(x * x + 0.0004)) * 0.5;
    const cost = (r: number) => {
      const d = place(r);
      const reach = shoulder ? soft(d - armReach + 0.015) : 0;
      const body = torso ? soft(-clearance(_socket, torso, belt, deep)) : 0;
      return 80 * reach * reach + 8 * body * body + 0.03 * (r - preferred) ** 2;
    };
    let best = Infinity;
    for (let r = -MAX_ROLL; r <= MAX_ROLL + 1e-9; r += 0.06) {
      const value = cost(r);
      if (value < best) {
        best = value;
        roll = r;
      }
    }
    let lo = Math.max(-MAX_ROLL, roll - 0.06),
      hi = Math.min(MAX_ROLL, roll + 0.06);
    for (let i = 0; i < 24; i++) {
      const a = lo + (hi - lo) / 3,
        b = hi - (hi - lo) / 3;
      if (cost(a) < cost(b)) hi = b;
      else lo = a;
    }
    roll = (lo + hi) / 2;
  }

  place(roll);
  if (handsLead > 0) {
    // A raised blade has nothing to rest on: the top hand stays where the hands want it, clamped
    // to reach and clear of the body, and the shaft points through the tip.
    _leadPos.copy(_socket);
    _want.copy(grip);
    if (torso) {
      const short = -clearance(_want, torso, _want.y, deep);
      if (short > 0) {
        _want.x += torso.front.x * short;
        _want.z += torso.front.z * short;
      }
    }
    if (shoulder) {
      _local.subVectors(_want, shoulder);
      const d = _local.length();
      if (d > 1e-6)
        _want
          .copy(shoulder)
          .addScaledVector(_local, THREE.MathUtils.clamp(d, INNER_REACH, armReach) / d);
    }
    // Keep one swing plane through take-off and landing. Slerping two independently chosen
    // planes switched the shortest quaternion arc and snapped the hands across the shaft.
    _local.subVectors(tip, _want);
    const toward =
      Math.atan2(_local.y, _local.dot(heading)) - Math.atan2(-socketY, contact - socketX);
    // Blend the top-hand socket itself between the on-ice solution and where the hands want it,
    // then hang the stick off that socket at the blended roll. Blending the stick's root
    // position under two different rolls swung the socket, and the hands, somewhere else again.
    const blendedRoll = THREE.MathUtils.lerp(roll, toward, handsLead);
    parts.root.quaternion
      .copy(_planeQ)
      .multiply(_rollQ.setFromAxisAngle(FORWARD_FACE, blendedRoll));
    _socket.lerpVectors(_leadPos, _want, handsLead);
    parts.root.position
      .copy(_socket)
      .sub(_local.set(socketX, socketY, 0).applyQuaternion(parts.root.quaternion));
  }
  layoutShaft(parts, spec, Math.PI / 2 - lie, spec.shaft);
  hosel
    .copy(parts.root.position)
    .add(_local.set(HOSEL_X, hy, 0).applyQuaternion(parts.root.quaternion));
  grip.copy(_socket);
  return hosel;
}

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
