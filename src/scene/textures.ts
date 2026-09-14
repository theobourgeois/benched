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
export function makeIceTexture() {
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
    ctx.save();
    ctx.fillStyle = '#74959c';
    ctx.globalAlpha = 0.64;
    ctx.rotate(Math.PI / 2);
    ctx.font = 'italic 900 2.0px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('BENCHED', 0, 0.7);
    ctx.font = '700 0.46px Arial';
    ctx.fillText('NORTHSTAR ARENA', 0, 1.6);
    ctx.restore();
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
export function makeNumberTexture(number: number) {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#f1f4f8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 100px Arial';
    ctx.fillText(String(number), 64, 66);
  });
}
