import { STICK } from './config';
import { clamp } from './math';
import type { DekeKind, Skater } from './types';

export type DekePose = {
  side: number;
  reach: number;
  hop: number;
  yaw: number;
  lean: number;
  lift: number;
  cut: number;
  surge: number;
};

const REST_ANGLE = Math.atan2(STICK.restSide - STICK.pivotSide, STICK.restReach - STICK.pivotReach);

function fromPivot(angle: number, radius: number) {
  return {
    side: STICK.pivotSide + Math.sin(angle) * radius,
    reach: STICK.pivotReach + Math.cos(angle) * radius,
  };
}

function ease(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function pulse(t: number, peak: number) {
  if (t <= peak) return ease(t / Math.max(peak, 1e-4));
  return 1 - ease((t - peak) / Math.max(1 - peak, 1e-4));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function dekeDuration(kind: DekeKind): number {
  switch (kind) {
    case 'stride':
      return 0.44;
    case 'burst':
      return 0.4;
    case 'protect':
      return 0.42;
    case 'jump':
      return 0.5;
    case 'throughLegs':
      return 0.56;
    case 'windmill':
      return 0.52;
    case 'spin':
      return 0.64;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function canStartDeke(p: Skater) {
  if (p.role === 'G' || p.downTimer > 0 || p.stumbleTimer > 0 || p.diveTimer > 0) return false;
  if (!p.dekeKind) return true;
  return p.dekeTimer >= dekeDuration(p.dekeKind) * 0.5;
}

/** Left-stick one-touch: cut to the side, punch ahead, or pull it in. */
export function classifyOneTouch(angle: number, moveX: number, moveZ: number) {
  const fx = Math.sin(angle),
    fz = Math.cos(angle),
    leftX = Math.cos(angle),
    leftZ = -Math.sin(angle);
  const side = moveX * leftX + moveZ * leftZ,
    fwd = moveX * fx + moveZ * fz;
  const dir = side < -0.12 ? 1 : side > 0.12 ? -1 : 0;
  if (Math.abs(side) >= Math.abs(fwd) + 0.04) return { kind: 'stride' as const, dir: dir || 1 };
  if (fwd < -0.28) return { kind: 'protect' as const, dir };
  return { kind: 'burst' as const, dir };
}

function stridePose(u: number, dir: number): DekePose {
  const d = dir || 1;
  const sweep = ease(clamp((u - 0.04) / 0.26, 0, 1));
  const recover = ease(clamp((u - 0.48) / 0.52, 0, 1));
  const wide = sweep * (1 - recover * 0.82);
  const peak = fromPivot(REST_ANGLE - d * 1.05, 0.9);
  const gather = pulse(u, 0.2);
  return {
    side: mix(STICK.restSide, peak.side, wide),
    reach: mix(STICK.restReach, peak.reach, wide) - 0.18 * gather + 0.1 * pulse(u, 0.42),
    hop: 0.22 * pulse(u, 0.3),
    yaw: d * 0.16 * pulse(u, 0.34),
    lean: d * 0.28 * pulse(u, 0.36),
    lift: 0.03 * pulse(u, 0.3),
    cut: 16 * pulse(u, 0.28),
    surge: 7 * pulse(u, 0.4),
  };
}

function burstPose(u: number, dir: number): DekePose {
  const tuck = pulse(u, 0.38);
  return {
    side: mix(STICK.restSide, dir * -0.12, tuck * 0.7),
    reach: STICK.restReach + 0.4 * pulse(u, 0.34) - 0.08 * pulse(u, 0.18),
    hop: 0.14 * pulse(u, 0.28),
    yaw: dir * 0.08 * tuck,
    lean: dir * 0.12 * tuck,
    lift: 0.045 * pulse(u, 0.3),
    cut: 5 * Math.abs(dir) * pulse(u, 0.3),
    surge: 18 * pulse(u, 0.32),
  };
}

function protectPose(u: number, dir: number): DekePose {
  const hold = ease(clamp(u / 0.26, 0, 1)) * (1 - ease(clamp((u - 0.72) / 0.28, 0, 1)) * 0.45);
  const shield = dir || -1;
  return {
    side: mix(STICK.restSide, shield < 0 ? 0.9 : -0.62, hold),
    reach: mix(STICK.restReach, 0.4, hold),
    hop: 0.04 * pulse(u, 0.22),
    yaw: shield * -0.22 * hold,
    lean: shield * -0.32 * hold,
    lift: 0,
    cut: 4 * pulse(u, 0.24),
    surge: -9 * pulse(u, 0.22),
  };
}

function jumpPose(u: number, dir: number): DekePose {
  const crouch = u < 0.16 ? ease(u / 0.16) : 0;
  const flight = u < 0.16 ? 0 : Math.sin(Math.PI * clamp((u - 0.16) / 0.58, 0, 1));
  const hop = flight * 0.36 - crouch * 0.03;
  return {
    side: mix(STICK.restSide, STICK.restSide - dir * 0.22, pulse(u, 0.45)),
    reach: STICK.restReach - 0.28 * pulse(u, 0.2) + 0.22 * pulse(u, 0.58),
    hop,
    yaw: dir * 0.1 * flight,
    lean: dir * 0.14 * flight,
    lift: Math.max(0, hop) * 0.55,
    cut: 6 * pulse(u, 0.34),
    surge: 11 * pulse(u, 0.4),
  };
}

function stickAt(keys: { at: number; side: number; reach: number }[], u: number) {
  if (u <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].at) {
      const t = ease((u - keys[i - 1].at) / (keys[i].at - keys[i - 1].at));
      return {
        side: mix(keys[i - 1].side, keys[i].side, t),
        reach: mix(keys[i - 1].reach, keys[i].reach, t),
      };
    }
  }
  return keys[keys.length - 1];
}

function throughLegsPose(u: number, dir: number): DekePose {
  const d = dir || 1;
  const blade = stickAt(
    [
      { at: 0, side: STICK.restSide, reach: STICK.restReach },
      { at: 0.18, side: 0.1, reach: 0.28 },
      { at: 0.36, side: -d * 0.04, reach: -0.36 },
      { at: 0.54, side: -d * 0.52, reach: 1.28 },
      { at: 1, side: STICK.restSide, reach: STICK.restReach },
    ],
    u,
  );
  return {
    side: blade.side,
    reach: blade.reach,
    hop: 0.11 * pulse(u, 0.52),
    yaw: d * 0.12 * pulse(u, 0.5),
    lean: d * 0.18 * pulse(u, 0.48),
    lift: 0.02 * pulse(u, 0.5),
    cut: 8 * pulse(u, 0.5),
    surge: 10 * pulse(u, 0.54),
  };
}

function windmillPose(u: number, dir: number): DekePose {
  const d = dir || 1;
  const swing = ease(u);
  const blade = fromPivot(
    REST_ANGLE - d * swing * Math.PI * 1.12,
    0.78 + 0.16 * Math.sin(Math.PI * u),
  );
  return {
    side: blade.side,
    reach: blade.reach,
    hop: 0.1 * pulse(u, 0.38),
    yaw: d * 0.2 * pulse(u, 0.4),
    lean: d * 0.24 * Math.sin(Math.PI * u),
    lift: 0.035 * pulse(u, 0.36),
    cut: 12 * pulse(u, 0.32),
    surge: 6 * pulse(u, 0.42),
  };
}

function spinPose(u: number, dir: number): DekePose {
  const d = dir || 1;
  const spin = ease(u);
  const blade = fromPivot(REST_ANGLE - d * spin * Math.PI * 0.35, 0.74);
  return {
    side: blade.side,
    reach: blade.reach,
    hop: 0.08 * pulse(u, 0.42),
    yaw: d * Math.PI * 2 * spin,
    lean: d * 0.18 * Math.sin(Math.PI * u),
    lift: 0.02 * pulse(u, 0.4),
    cut: 0,
    surge: 5 * pulse(u, 0.36),
  };
}

export function sampleDeke(kind: DekeKind, u: number, dir: number): DekePose {
  const t = clamp(u, 0, 1);
  switch (kind) {
    case 'stride':
      return stridePose(t, dir);
    case 'burst':
      return burstPose(t, dir);
    case 'protect':
      return protectPose(t, dir);
    case 'jump':
      return jumpPose(t, dir);
    case 'throughLegs':
      return throughLegsPose(t, dir);
    case 'windmill':
      return windmillPose(t, dir);
    case 'spin':
      return spinPose(t, dir);
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function activeDeke(p: Skater): DekePose | null {
  if (!p.dekeKind) return null;
  return sampleDeke(p.dekeKind, p.dekeTimer / dekeDuration(p.dekeKind), p.dekeDir);
}

export function startDeke(p: Skater, kind: DekeKind, dir: number) {
  if (!canStartDeke(p)) return false;
  p.dekeKind = kind;
  p.dekeTimer = 0;
  p.dekeDir = dir;
  return true;
}

export function clearDeke(p: Skater) {
  p.dekeKind = null;
  p.dekeTimer = 0;
  p.dekeDir = 0;
}

export function stepDeke(p: Skater, dt: number) {
  if (!p.dekeKind) return null;
  const duration = dekeDuration(p.dekeKind);
  const before = sampleDeke(p.dekeKind, p.dekeTimer / duration, p.dekeDir);
  p.dekeTimer += dt;
  if (p.dekeTimer >= duration) {
    const end = sampleDeke(p.dekeKind, 1, p.dekeDir);
    p.angle += end.yaw - before.yaw;
    clearDeke(p);
    return end;
  }
  const after = sampleDeke(p.dekeKind, p.dekeTimer / duration, p.dekeDir);
  p.angle += after.yaw - before.yaw;
  return after;
}
