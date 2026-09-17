// Animation lab: a dev-only close-up of one skater running any movement as a scrubbable clip,
// with live pose measurements, captures and a window.__LAB__ API for scripts and agents.
// Docs: docs/anim-lab.md.
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { beginGame, mySide, publish, returnToMenu, runtime } from '../app/store';
import { driveSkater, stickTip } from '../game/engine';
import { humanOn } from '../game/humans';
import { PUCK } from '../game/config';
import type { MatchState } from '../game/types';
import { labHooks, reviewSkaters, type PoseDebug } from '../scene/animationReview';
import type { SkaterRig } from '../scene/skaterModel';
import type { StickParts } from '../scene/stick';
import { CLIPS, REST_SKATER, takeClip, travelAt, type LabClip, type TakeFrame } from './labClips';
import { analyze, issueLabel, measure, reportText, type LabSample } from './labMetrics';
import { canvasBlob, caption, contactSheet, copyCanvas, LabVideo, saveFile } from './labCapture';

export const FPS = 60;
type V3 = [number, number, number];
export type CameraId =
  'side' | 'front' | 'back' | 'sideR' | 'top' | 'hands' | 'feet' | 'head' | 'orbit' | 'game';
/** Close-ups in the skater's frame (x to their left, z ahead); they follow position and heading. */
export const CAMERAS: Record<
  Exclude<CameraId, 'orbit' | 'game'>,
  { label: string; position: V3; target: V3; fov: number }
> = {
  side: { label: 'Left', position: [4.4, 1.3, 0.5], target: [0, 0.85, 0.3], fov: 38 },
  front: { label: 'Front', position: [1.6, 1.5, 4.2], target: [0, 0.85, 0.3], fov: 38 },
  back: { label: 'Back', position: [-1.8, 1.8, -3.6], target: [0, 0.8, 0.3], fov: 42 },
  sideR: { label: 'Right', position: [-4.4, 1.3, 0.5], target: [0, 0.85, 0.3], fov: 38 },
  top: { label: 'Top', position: [0, 5.2, -0.6], target: [0, 0, 0.4], fov: 42 },
  hands: { label: 'Hands', position: [-1.4, 1.1, 2.2], target: [-0.1, 0.75, 0.4], fov: 32 },
  feet: { label: 'Skates', position: [2, 0.45, 2], target: [0, 0.2, 0.1], fov: 32 },
  head: { label: 'Head', position: [0.9, 1.75, 2.2], target: [0, 1.62, 0.2], fov: 22 },
};
export const CAMERA_ORDER: CameraId[] = [
  'side',
  'front',
  'back',
  'sideR',
  'top',
  'hands',
  'feet',
  'head',
  'orbit',
  'game',
];
export type OverlayId = 'skeleton' | 'trails' | 'grid' | 'stick' | 'contacts';
export interface LabRef {
  name: string;
  media: HTMLVideoElement | HTMLImageElement;
  url: string;
  opacity: number;
  layout: 'pip' | 'overlay';
  /** Reference seconds at clip time 0, and reference seconds per clip second. */
  offset: number;
  rate: number;
}
interface Pass {
  t: number;
  end: number;
  warm: number;
  onFrame: (t: number, shoot: (cameras: CameraId[], size: number) => HTMLCanvasElement[]) => void;
  done: () => void;
}

export const lab = {
  clip: CLIPS[0] as LabClip,
  mode: 'clip' as 'clip' | 'live',
  time: 0,
  playing: true,
  rate: 1,
  loop: true,
  travel: false,
  camera: 'side' as CameraId,
  orbit: { yaw: 1.4, pitch: 0.2, distance: 4.6, height: 0.85 },
  overlays: { skeleton: false, trails: false, grid: true, stick: false, contacts: false } as Record<
    OverlayId,
    boolean
  >,
  /** Measured frames of the current clip, by 60 Hz frame index. */
  track: new Map<number, LabSample>(),
  current: null as LabSample | null,
  subject: 0,
  takes: [] as LabClip[],
  recording: null as { t: number; frames: TakeFrame[] } | null,
  ref: null as LabRef | null,
  status: '',
  busy: '',
  pass: null as Pass | null,
  video: new LabVideo(),
};
export const allClips = () => [...CLIPS, ...lab.takes];

let revision = 0,
  lastNotify = 0;
const listeners = new Set<() => void>();
export function notify() {
  revision++;
  lastNotify = performance.now();
  listeners.forEach((fn) => fn());
}
export function useLab() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => revision,
  );
  return lab;
}

const _pos = new THREE.Vector3(),
  _target = new THREE.Vector3(),
  _up = new THREE.Vector3(0, 1, 0);
/** The subject's body group: rink position and heading. */
export function subjectBody() {
  return reviewSkaters.get(lab.subject)?.rig.root.parent?.parent ?? null;
}
/** Points a camera at the subject. Returns false for the game camera. */
export function placeCamera(camera: THREE.PerspectiveCamera, id: CameraId) {
  if (id === 'game') return false;
  const body = subjectBody();
  const x = body?.position.x ?? 0,
    z = body?.position.z ?? 0,
    yaw = body?.rotation.y ?? 0;
  let fov: number;
  if (id === 'orbit') {
    const o = lab.orbit;
    _target.set(0, o.height, 0.2);
    _pos.set(
      Math.cos(o.pitch) * Math.sin(o.yaw),
      Math.sin(o.pitch),
      Math.cos(o.pitch) * Math.cos(o.yaw),
    );
    _pos.multiplyScalar(o.distance).add(_target);
    fov = 36;
  } else {
    const c = CAMERAS[id];
    _pos.set(...c.position);
    _target.set(...c.target);
    fov = c.fov;
  }
  _pos.applyAxisAngle(_up, yaw).add({ x, y: 0, z } as THREE.Vector3);
  _target.applyAxisAngle(_up, yaw).add({ x, y: 0, z } as THREE.Vector3);
  camera.position.copy(_pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_target);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  return true;
}
/** Starts orbiting from wherever the current preset is looking. */
export function orbitFromPreset() {
  if (lab.camera === 'orbit') return;
  const c = CAMERAS[lab.camera === 'game' ? 'side' : lab.camera];
  const d = new THREE.Vector3(...c.position).sub(new THREE.Vector3(...c.target));
  lab.orbit = {
    yaw: Math.atan2(d.x, d.z),
    pitch: Math.asin(d.y / d.length()),
    distance: d.length(),
    height: c.target[1],
  };
  lab.camera = 'orbit';
}

const goalieIndex = (s: MatchState) =>
  s.skaters.findIndex((p) => p.role === 'G' && p.team === s.skaters[skaterIndex].team);
let skaterIndex = 0;
/**
 * The lab puppets one skater directly. Whoever on that skater's side is holding them has the
 * stick, so poses and windups are read off that person rather than off a fixed "you".
 */
function labSide(s: MatchState, subject = lab.subject) {
  driveSkater(s, subject);
  return humanOn(s, s.skaters[subject])!;
}

function applyClip(s: MatchState, clip: LabClip, t: number) {
  const f = clip.frame(t);
  const p = s.skaters[lab.subject];
  Object.assign(p, REST_SKATER, f.skater);
  const at = lab.travel ? travelAt(clip, t) : { x: 0, z: 0 };
  p.x = at.x;
  p.z = at.z;
  labSide(s).shotCharge = f.charge;
  s.hitstop = 1e9;
  s.phase = 'playing';
  const puck = s.puck;
  Object.assign(puck, { vx: 0, vz: 0, vy: 0, shot: false });
  if (f.puck === 'tape') {
    puck.owner = lab.subject;
    Object.assign(puck, stickTip(p), { y: PUCK.restY });
  } else if (f.puck === 'none') {
    puck.owner = null;
    Object.assign(puck, { x: p.x + 40, z: p.z + 40, y: PUCK.restY });
  } else {
    const a = p.angle;
    puck.owner = null;
    puck.x = p.x + Math.sin(a) * f.puck.z + Math.cos(a) * f.puck.x;
    puck.z = p.z + Math.cos(a) * f.puck.z - Math.sin(a) * f.puck.x;
    puck.y = f.puck.y;
  }
}

function writeUrl() {
  const q = new URLSearchParams({
    lab: lab.clip.id,
    t: lab.time.toFixed(3),
    cam: lab.camera,
  });
  if (lab.travel) q.set('travel', '1');
  history.replaceState(null, '', `?${q}`);
}

/** Called by Player after it poses the subject. */
function onPose(rig: SkaterRig, stick: StickParts, pose: PoseDebug) {
  const s = runtime.match;
  const t = lab.mode === 'live' ? (lab.recording?.t ?? 0) : lab.time;
  const sample = measure(rig, stick, pose, s.skaters[lab.subject], labSide(s).shotCharge, t);
  lab.current = sample;
  const recording = lab.pass ? lab.pass.warm <= 0 : lab.mode === 'clip' && lab.playing;
  if (recording) lab.track.set(sample.frame, sample);
}

export function openLab(
  clipId?: string,
  opts: { time?: number; camera?: CameraId; travel?: boolean } = {},
) {
  if (!import.meta.env.DEV) return;
  if (!labHooks.active) {
    beginGame(runtime.myTeam, 'freeSkate');
    runtime.match.phase = 'playing';
    skaterIndex = mySide(runtime.match).humans[0]?.controlled ?? 0;
    muted = runtime.audio.enabled;
    runtime.audio.enabled = false;
    labHooks.active = true;
    labHooks.afterPose = onPose;
    installApi();
  }
  if (opts.camera) lab.camera = opts.camera;
  if (opts.travel !== undefined) lab.travel = opts.travel;
  selectClip(clipId ?? lab.clip.id);
  if (opts.time !== undefined) {
    lab.playing = false;
    lab.time = Math.min(opts.time, lab.clip.duration);
  }
  publish();
  notify();
}
let muted = true;
export function openLabFromUrl() {
  const q = new URLSearchParams(location.search);
  const cam = q.get('cam') as CameraId | null;
  openLab(q.get('lab') || undefined, {
    time: q.has('t') ? Number(q.get('t')) : undefined,
    camera: cam && CAMERA_ORDER.includes(cam) ? cam : undefined,
    travel: q.get('travel') === '1',
  });
}
export function closeLab() {
  if (lab.video.recording) void lab.video.stop();
  labHooks.active = false;
  labHooks.subject = -1;
  labHooks.afterPose = null;
  labHooks.delta = null;
  labHooks.simScale = 1;
  lab.pass = null;
  runtime.audio.enabled = muted;
  history.replaceState(null, '', location.pathname);
  returnToMenu();
  notify();
}

export function selectClip(id: string) {
  const clip = allClips().find((c) => c.id === id);
  if (!clip)
    throw new Error(
      `No clip "${id}". Try: ${allClips()
        .map((c) => c.id)
        .join(', ')}`,
    );
  lab.mode = 'clip';
  lab.clip = clip;
  lab.time = 0;
  lab.playing = true;
  lab.loop = clip.loop;
  lab.track.clear();
  lab.current = null;
  const s = runtime.match;
  lab.subject = clip.goalie ? goalieIndex(s) : skaterIndex;
  labHooks.subject = lab.subject;
  labHooks.simScale = 1;
  writeUrl();
  notify();
}
export function seek(t: number) {
  const d = lab.clip.duration;
  lab.time = lab.loop ? ((t % d) + d) % d : Math.min(Math.max(t, 0), d);
  writeUrl();
  notify();
}
export function setPlaying(playing: boolean) {
  if (playing && !lab.loop && lab.time >= lab.clip.duration) lab.time = 0;
  lab.playing = playing;
  writeUrl();
  notify();
}
export function stepFrames(n: number) {
  lab.playing = false;
  seek(Math.round(lab.time * FPS + n) / FPS);
}
export const RATES = [0.05, 0.1, 0.25, 0.5, 1, 2];
export function setRate(rate: number) {
  lab.rate = rate;
  notify();
}
export function shiftRate(dir: 1 | -1) {
  const i = RATES.indexOf(lab.rate);
  setRate(RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? 4 : i) + dir))]);
}
export function setCamera(id: CameraId) {
  lab.camera = id;
  writeUrl();
  notify();
}
export function setOverlay(id: OverlayId, on = !lab.overlays[id]) {
  lab.overlays[id] = on;
  notify();
}
export function set(patch: Partial<Pick<typeof lab, 'loop' | 'travel' | 'orbit'>>) {
  const { orbit, ...rest } = patch;
  Object.assign(lab, rest);
  // A scripted close-up: the orbit camera at a yaw, pitch, distance and target height.
  if (orbit) {
    lab.orbit = { ...lab.orbit, ...orbit };
    lab.camera = 'orbit';
  }
  if ('travel' in patch) lab.track.clear();
  writeUrl();
  notify();
}

/** Live mode: the simulation runs and you skate the subject yourself; takes record it. */
export function setMode(mode: 'clip' | 'live') {
  if (mode === lab.mode) return;
  const s = runtime.match;
  if (mode === 'live') {
    lab.mode = 'live';
    lab.subject = skaterIndex;
    labHooks.subject = skaterIndex;
    Object.assign(s.skaters[skaterIndex], REST_SKATER);
    labSide(s, skaterIndex);
    s.puck.owner = skaterIndex;
    s.hitstop = 0;
    lab.camera = lab.camera === 'game' ? 'game' : 'orbit';
    notify();
  } else {
    if (lab.recording) stopTake();
    selectClip(lab.clip.id);
  }
}
export function startTake() {
  if (lab.mode !== 'live') setMode('live');
  lab.recording = { t: 0, frames: [] };
  notify();
}
export function stopTake() {
  const rec = lab.recording;
  lab.recording = null;
  if (!rec || rec.frames.length < 2) return notify();
  const take = takeClip(`take-${lab.takes.length + 1}`, rec.frames);
  lab.takes.push(take);
  labHooks.simScale = 1;
  selectClip(take.id);
}

/** Frame loop, before the simulation and the players draw. */
export function driveLab(dt: number) {
  if (!labHooks.active) return;
  const s = runtime.match;
  if (lab.mode === 'live') {
    labHooks.simScale = lab.rate;
    labHooks.delta = Math.min(dt, 0.05) * lab.rate;
    const side = labSide(s);
    if (s.phase === 'paused') s.phase = 'playing';
    const rec = lab.recording;
    if (rec) {
      rec.t += labHooks.delta;
      const p = s.skaters[lab.subject];
      rec.frames.push({
        t: rec.t,
        skater: {
          ...p,
          pendingShot: p.pendingShot ? { ...p.pendingShot } : null,
          queuedCheck: null,
        },
        puck: { x: s.puck.x, y: s.puck.y, z: s.puck.z, owned: s.puck.owner === lab.subject },
        charge: side.shotCharge,
      });
    }
  } else {
    const pass = lab.pass;
    if (pass) {
      labHooks.delta = 1 / FPS;
      lab.time = pass.warm > 0 ? 0 : pass.t;
    } else if (!lab.current) {
      // Hold at the start until the skater has loaded and drawn once.
      labHooks.delta = Math.min(dt, 0.1);
      lab.time = 0;
    } else if (lab.playing) {
      const step = Math.min(dt, 0.1) * lab.rate;
      labHooks.delta = step;
      let t = lab.time + step;
      if (t > lab.clip.duration) {
        if (lab.loop) t %= lab.clip.duration;
        else {
          t = lab.clip.duration;
          lab.playing = false;
          writeUrl();
          notify();
        }
      }
      lab.time = t;
    } else labHooks.delta = Math.min(dt, 0.1); // Held: smoothing settles onto this frame.
    applyClip(s, lab.clip, lab.time);
  }
  syncRef();
  if (performance.now() - lastNotify > 66) notify();
}

/** Frame loop, straight after the lab renders: fixed-step captures advance here. */
export function afterLabRender(
  shoot: (cameras: CameraId[], size: number) => HTMLCanvasElement[],
  canvas: HTMLCanvasElement,
) {
  const pass = lab.pass;
  if (pass) {
    if (pass.warm > 0) pass.warm--;
    else {
      pass.onFrame(pass.t, shoot);
      pass.t = Math.round((pass.t + 1 / FPS) * FPS * 1000) / (FPS * 1000);
      if (pass.t > pass.end + 1e-6) {
        lab.pass = null;
        pass.done();
      }
    }
  }
  const pending = shotRequests.splice(0);
  for (const r of pending) r.resolve(r.cameras ? shoot(r.cameras, r.size) : [copyCanvas(canvas)]);
  if (lab.video.recording) lab.video.frame(canvas, captionLines(), refImage());
}
const shotRequests: {
  cameras: CameraId[] | null;
  size: number;
  resolve: (c: HTMLCanvasElement[]) => void;
}[] = [];
/** The next rendered frame, from these cameras (square, `size` px) or as on screen. */
export function grab(cameras: CameraId[] | null = null, size = 720) {
  return new Promise<HTMLCanvasElement[]>((resolve) =>
    shotRequests.push({ cameras, size, resolve }),
  );
}

/** Renders the clip start to end at exactly 60 Hz, one frame per display frame, then resolves. */
function runPass(end: number, onFrame: Pass['onFrame']) {
  return new Promise<void>((resolve) => {
    lab.playing = false;
    lab.track.clear();
    // A few held frames at t = 0 let the pose smoothing settle before measuring.
    lab.pass = { t: 0, end, warm: 20, onFrame, done: resolve };
  });
}

export function captionLines(sample = lab.current) {
  const lines: { text: string; bad?: boolean }[] = [
    {
      text: `${lab.clip.id}  t=${lab.time.toFixed(3)}s  f${Math.round(lab.time * FPS)}  cam ${lab.camera}${lab.rate !== 1 ? `  ${lab.rate}×` : ''}`,
    },
  ];
  if (sample) {
    const a = sample.angles;
    lines.push({
      text: `knee ${a.kneeL.toFixed(0)}/${a.kneeR.toFixed(0)}°  elbow ${a.elbowL.toFixed(0)}/${a.elbowR.toFixed(0)}°  grip ${sample.grip.L}/${sample.grip.R}cm  lift ${sample.lift.L}/${sample.lift.R}cm  crouch ${sample.pose.crouch.toFixed(2)}`,
    });
    for (const issue of sample.issues.slice(0, 3))
      lines.push({ text: issueLabel(issue), bad: true });
  }
  return lines;
}
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
async function busy<T>(label: string, run: () => Promise<T>) {
  lab.busy = label;
  notify();
  try {
    return await run();
  } finally {
    lab.busy = '';
    notify();
  }
}
const say = (status: string) => {
  lab.status = status;
  notify();
  return status;
};

/** Saves what is on screen (or from `camera`) with a caption. */
export function screenshot(opts: { camera?: CameraId; name?: string } = {}) {
  return busy('Screenshot', async () => {
    const [image] = await grab(opts.camera ? [opts.camera] : null, 900);
    caption(image, captionLines());
    const name =
      opts.name ?? `${lab.clip.id}-${lab.time.toFixed(2)}s-${opts.camera ?? lab.camera}-${stamp()}`;
    const path = await saveFile(`shots/${name}.png`, await canvasBlob(image));
    say(`Saved ${path}`);
    return path;
  });
}

export function toggleVideo() {
  if (lab.video.recording)
    return busy('Saving video', async () => {
      const blob = await lab.video.stop();
      if (!blob) return '';
      const path = await saveFile(`video/${lab.clip.id}-${stamp()}.webm`, blob);
      return say(`Saved ${path}`);
    });
  const canvas = document.querySelector<HTMLCanvasElement>('.arena-canvas canvas');
  if (!canvas) return Promise.resolve('');
  const h = Math.min(720, canvas.height);
  lab.video.start(Math.round((h * canvas.width) / canvas.height), h, Boolean(lab.ref));
  say('Recording… press V or Stop to save');
  return Promise.resolve('');
}
/** Records `seconds` of the screen as it plays, then saves it. */
export async function recordVideo(seconds: number) {
  if (!lab.video.recording) await toggleVideo();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return toggleVideo();
}

export interface BundleOptions {
  /** Contact-sheet frames spread over the clip; ignored when `times` is given. */
  frames?: number;
  times?: number[];
  cameras?: CameraId[];
  video?: boolean;
  name?: string;
}
/**
 * Plays the clip once at a fixed 60 Hz and writes a folder an agent can read without the game:
 * report.md, metrics.json, one contact sheet per camera, captioned full-size frames, and
 * optionally a video and reference frames.
 */
export function bundle(opts: BundleOptions = {}) {
  return busy('Capturing bundle', async () => {
    if (lab.mode === 'live') setMode('clip');
    const clip = lab.clip;
    const cameras = (
      opts.cameras?.length ? opts.cameras : (['side', 'front', 'back'] as CameraId[])
    ).filter((c) => c !== 'game');
    const count = Math.max(1, opts.frames ?? 10);
    const d = clip.duration;
    const times = (
      opts.times ??
      Array.from({ length: count }, (_, i) =>
        count === 1 ? 0 : clip.loop ? (i * d) / count : (i * d) / (count - 1),
      )
    )
      // The pass stops on the last whole frame at or before the end.
      .map((t) => Math.min(Math.floor(d * FPS + 1e-6), Math.max(0, Math.round(t * FPS))) / FPS);
    const wanted = new Set(times.map((t) => Math.round(t * FPS)));
    const shots = new Map<number, { images: HTMLCanvasElement[]; sample: LabSample | null }>();
    const dir = `${opts.name ?? clip.id}-${stamp()}`;
    if (opts.video) {
      const canvas = document.querySelector<HTMLCanvasElement>('.arena-canvas canvas')!;
      const h = Math.min(720, canvas.height);
      lab.video.start(Math.round((h * canvas.width) / canvas.height), h, Boolean(lab.ref));
    }
    await runPass(d, (t, shoot) => {
      const f = Math.round(t * FPS);
      if (wanted.has(f) && !shots.has(f))
        shots.set(f, { images: shoot(cameras, 480), sample: lab.current });
    });
    const videoBlob = opts.video ? await lab.video.stop() : null;
    const samples = [...lab.track.values()];
    const analysis = analyze(samples);
    const files: string[] = [];
    const out: [string, Blob | string][] = [];
    const bad = (f: number) =>
      Boolean(shots.get(f)?.sample?.issues.length) ||
      analysis.pops.some((p) => Math.abs(p.at * FPS - f) <= 1);
    const frames = [...shots.keys()].sort((a, b) => a - b);
    for (const [ci, camera] of cameras.entries()) {
      const cells = frames.map((f) => ({
        image: shots.get(f)!.images[ci],
        label: `${(f / FPS).toFixed(2)}s f${f}`,
        bad: bad(f),
      }));
      const sheet = contactSheet(`${clip.id} · ${camera} · red = issue or pop`, [
        { label: camera, cells },
      ]);
      out.push([`sheet-${camera}.png`, await canvasBlob(sheet)]);
      for (const f of frames) {
        const { images, sample } = shots.get(f)!;
        const lines = captionLines(sample);
        lines[0] = { text: `${clip.id}  t=${(f / FPS).toFixed(3)}s  f${f}  cam ${camera}` };
        out.push([
          `frames/${camera}-${(f / FPS).toFixed(2)}.png`,
          await canvasBlob(caption(images[ci], lines)),
        ]);
      }
    }
    if (lab.ref) {
      const cells = [];
      for (const f of frames)
        cells.push({
          image: await refFrame(f / FPS),
          label: `ref @ clip ${(f / FPS).toFixed(2)}s`,
        });
      const game = frames.map((f) => ({
        image: shots.get(f)!.images[0],
        label: `${(f / FPS).toFixed(2)}s`,
        bad: bad(f),
      }));
      const sheet = contactSheet(`${clip.id} vs reference ${lab.ref.name}`, [
        { label: `game · ${cameras[0]}`, cells: game },
        { label: 'reference', cells },
      ]);
      out.push(['sheet-compare.png', await canvasBlob(sheet)]);
    }
    if (videoBlob) out.push(['motion.webm', videoBlob]);
    files.push(...out.map(([name]) => name).filter((n) => !n.startsWith('frames/')));
    files.push(
      `frames/<camera>-<t>.png (${frames.length * cameras.length} captioned 480px frames)`,
    );
    const meta = {
      id: clip.id,
      label: clip.label,
      group: clip.group,
      duration: d,
      look: clip.look,
      loop: clip.loop,
    };
    const report = reportText({
      clip: meta,
      samples,
      analysis,
      files: ['metrics.json', ...files],
      cameras,
      travel: lab.travel,
    });
    out.push(['report.md', report]);
    out.push([
      'metrics.json',
      JSON.stringify({
        clip: meta,
        fps: FPS,
        travel: lab.travel,
        analysis,
        samples: samples.sort((a, b) => a.frame - b.frame),
      }),
    ]);
    let saved = '';
    for (const [name, data] of out) saved = await saveFile(`${dir}/${name}`, data);
    const folder = saved.slice(0, saved.lastIndexOf(dir) + dir.length);
    say(`Saved ${folder}`);
    return { dir: folder, report, issues: analysis.issues.length, pops: analysis.pops.length };
  });
}

// Reference footage, synced to the clip: reference time = offset + clip time × rate.
export function loadReference(file: File) {
  clearReference();
  const url = URL.createObjectURL(file);
  const video = file.type.startsWith('video');
  const media = video ? document.createElement('video') : new Image();
  if (media instanceof HTMLVideoElement) {
    media.muted = true;
    media.playsInline = true;
    media.preload = 'auto';
  }
  media.src = url;
  lab.ref = { name: file.name, media, url, opacity: 1, layout: 'pip', offset: 0, rate: 1 };
  notify();
}
export function clearReference() {
  if (lab.ref) URL.revokeObjectURL(lab.ref.url);
  lab.ref = null;
  notify();
}
export function setReference(
  patch: Partial<Pick<LabRef, 'opacity' | 'layout' | 'offset' | 'rate'>>,
) {
  if (lab.ref) Object.assign(lab.ref, patch);
  notify();
}
const refTime = (t: number) => (lab.ref ? lab.ref.offset + t * lab.ref.rate : 0);
function syncRef() {
  const media = lab.ref?.media;
  if (!(media instanceof HTMLVideoElement) || media.seeking || !media.duration) return;
  const want = Math.min(media.duration, Math.max(0, refTime(lab.time)));
  if (Math.abs(media.currentTime - want) > 1 / 90) media.currentTime = want;
}
function refImage() {
  return lab.ref?.media ?? null;
}
async function refFrame(t: number) {
  const media = lab.ref?.media;
  if (!media) return null;
  if (media instanceof HTMLVideoElement) {
    media.currentTime = Math.min(media.duration || 0, Math.max(0, refTime(t)));
    await new Promise((r) => media.addEventListener('seeked', r, { once: true }));
  }
  const c = document.createElement('canvas');
  c.width = c.height = 480;
  const ctx = c.getContext('2d')!;
  const w = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const h = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  const k = Math.min(480 / w, 480 / h);
  ctx.fillStyle = '#0b1529';
  ctx.fillRect(0, 0, 480, 480);
  ctx.drawImage(media, (480 - w * k) / 2, (480 - h * k) / 2, w * k, h * k);
  return c;
}

const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const tick = () => (n-- <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
/** Resolves once the subject's rig is loaded and measured. */
async function ready() {
  const start = performance.now();
  while (!(lab.current && reviewSkaters.has(lab.subject))) {
    if (performance.now() - start > 60_000) throw new Error('Animation lab never drew the skater');
    await nextFrames(1);
  }
  return true;
}

/** window.__LAB__: everything the lab UI does, for scripts and agents. See docs/anim-lab.md. */
function installApi() {
  const clean = <T>(v: T) => JSON.parse(JSON.stringify(v)) as T;
  Object.assign(window, {
    __LAB__: {
      ready,
      clips: () =>
        allClips().map(({ id, label, group, duration, loop, look }) => ({
          id,
          label,
          group,
          duration,
          loop,
          look,
        })),
      open: async (id: string, opts: { camera?: CameraId; travel?: boolean } = {}) => {
        openLab(id, opts);
        await ready();
        return clean({ clip: lab.clip.id, duration: lab.clip.duration, look: lab.clip.look });
      },
      /** Holds the pose at `t` and lets smoothing settle, then returns the measured frame. */
      seek: async (t: number) => {
        setPlaying(false);
        seek(t);
        await nextFrames(20);
        return clean(lab.current);
      },
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      setRate,
      camera: setCamera,
      overlay: (id: OverlayId, on: boolean) => setOverlay(id, on),
      set,
      /** The current frame's measurements. */
      sample: () => clean(lab.current),
      /** Plays the clip once at 60 Hz and returns issues, pops and ranges. */
      analyze: async () => {
        await runPass(lab.clip.duration, () => {});
        return clean(analyze([...lab.track.values()]));
      },
      screenshot,
      bundle,
      record: recordVideo,
      state: () =>
        clean({
          clip: lab.clip.id,
          time: lab.time,
          playing: lab.playing,
          rate: lab.rate,
          camera: lab.camera,
          travel: lab.travel,
          overlays: lab.overlays,
          mode: lab.mode,
        }),
      close: closeLab,
    },
  });
}
