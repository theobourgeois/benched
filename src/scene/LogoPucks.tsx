import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LEAGUES } from '../game/clubs';

/*
 * Logo pucks tumbling down behind the main menu. They get a canvas of their own, transparent over
 * the arena, so they never touch the match scene or its camera, and they unmount with the menu.
 * Press and hold one to stop it and turn it over; let go with a flick and it spins off.
 */

const COUNT = 7;
const RADIUS = 1;
// A real puck is three inches across and one thick; a touch thicker reads better at a distance.
const THICKNESS = 0.66;
const CAMERA_Z = 22;
const FOV = 38;
const HALF_TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const LOGO_FONT = 'italic 900 330px "Barlow Condensed"';
const FACE_SIZE = 1024;

/** Seeded so the scuffs are the same every visit; they are texture, not information. */
function scuffs(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Black rubber worn pale towards the rim: the face every print sits on. */
function drawRubber(ctx: CanvasRenderingContext2D, size: number) {
  const rand = scuffs(7);
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
}

/** Wears a print, so it sits in the rubber rather than floating over it. */
function wear(ctx: CanvasRenderingContext2D, size: number) {
  const rand = scuffs(13);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(18,19,20,${0.15 + rand() * 0.4})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 4, 1 + rand() * 3);
  }
  ctx.restore();
}

function drawWordmark(ctx: CanvasRenderingContext2D, size: number) {
  const print = layer(size);
  print.save();
  print.translate(size / 2, size / 2);
  print.font = LOGO_FONT;
  print.textAlign = 'center';
  print.textBaseline = 'middle';
  const fit = Math.min(1, (size * 0.8) / print.measureText('hcky.io').width);
  print.scale(fit, fit);
  print.fillStyle = '#f4f6f7';
  print.fillText('hcky.io', 0, size * 0.02);
  print.restore();
  wear(print, size);
  ctx.drawImage(print.canvas, 0, 0);
}

function drawCrest(ctx: CanvasRenderingContext2D, size: number, art: HTMLCanvasElement) {
  const print = layer(size);
  // As large as the face allows inside the worn rim: a circle's inscribed box, less a little.
  const box = size * 0.66;
  const aspect = art.width / art.height;
  const w = aspect >= 1 ? box : box * aspect;
  const h = aspect >= 1 ? box / aspect : box;
  print.drawImage(art, (size - w) / 2, (size - h) / 2, w, h);
  wear(print, size);
  ctx.drawImage(print.canvas, 0, 0);
}

/** The crest SVGs pad their artwork generously; cut each down to the pixels it actually paints. */
function trimmed(image: HTMLImageElement) {
  const scan = Object.assign(document.createElement('canvas'), {
    width: image.width,
    height: image.height,
  }).getContext('2d', { willReadFrequently: true })!;
  scan.drawImage(image, 0, 0);
  const { data, width, height } = scan.getImageData(0, 0, image.width, image.height);
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < left) return scan.canvas;
  const out = Object.assign(document.createElement('canvas'), {
    width: right - left + 1,
    height: bottom - top + 1,
  });
  out.getContext('2d')!.drawImage(scan.canvas, -left, -top);
  return out;
}

function layer(size: number) {
  return Object.assign(document.createElement('canvas'), { width: size, height: size }).getContext(
    '2d',
  )!;
}

/**
 * The league crests are SVGs with a viewBox but no size, which a canvas will not draw
 * reliably, so each is fetched and given one before it is loaded as an image.
 */
async function loadCrest(url: string) {
  const svg = await (await fetch(url)).text();
  const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const [w, h] = box ? [Number(box[1]), Number(box[2])] : [512, 512];
  const sized = svg.replace('<svg', `<svg width="${w}" height="${h}"`);
  const blob = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = blob;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(blob);
  }
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

function canvasTexture(source: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(source);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rubber = (map: THREE.Texture, bumpMap?: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 2, roughness: 0.86, metalness: 0 });

/** A club's crest, fetched and trimmed once a session however many pucks wear it. */
const crestArt = new Map<string, Promise<HTMLCanvasElement>>();
function crestFor(url: string) {
  let art = crestArt.get(url);
  if (!art) {
    art = loadCrest(url).then(trimmed);
    // A failure should not stick: the next puck to pick this club tries again.
    art.catch(() => crestArt.delete(url));
    crestArt.set(url, art);
  }
  return art;
}

/** What a puck's faces carry: the wordmark, or the crest at this logo URL. */
type Print = 'wordmark' | string;

/** This share of pucks carry the wordmark; the rest wear a club's crest. */
const WORDMARK_SHARE = 0.35;
const CREST_URLS = LEAGUES.flatMap((league) => league.clubs.map((club) => club.logo));

/** Any club at all, bar the ones already falling, so the same crest never shows twice at once. */
function pickPrint(showing: readonly { face: { print: Print } }[]): Print {
  if (Math.random() < WORDMARK_SHARE) return 'wordmark';
  const free = CREST_URLS.filter((url) => !showing.some((other) => other.face.print === url));
  const pool = free.length ? free : CREST_URLS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Each puck owns its face texture and repaints it when it comes back round the top with a new
 * print, so every club in the league can turn up without keeping a texture for each. Both caps
 * share the face; CylinderGeometry's groups are side, top, bottom.
 */
class Face {
  readonly ctx = layer(FACE_SIZE);
  readonly map = canvasTexture(this.ctx.canvas);
  readonly material = rubber(this.map);
  print: Print = '';
  private token = 0;

  show(print: Print) {
    this.print = print;
    const token = ++this.token;
    drawRubber(this.ctx, FACE_SIZE);
    if (print === 'wordmark') {
      drawWordmark(this.ctx, FACE_SIZE);
    } else {
      crestFor(print)
        .then((art) => {
          // The puck may have gone round again while this crest loaded.
          if (token !== this.token) return;
          drawCrest(this.ctx, FACE_SIZE, art);
          this.map.needsUpdate = true;
        })
        // A crest that fails to load leaves plain rubber, which is still a puck.
        .catch(() => {});
    }
    this.map.needsUpdate = true;
  }

  dispose() {
    this.map.dispose();
    this.material.dispose();
  }
}

function useSideMaterial() {
  const side = useMemo(() => {
    const ctx = Object.assign(document.createElement('canvas'), {
      width: 1024,
      height: 128,
    }).getContext('2d')!;
    drawSide(ctx, 1024, 128);
    const map = canvasTexture(ctx.canvas);
    return rubber(map, map);
  }, []);
  useEffect(
    () => () => {
      side.map?.dispose();
      side.dispose();
    },
    [side],
  );
  return side;
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
  /** The drift spin it settles back to after a fling. */
  baseSpin: number;
  scale: number;
  /** 0 falling, 1 held: eases between so a grab lifts the puck rather than snapping it. */
  lift: number;
  face: Face;
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
  f.baseSpin = f.spin;
}

/** Radians of turn per pixel dragged. */
const DRAG_TURN = 0.012;
/** A flick can set a puck spinning, but not into a blur. */
const MAX_FLING = 14;

type Grab = {
  index: number;
  pointer: number;
  x: number;
  y: number;
  time: number;
  /** Angular velocity from the drag, about screen X and Y, smoothed over the last moves. */
  wx: number;
  wy: number;
};

const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, THICKNESS, 64, 1);
const turn = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function Pucks() {
  const side = useSideMaterial();
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const canvas = useThree((s) => s.gl.domElement);
  const grab = useRef<Grab | null>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  // Spawned once; a resize only changes where later pucks appear.
  const [fallers] = useState(() => {
    const list: Faller[] = [];
    for (let i = 0; i < COUNT; i++) {
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
        baseSpin: 0,
        scale: 1,
        lift: 0,
        face: new Face(),
      };
      spawn(f, aspect, true);
      f.face.show(pickPrint(list));
      list.push(f);
    }
    return list;
  });
  const materials = useMemo(
    () => fallers.map((f) => [side, f.face.material, f.face.material]),
    [fallers, side],
  );
  useEffect(() => {
    // The wordmark font may still be on its way; repaint those faces once it is here.
    let live = true;
    document.fonts
      .load(LOGO_FONT)
      .then(() => {
        if (!live) return;
        fallers.forEach((f) => {
          if (f.face.print === 'wordmark') f.face.show('wordmark');
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      fallers.forEach((f) => f.face.dispose());
    };
  }, [fallers]);
  const started = useRef(false);

  // Dragging follows the pointer anywhere on the page, not just over the puck.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = grab.current;
      const mesh = g && meshes.current[g.index];
      if (!g || !mesh || e.pointerId !== g.pointer) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      const dt = Math.max(0.001, (e.timeStamp - g.time) / 1000);
      // Sideways turns it about the vertical, up and down about the horizontal, like a trackball.
      turn.setFromAxisAngle(Y_AXIS, dx * DRAG_TURN);
      mesh.quaternion.premultiply(turn);
      turn.setFromAxisAngle(X_AXIS, dy * DRAG_TURN);
      mesh.quaternion.premultiply(turn);
      const blend = Math.min(1, dt * 12);
      g.wx += ((dy * DRAG_TURN) / dt - g.wx) * blend;
      g.wy += ((dx * DRAG_TURN) / dt - g.wy) * blend;
      g.x = e.clientX;
      g.y = e.clientY;
      g.time = e.timeStamp;
    };
    const release = (e: PointerEvent) => {
      const g = grab.current;
      if (!g || e.pointerId !== g.pointer) return;
      grab.current = null;
      canvas.style.cursor = '';
      const f = fallers[g.index];
      // A drag that stopped before letting go should not fling off the last stale motion.
      const still = e.timeStamp - g.time > 80;
      const speed = still ? 0 : Math.hypot(g.wx, g.wy);
      if (speed > 0.5) {
        f.axis.set(g.wx, g.wy, 0).normalize();
        f.spin = Math.min(speed, MAX_FLING);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      canvas.style.cursor = '';
    };
  }, [canvas, fallers]);

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
      const held = grab.current?.index === i;
      f.lift += ((held ? 1 : 0) - f.lift) * Math.min(1, dt * 10);
      mesh.scale.setScalar(f.scale * (1 + f.lift * 0.12));
      // A held puck hangs where it was caught and turns only as the pointer turns it.
      if (held) return;
      f.y -= f.fall * dt;
      f.phase += f.swayRate * dt;
      if (f.y < -halfHeightAt(f.z) - 2) {
        spawn(f, aspect, false);
        // Off screen above, so the new print is painted before anyone sees it.
        f.face.show(pickPrint(fallers));
      }
      mesh.position.set(f.x + Math.sin(f.phase) * f.sway, f.y, f.z);
      // After a fling it winds back down to a drift over a couple of seconds.
      const settle = Math.sign(f.spin || 1) * Math.abs(f.baseSpin);
      f.spin += (settle - f.spin) * Math.min(1, dt * 0.9);
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
          material={materials[i]}
          onPointerOver={() => {
            if (!grab.current) canvas.style.cursor = 'grab';
          }}
          onPointerOut={() => {
            if (!grab.current) canvas.style.cursor = '';
          }}
          onPointerDown={(e) => {
            // Only the nearest puck under the pointer takes the grab.
            e.stopPropagation();
            if (grab.current) return;
            grab.current = {
              index: i,
              pointer: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              time: e.nativeEvent.timeStamp,
              wx: 0,
              wy: 0,
            };
            canvas.style.cursor = 'grabbing';
          }}
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
