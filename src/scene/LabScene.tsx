// Animation lab, inside the Canvas: drives the clip before the players draw, then places the
// close-up camera, draws the overlays, renders, and services captures. Dev only.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  afterLabRender,
  driveLab,
  lab,
  notify,
  orbitFromPreset,
  placeCamera,
  subjectBody,
  type CameraId,
} from '../dev/lab';
import { renderAngles } from '../dev/labCapture';
import { LIMITS, type Joint } from '../dev/labMetrics';

const LEFT = new THREE.Color('#4fd1ff'),
  RIGHT = new THREE.Color('#ff9a3c'),
  MID = new THREE.Color('#f2f6ff');
const BONES: [Joint, Joint][] = [
  ['pelvis', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ...(['L', 'R'] as const).flatMap(
    (s) =>
      [
        ['chest', `shoulder${s}`],
        [`shoulder${s}`, `elbow${s}`],
        [`elbow${s}`, `wrist${s}`],
        [`wrist${s}`, `palm${s}`],
        ['pelvis', `hip${s}`],
        [`hip${s}`, `knee${s}`],
        [`knee${s}`, `ankle${s}`],
        [`ankle${s}`, `toe${s}`],
      ] as [Joint, Joint][],
  ),
];
const TRAILS: [Joint, THREE.Color][] = [
  ['palmL', LEFT],
  ['palmR', RIGHT],
  ['ankleL', LEFT],
  ['ankleR', RIGHT],
  ['hosel', new THREE.Color('#d5fa64')],
];
const sideColor = (j: Joint) => (j.endsWith('L') ? LEFT : j.endsWith('R') ? RIGHT : MID);
const onTop = (m: THREE.Material) => {
  m.depthTest = false;
  m.transparent = true;
  return m;
};

function createOverlays() {
  const body = new THREE.Group();
  body.matrixAutoUpdate = false;
  body.renderOrder = 999;
  const skeletonGeo = new THREE.BufferGeometry();
  skeletonGeo.setAttribute('position', new THREE.Float32BufferAttribute(BONES.length * 6, 3));
  const colors = BONES.flatMap(([a, b]) => [...sideColor(a).toArray(), ...sideColor(b).toArray()]);
  skeletonGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const skeleton = new THREE.LineSegments(
    skeletonGeo,
    onTop(new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.95 })),
  );
  const jointGeo = new THREE.BufferGeometry();
  jointGeo.setAttribute('position', new THREE.Float32BufferAttribute(22 * 3, 3));
  const joints = new THREE.Points(
    jointGeo,
    onTop(new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, color: '#ffffff' })),
  );
  const shaftGeo = new THREE.BufferGeometry();
  shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
  const shaft = new THREE.Line(shaftGeo, onTop(new THREE.LineBasicMaterial({ color: '#d5fa64' })));
  const palmGeo = new THREE.BufferGeometry();
  palmGeo.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
  palmGeo.setAttribute('color', new THREE.Float32BufferAttribute(6, 3));
  const palms = new THREE.Points(
    palmGeo,
    onTop(new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, vertexColors: true })),
  );
  const ring = new THREE.RingGeometry(0.07, 0.1, 24).rotateX(-Math.PI / 2);
  const feet = (['L', 'R'] as const).map(() => {
    const mesh = new THREE.Mesh(ring, onTop(new THREE.MeshBasicMaterial({ color: '#5dff8a' })));
    body.add(mesh);
    return mesh;
  });
  const trails = TRAILS.map(([, color]) => {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      onTop(new THREE.LineBasicMaterial({ color, opacity: 0.75 })),
    );
    body.add(line);
    return line;
  });
  body.add(skeleton, joints, shaft, palms);
  const grid = new THREE.GridHelper(12, 48, '#3a6b8a', '#1d3a4f');
  grid.position.y = 0.014;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  const root = new THREE.Group();
  root.add(body, grid);
  let trailFrames = -1,
    trailClip = '';
  return {
    root,
    update() {
      const s = lab.current,
        frame = subjectBody();
      const o = lab.overlays;
      grid.visible = o.grid;
      body.visible = Boolean(s && frame);
      if (!s || !frame) return;
      body.matrix.copy(frame.matrixWorld);
      body.matrixWorldNeedsUpdate = true;
      const lift = frame.position.y;
      const at = (j: Joint, out: Float32Array, i: number) => {
        const p = s.joints[j];
        out[i] = p[0];
        out[i + 1] = p[1] - lift;
        out[i + 2] = p[2];
      };
      skeleton.visible = joints.visible = o.skeleton;
      if (o.skeleton) {
        const pos = skeletonGeo.attributes.position.array as Float32Array;
        BONES.forEach(([a, b], i) => {
          at(a, pos, i * 6);
          at(b, pos, i * 6 + 3);
        });
        skeletonGeo.attributes.position.needsUpdate = true;
        const jp = jointGeo.attributes.position.array as Float32Array;
        (Object.keys(s.joints) as Joint[]).forEach((j, i) => at(j, jp, i * 3));
        jointGeo.attributes.position.needsUpdate = true;
      }
      shaft.visible = palms.visible = o.stick;
      if (o.stick) {
        const sp = shaftGeo.attributes.position.array as Float32Array;
        at('hosel', sp, 0);
        at('knob', sp, 3);
        shaftGeo.attributes.position.needsUpdate = true;
        const pp = palmGeo.attributes.position.array as Float32Array;
        at('palmL', pp, 0);
        at('palmR', pp, 3);
        palmGeo.attributes.position.needsUpdate = true;
        const pc = palmGeo.attributes.color.array as Float32Array;
        const off = (cm: number) => (cm > LIMITS.gripCm ? [1, 0.26, 0.22] : [0.37, 1, 0.54]);
        pc.set([...off(s.grip.L), ...off(s.grip.R)]);
        palmGeo.attributes.color.needsUpdate = true;
      }
      feet.forEach((mesh, i) => {
        const side = i ? 'R' : 'L';
        mesh.visible = o.contacts;
        const p = s.joints[`ankle${side}`];
        mesh.position.set(p[0], 0.016 - lift, p[2]);
        const lifted = Math.abs(s.lift[side]);
        (mesh.material as THREE.MeshBasicMaterial).color.set(
          s.lift[side] < LIMITS.skateSinkCm ? '#ff4238' : lifted < 1.5 ? '#5dff8a' : '#ffc34d',
        );
      });
      trails.forEach((t) => (t.visible = o.trails));
      if (o.trails && (lab.track.size !== trailFrames || lab.clip.id !== trailClip)) {
        trailFrames = lab.track.size;
        trailClip = lab.clip.id;
        const track = [...lab.track.values()].sort((a, b) => a.frame - b.frame);
        TRAILS.forEach(([j], i) => {
          const pts = track.map(
            (f) => new THREE.Vector3(f.joints[j][0], f.joints[j][1] - lift, f.joints[j][2]),
          );
          trails[i].geometry.setFromPoints(pts);
        });
      }
    },
  };
}

export function LabScene() {
  const overlays = useMemo(createOverlays, []);
  const { gl } = useThree();
  const cameras = useMemo(() => new Map<CameraId, THREE.PerspectiveCamera>(), []);

  // Drag orbits, wheel zooms, shift-drag raises the target, double-click returns to the side view.
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; raise: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || lab.camera === 'game') return;
      drag = { x: e.clientX, y: e.clientY, raise: e.shiftKey };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      orbitFromPreset();
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const o = lab.orbit;
      if (drag.raise) o.height = THREE.MathUtils.clamp(o.height + dy * 0.004, 0, 2.2);
      else {
        o.yaw -= dx * 0.008;
        o.pitch = THREE.MathUtils.clamp(o.pitch + dy * 0.006, -0.35, 1.5);
      }
      notify();
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      if (lab.camera === 'game') return;
      e.preventDefault();
      orbitFromPreset();
      lab.orbit.distance = THREE.MathUtils.clamp(
        lab.orbit.distance * Math.exp(e.deltaY * 0.001),
        0.5,
        16,
      );
      notify();
    };
    const reset = () => {
      lab.camera = 'side';
      notify();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', reset);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', reset);
    };
  }, [gl]);

  useFrame((_, dt) => driveLab(dt), -1);
  // A positive priority takes over rendering while the lab is mounted, which gives a hook
  // straight after the frame renders for captures.
  useFrame(({ gl, scene, camera, size }) => {
    placeCamera(camera as THREE.PerspectiveCamera, lab.camera);
    overlays.update();
    const full = () => {
      gl.setViewport(0, 0, size.width, size.height);
      gl.render(scene, camera);
    };
    full();
    afterLabRender((ids, px) => {
      const views = ids.map((id) => {
        let c = cameras.get(id);
        if (!c) cameras.set(id, (c = new THREE.PerspectiveCamera(36, 1, 0.05, 250)));
        placeCamera(c, id === 'game' ? 'side' : id);
        return c;
      });
      const shots = renderAngles(gl, scene, views, px);
      full();
      return shots;
    }, gl.domElement);
  }, 1);

  return <primitive object={overlays.root} />;
}
