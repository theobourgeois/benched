import * as THREE from 'three';
import type { RinkSpec } from '../game/config';
export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
/** The sheet's paint, drawn in metres from centre ice so every mark sits where the spec says. */
export function makeIceTexture(rink: RinkSpec, logo?: CanvasImageSource) {
  // A sheet much bigger than a hockey rink gets the pixels to match, or its paint goes soft.
  const big = rink.halfLength > 40 ? 2 : 1,
    W = 2048 * big,
    H = 1024 * big;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#e3edf3';
    ctx.fillRect(0, 0, W, H);
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 10500 * big * big; i++) {
      const x = random() * W,
        y = random() * H;
      ctx.strokeStyle = `rgba(255,255,255,${random() * 0.19})`;
      ctx.lineWidth = random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + random() * 45 - 22, y + random() * 25 - 12);
      ctx.stroke();
    }
    const sx = W / (rink.halfLength * 2),
      sz = H / (rink.halfWidth * 2);
    ctx.translate(W / 2, H / 2);
    ctx.scale(sx, sz);
    // No mark is drawn thinner than a pixel and a half, whatever the rule book says it is.
    const thin = (width: number) => Math.max(width, 1.5 / Math.min(sx, sz));
    const line = (x: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = thin(width);
      ctx.beginPath();
      ctx.moveTo(x, -rink.halfWidth);
      ctx.lineTo(x, rink.halfWidth);
      ctx.stroke();
    };
    const circle = (x: number, z: number, r: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = thin(0.08);
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    const dot = (x: number, z: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // A regulation goal line is two inches: under two pixels here, so it is drawn a little heavy.
    const goalLine = Math.max(rink.goalLineWidth, 0.07);
    line(-rink.goalX, '#dc625f', goalLine);
    line(rink.goalX, '#dc625f', goalLine);
    line(0, '#d96061', rink.centreWidth);
    circle(0, 0, rink.centreCircle, '#3c82a4');
    if (rink.hockey) {
      const paint = rink.hockey;
      line(-paint.blueLine, '#2f7eae', paint.blueWidth);
      line(paint.blueLine, '#2f7eae', paint.blueWidth);
      ctx.setLineDash([0.26, 0.22]);
      line(0, '#f4eded', rink.centreWidth / 2);
      ctx.setLineDash([]);
      const hash = paint.circle - 0.1;
      for (const x of [-paint.spotX, paint.spotX])
        for (const z of [-paint.spotZ, paint.spotZ]) {
          circle(x, z, paint.circle, '#d26766');
          dot(x, z, 0.18, '#d26766');
          for (const a of [-1, 1])
            for (const b of [-1, 1]) {
              ctx.fillRect(x + a * 0.7, z + b * 0.35, 0.6 * a, 0.07);
              ctx.fillRect(x + a * 0.7, z + b * 0.35, 0.07, 0.65 * b);
            }
          for (const a of [-1, 1]) {
            ctx.fillRect(x - 0.8, z + a * hash, 0.07, a * 0.45);
            ctx.fillRect(x + 0.8, z + a * hash, 0.07, a * 0.45);
          }
        }
      for (const x of [-paint.neutralSpotX, paint.neutralSpotX])
        for (const z of [-paint.spotZ, paint.spotZ]) dot(x, z, 0.16, '#c56366');
    }
    /** A half circle about the middle of a goal line, opening up ice. */
    const goalArc = (sign: number, r: number) =>
      ctx.arc(
        sign * rink.goalX,
        0,
        r,
        sign > 0 ? Math.PI / 2 : -Math.PI / 2,
        sign > 0 ? Math.PI * 1.5 : Math.PI / 2,
      );
    for (const sign of [-1, 1]) {
      if (rink.bandy) {
        const paint = rink.bandy;
        ctx.strokeStyle = '#d26766';
        ctx.lineWidth = thin(0.08);
        ctx.beginPath();
        goalArc(sign, paint.penaltyArea);
        ctx.stroke();
        dot(sign * (rink.goalX - paint.penaltySpot), 0, 0.2, '#d26766');
        // The free-stroke spots sit on the penalty line, half way round to each side.
        const out = paint.penaltyArea * Math.SQRT1_2;
        for (const side of [-1, 1]) {
          circle(sign * (rink.goalX - out), side * out, paint.freeStroke, '#d26766');
          dot(sign * (rink.goalX - out), side * out, 0.2, '#d26766');
        }
      }
      ctx.fillStyle = '#91c7dc';
      ctx.strokeStyle = '#cc686c';
      ctx.lineWidth = thin(0.09);
      ctx.beginPath();
      goalArc(sign, rink.crease);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // The goalie's trapezoid, from the goal line back to the end boards.
      const trapezoid = rink.hockey?.trapezoid;
      if (trapezoid) {
        ctx.beginPath();
        for (const side of [-1, 1]) {
          ctx.moveTo(sign * rink.goalX, side * trapezoid.goalLine);
          ctx.lineTo(sign * rink.halfLength, side * trapezoid.boards);
        }
        ctx.stroke();
      }
    }
    // The home crest at centre ice, turned to face the broadcast camera and let the lines show through.
    if (logo) {
      const iw = Number((logo as { width?: number }).width) || 960;
      const ih = Number((logo as { height?: number }).height) || 640;
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.rotate(Math.PI / 2);
      const width = 10;
      const height = width * (ih / iw);
      ctx.drawImage(logo, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
  });
}
export function makeNumberTexture(number: number, color = '#f1f4f8') {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 100px Arial';
    ctx.fillText(String(number), 64, 66);
  });
}

/** Rasterizes an SVG so Three can stamp it on a jersey (TextureLoader often gets a 0×0 SVG). */
export class SvgTextureLoader extends THREE.Loader<THREE.CanvasTexture> {
  load(
    url: string,
    onLoad?: (texture: THREE.CanvasTexture) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ) {
    this.manager.itemStart(url);
    fetch(this.manager.resolveURL(url))
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return res.text();
      })
      .then(
        (svg) =>
          new Promise<THREE.CanvasTexture>((resolve, reject) => {
            const sized = svg.replace(/<svg\b/, '<svg width="960" height="640"');
            const src = URL.createObjectURL(
              new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }),
            );
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = 960;
              canvas.height = 640;
              canvas.getContext('2d')!.drawImage(image, 0, 0, 960, 640);
              URL.revokeObjectURL(src);
              const texture = new THREE.CanvasTexture(canvas);
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.anisotropy = 8;
              texture.needsUpdate = true;
              resolve(texture);
            };
            image.onerror = () => {
              URL.revokeObjectURL(src);
              reject(new Error(`SVG image failed: ${url}`));
            };
            image.src = src;
          }),
      )
      .then((texture) => {
        onLoad?.(texture);
        this.manager.itemEnd(url);
      })
      .catch((err) => {
        onError?.(err);
        this.manager.itemError(url);
        this.manager.itemEnd(url);
      });
  }
}
