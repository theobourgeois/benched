import { RINK } from './config';
import type { Vec2 } from './types';
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export function normalized(x: number, z: number): Vec2 {
  const d = Math.hypot(x, z);
  return d > 0.0001 ? { x: x / d, z: z / d } : { x: 0, z: 0 };
}
export function turnToward(a: number, b: number, t: number) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * clamp(t, 0, 1);
}
/** Rounded-rectangle collision shared by skaters and the puck. Returns inward normal. */
export function constrainToRink(body: Vec2, margin: number): Vec2 | null {
  const hx = RINK.halfLength - margin,
    hz = RINK.halfWidth - margin,
    r = RINK.corner - margin;
  const cx = RINK.halfLength - RINK.corner,
    cz = RINK.halfWidth - RINK.corner;
  let nx = 0,
    nz = 0;
  if (Math.abs(body.x) > cx && Math.abs(body.z) > cz) {
    const dx = Math.abs(body.x) - cx,
      dz = Math.abs(body.z) - cz,
      d = Math.hypot(dx, dz);
    if (d > r) {
      nx = (-Math.sign(body.x) * dx) / d;
      nz = (-Math.sign(body.z) * dz) / d;
      body.x = Math.sign(body.x) * (cx + (dx / d) * r);
      body.z = Math.sign(body.z) * (cz + (dz / d) * r);
    }
  } else {
    if (Math.abs(body.x) > hx) {
      nx = -Math.sign(body.x);
      body.x = Math.sign(body.x) * hx;
    }
    if (Math.abs(body.z) > hz) {
      nz = -Math.sign(body.z);
      body.z = Math.sign(body.z) * hz;
    }
  }
  return nx || nz ? { x: nx, z: nz } : null;
}
