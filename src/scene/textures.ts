import * as THREE from 'three';
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
export function makeIceTexture(logo?: CanvasImageSource) {
  return canvasTexture(2048, 1024, (ctx) => {
    ctx.fillStyle = '#e3edf3';
    ctx.fillRect(0, 0, 2048, 1024);
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 10500; i++) {
      const x = random() * 2048,
        y = random() * 1024;
      ctx.strokeStyle = `rgba(255,255,255,${random() * 0.19})`;
      ctx.lineWidth = random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + random() * 45 - 22, y + random() * 25 - 12);
      ctx.stroke();
    }
    const sx = 2048 / 60,
      sz = 1024 / 26;
    ctx.translate(1024, 512);
    ctx.scale(sx, sz);
    const line = (x: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, -13);
      ctx.lineTo(x, 13);
      ctx.stroke();
    };
    line(-9, '#2f7eae', 0.32);
    line(9, '#2f7eae', 0.32);
    line(-26, '#dc625f', 0.09);
    line(26, '#dc625f', 0.09);
    line(0, '#d96061', 0.24);
    ctx.setLineDash([0.26, 0.22]);
    line(0, '#f4eded', 0.12);
    ctx.setLineDash([]);
    const circle = (x: number, z: number, r: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    circle(0, 0, 4.6, '#3c82a4');
    for (const x of [-19, 19])
      for (const z of [-6.4, 6.4]) {
        circle(x, z, 4.1, '#d26766');
        ctx.fillStyle = '#d26766';
        ctx.beginPath();
        ctx.arc(x, z, 0.18, 0, Math.PI * 2);
        ctx.fill();
        for (const a of [-1, 1])
          for (const b of [-1, 1]) {
            ctx.fillRect(x + a * 0.7, z + b * 0.35, 0.6 * a, 0.07);
            ctx.fillRect(x + a * 0.7, z + b * 0.35, 0.07, 0.65 * b);
          }
        for (const a of [-1, 1]) {
          ctx.fillRect(x - 0.8, z + a * 4, 0.07, a * 0.45);
          ctx.fillRect(x + 0.8, z + a * 4, 0.07, a * 0.45);
        }
      }
    for (const x of [-6.6, 6.6])
      for (const z of [-6.4, 6.4]) {
        ctx.fillStyle = '#c56366';
        ctx.beginPath();
        ctx.arc(x, z, 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    for (const sign of [-1, 1]) {
      ctx.fillStyle = '#91c7dc';
      ctx.strokeStyle = '#cc686c';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(
        sign * 26,
        0,
        2.5,
        sign > 0 ? Math.PI / 2 : -Math.PI / 2,
        sign > 0 ? Math.PI * 1.5 : Math.PI / 2,
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
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
    ctx.fillStyle = '#87a5ad';
    ctx.textAlign = 'center';
    ctx.font = '700 0.62px Arial';
    ctx.fillText('NORTHSTAR ARENA', 0, -9.8);
    ctx.font = 'italic 900 1.05px Arial';
    ctx.fillStyle = '#88a6ad';
    ctx.fillText('HALIFAX', -17, 0.4);
    ctx.fillText('HALIFAX', 17, 0.4);
  });
}
export function makeBoardTexture() {
  return canvasTexture(2048, 128, (ctx) => {
    ctx.fillStyle = '#edf3ec';
    ctx.fillRect(0, 0, 2048, 128);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ['BENCHED', 'NORTHSTAR', 'HALIFAX', 'REDLINE'].forEach((label, i) => {
      ctx.fillStyle = i % 2 ? '#384945' : '#26353b';
      ctx.font = `italic 900 ${i === 3 ? 31 : 42}px Arial`;
      ctx.fillText(label, i * 512 + 256, 60);
    });
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
