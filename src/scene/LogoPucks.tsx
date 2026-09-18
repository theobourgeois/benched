import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/*
 * Logo pucks tumbling down behind the main menu. They get a canvas of their own, transparent over
 * the arena, so they never touch the match scene or its camera, and they unmount with the menu.
 */

const COUNT = 7;
const RADIUS = 1;
// A real puck is three inches across and one thick; a touch thicker reads better at a distance.
const THICKNESS = 0.66;
const CAMERA_Z = 22;
const FOV = 38;
const HALF_TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const LOGO_FONT = 'italic 900 330px "Barlow Condensed"';

/** Seeded so the scuffs are the same every visit; they are texture, not information. */
function scuffs(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Black rubber face, worn pale towards the rim, with the wordmark across it. */
function drawFace(ctx: CanvasRenderingContext2D, size: number, logo: boolean) {
  const rand = scuffs(logo ? 7 : 13);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#121314';
  ctx.fillRect(0, 0, size, size);
  const shade = ctx.createRadialGradient(c, c, size * 0.05, c, c, c);
  shade.addColorStop(0, 'rgba(40,42,44,0.55)');
  shade.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  // A little wear, only out at the rim where sticks and boards hit; more reads as dust.
  for (let i = 0; i < 260; i++) {
    const r = c * (0.86 + rand() * 0.14);
    const a = rand() * Math.PI * 2;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const len = 2 + rand() * 8;
    const dir = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(200,204,208,${0.04 + rand() * 0.16})`;
    ctx.lineWidth = 0.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
    ctx.stroke();
  }
  if (!logo) return;
  ctx.save();
  ctx.translate(c, c);
  ctx.font = LOGO_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText('hcky.io').width;
  const fit = Math.min(1, (size * 0.8) / width);
  ctx.scale(fit, fit);
  ctx.fillStyle = '#f4f6f7';
  ctx.fillText('hcky.io', 0, size * 0.02);
  // Wear the print too, so the letters sit in the rubber rather than float over it.
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(18,19,20,${0.2 + rand() * 0.5})`;
    ctx.fillRect((rand() - 0.5) * width, (rand() - 0.5) * 360, 1 + rand() * 4, 1 + rand() * 3);
  }
  ctx.restore();
}

/** The side band: plain rubber with the knurled grip ring pressed into the middle of it. */
function drawSide(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rand = scuffs(29);
  ctx.fillStyle = '#101112';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1b1c1e';
  for (let x = 0; x < w; x += 8) ctx.fillRect(x, h * 0.3, 4, h * 0.4);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(210,214,218,${0.03 + rand() * 0.1})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 6, 1 + rand() * 2);
  }
}

function usePuckMaterials() {
  const materials = useMemo(() => {
    const canvas = (w: number, h: number) =>
      Object.assign(document.createElement('canvas'), { width: w, height: h });
    const top = canvas(1024, 1024);
    const bottom = canvas(512, 512);
    const side = canvas(1024, 128);
    const texture = (source: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(source);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const topMap = texture(top);
    const bottomMap = texture(bottom);
    const sideMap = texture(side);
    const draw = () => {
      drawFace(top.getContext('2d')!, 1024, true);
      drawFace(bottom.getContext('2d')!, 512, true);
      drawSide(side.getContext('2d')!, 1024, 128);
      topMap.needsUpdate = bottomMap.needsUpdate = sideMap.needsUpdate = true;
    };
    draw();
    // The wordmark font may still be on its way; redraw once it is here.
    document.fonts
      .load(LOGO_FONT)
      .then(draw)
      .catch(() => {});
    const rubber = (map: THREE.Texture, bumpMap?: THREE.Texture) =>
      new THREE.MeshStandardMaterial({
        map,
        bumpMap,
        bumpScale: 2,
        roughness: 0.86,
        metalness: 0,
      });
    // CylinderGeometry's groups: side, top cap, bottom cap.
    return [rubber(sideMap, sideMap), rubber(topMap), rubber(bottomMap)];
  }, []);
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      }),
    [materials],
  );
  return materials;
}

type Faller = {
  x: number;
  y: number;
  z: number;
  fall: number;
  sway: number;
  swayRate: number;
  phase: number;
  axis: THREE.Vector3;
  spin: number;
  scale: number;
};

const halfHeightAt = (z: number) => (CAMERA_Z - z) * HALF_TAN;

function spawn(f: Faller, aspect: number, anywhere: boolean) {
  f.z = -10 + Math.random() * 12;
  f.scale = 0.8 + Math.random() * 0.45;
  const halfH = halfHeightAt(f.z);
  const halfW = halfH * aspect;
  f.x = (Math.random() * 2 - 1) * halfW * 0.92;
  f.y = anywhere ? (Math.random() * 2 - 1) * halfH : halfH + 2;
  // Slow, like something drifting through water rather than dropped.
  f.fall = 0.9 + Math.random() * 0.9;
  f.sway = 0.2 + Math.random() * 0.5;
  f.swayRate = 0.3 + Math.random() * 0.4;
  f.phase = Math.random() * Math.PI * 2;
  f.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  f.spin = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
}

const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, THICKNESS, 64, 1);
const turn = new THREE.Quaternion();

function Pucks() {
  const materials = usePuckMaterials();
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  // Spawned once; a resize only changes where later pucks appear.
  const [fallers] = useState(() =>
    Array.from({ length: COUNT }, () => {
      const f: Faller = {
        x: 0,
        y: 0,
        z: 0,
        fall: 0,
        sway: 0,
        swayRate: 0,
        phase: 0,
        axis: new THREE.Vector3(),
        spin: 0,
        scale: 1,
      };
      spawn(f, aspect, true);
      return f;
    }),
  );
  const started = useRef(false);

  useFrame((_, delta) => {
    // A backgrounded tab hands back one huge delta; do not let every puck jump the screen.
    const dt = Math.min(delta, 0.05);
    fallers.forEach((f, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      if (!started.current) {
        // Start each at a different tilt so no two arrive face-on together.
        mesh.quaternion.setFromAxisAngle(f.axis, Math.random() * Math.PI * 2);
      }
      f.y -= f.fall * dt;
      f.phase += f.swayRate * dt;
      if (f.y < -halfHeightAt(f.z) - 2) spawn(f, aspect, false);
      mesh.position.set(f.x + Math.sin(f.phase) * f.sway, f.y, f.z);
      mesh.scale.setScalar(f.scale);
      turn.setFromAxisAngle(f.axis, f.spin * dt);
      mesh.quaternion.premultiply(turn);
    });
    started.current = true;
  });

  return (
    <>
      {fallers.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geometry}
          material={materials}
        />
      ))}
    </>
  );
}

export function LogoPucks() {
  return (
    <div className="logo-pucks" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, CAMERA_Z], fov: FOV, near: 1, far: 60 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
        }}
      >
        <ambientLight intensity={0.35} color="#bcd6e0" />
        <hemisphereLight args={['#d4ecf8', '#1a2a2e', 0.9]} />
        <directionalLight position={[6, 10, 12]} intensity={2.6} color="#f2f6ff" />
        {/* A cold rim from behind, so black rubber still separates from a dark arena. */}
        <directionalLight position={[-8, 4, -10]} intensity={1.6} color="#c4dcff" />
        <Pucks />
      </Canvas>
    </div>
  );
}
