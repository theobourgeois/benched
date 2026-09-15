// Animation lab capture: extra camera angles rendered inside the frame loop, captions, contact
// sheets, canvas video, and saving to artifacts/anim-lab through the dev server.
import * as THREE from 'three';

/** Renders the scene from each camera into a corner of the canvas and copies it out, same frame. */
export function renderAngles(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cameras: THREE.PerspectiveCamera[],
  size: number,
) {
  const canvas = gl.domElement,
    dpr = gl.getPixelRatio();
  const css = Math.floor(Math.min(size, canvas.width / dpr, canvas.height / dpr));
  const px = Math.floor(css * dpr);
  const out = cameras.map((camera) => {
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    gl.setViewport(0, 0, css, css);
    gl.setScissor(0, 0, css, css);
    gl.setScissorTest(true);
    gl.render(scene, camera);
    const copy = document.createElement('canvas');
    copy.width = copy.height = px;
    copy.getContext('2d')!.drawImage(canvas, 0, canvas.height - px, px, px, 0, 0, px, px);
    return copy;
  });
  gl.setScissorTest(false);
  return out;
}

/** Copies the whole canvas. Call straight after a render, before the frame is presented. */
export function copyCanvas(source: HTMLCanvasElement) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')!.drawImage(source, 0, 0);
  return copy;
}

const FONT = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
/** Burns caption lines into the top of an image; red lines are issues. */
export function caption(image: HTMLCanvasElement, lines: { text: string; bad?: boolean }[]) {
  const ctx = image.getContext('2d')!;
  const scale = Math.max(1, image.width / 640);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.font = FONT;
  const h = 18 * lines.length + 8;
  ctx.fillStyle = 'rgba(3, 7, 13, 0.72)';
  ctx.fillRect(0, 0, image.width / scale, h);
  lines.forEach((line, i) => {
    ctx.fillStyle = line.bad ? '#ff6b61' : '#e3ecf4';
    ctx.fillText(line.text, 8, 18 + i * 18);
  });
  ctx.restore();
  return image;
}

export interface SheetCell {
  image: CanvasImageSource | null;
  label: string;
  bad?: boolean;
}
/** A grid of frames: one row per label, `columns` cells across, wrapping long rows. */
export function contactSheet(
  title: string,
  rows: { label: string; cells: SheetCell[] }[],
  cell = 256,
  columns = 6,
) {
  const gap = 6,
    head = 34,
    rowHead = 22;
  const lines = rows.map((r) => Math.ceil(r.cells.length / columns));
  const width = gap + columns * (cell + gap);
  const height = head + lines.reduce((sum, n) => sum + rowHead + n * (cell + gap), 0);
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#060d17';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '700 16px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#e3ecf4';
  ctx.fillText(title, gap + 2, 22);
  let y = head;
  rows.forEach((row, r) => {
    ctx.font = FONT;
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText(row.label, gap + 2, y + 15);
    y += rowHead;
    row.cells.forEach((c, i) => {
      const x = gap + (i % columns) * (cell + gap),
        top = y + Math.floor(i / columns) * (cell + gap);
      ctx.fillStyle = '#0b1529';
      ctx.fillRect(x, top, cell, cell);
      if (c.image) ctx.drawImage(c.image, x, top, cell, cell);
      ctx.fillStyle = 'rgba(3, 7, 13, 0.75)';
      ctx.fillRect(x, top, cell, 20);
      ctx.fillStyle = c.bad ? '#ff6b61' : '#e3ecf4';
      ctx.font = FONT;
      ctx.fillText(c.label, x + 6, top + 15);
      if (c.bad) {
        ctx.strokeStyle = '#ff4238';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, top + 1.5, cell - 3, cell - 3);
      }
    });
    y += lines[r] * (cell + gap);
  });
  return sheet;
}

export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
  );

/** Writes under artifacts/anim-lab via the dev server; falls back to a browser download. */
export async function saveFile(path: string, data: Blob | string) {
  try {
    const res = await fetch(`/__lab/save?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: data,
    });
    if (res.ok) return ((await res.json()) as { path: string }).path;
  } catch {
    // No dev server endpoint: download instead.
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(typeof data === 'string' ? new Blob([data]) : data);
  a.download = path.replaceAll('/', '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return `downloads/${a.download}`;
}

/** Records composed frames: the game canvas plus a caption, and the reference side by side. */
export class LabVideo {
  private canvas = document.createElement('canvas');
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  started = 0;
  get recording() {
    return this.recorder !== null;
  }
  start(width: number, height: number, withRef: boolean) {
    this.canvas.width = withRef ? width * 2 : width;
    this.canvas.height = height;
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const stream = this.canvas.captureStream(60);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.started = performance.now();
  }
  /** Call straight after the frame renders. */
  frame(
    source: HTMLCanvasElement,
    lines: { text: string; bad?: boolean }[],
    ref?: CanvasImageSource | null,
  ) {
    if (!this.recorder) return;
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.height * (source.width / source.height);
    ctx.fillStyle = '#060d17';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(source, 0, 0, w, this.canvas.height);
    if (ref && this.canvas.width > w)
      ctx.drawImage(ref, w, 0, this.canvas.width - w, this.canvas.height);
    caption(this.canvas, lines);
  }
  stop() {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return Promise.resolve(null);
    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: 'video/webm' }));
      recorder.stop();
    });
  }
}
