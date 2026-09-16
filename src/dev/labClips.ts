// Animation lab clips: every movement the skater pose can make, driven as a pure function of time
// so the lab can scrub, loop, slow down and capture any frame. Takes recorded live in the lab
// become clips too.
import { PHYSICS, PUCK, STICK } from '../game/config';
import { dekeDuration, sampleDeke } from '../game/dekes';
import { cellyDuration } from '../game/cellys';
import { GOALIE_SAVE_TIME, SHOT_DOWNSWING } from '../game/actionTiming';
import type { CellyKind, DekeKind, Skater } from '../game/types';

export type ClipGroup =
  'Skating' | 'Puck' | 'Shots' | 'Dekes' | 'Cellys' | 'Contact' | 'Goalie' | 'Takes';
/** Skater fields a clip drives. Everything else is reset to REST_SKATER first. */
export type ClipSkater = Partial<Omit<Skater, 'id' | 'team' | 'role' | 'number' | 'name'>>;
/** A point in the skater's frame: x to their left, y up, z ahead. */
export type ClipPoint = { x: number; y: number; z: number };
export interface ClipFrame {
  /** Velocities are on the rink, with the skater starting at the origin facing +z. */
  skater: ClipSkater;
  /** On the blade, out of shot, or loose at a point in the skater's frame. */
  puck: 'tape' | 'none' | ClipPoint;
  /** Shot charge (MatchState.shotCharge), 0 to 1. */
  charge: number;
}
export interface LabClip {
  id: string;
  label: string;
  group: ClipGroup;
  duration: number;
  loop: boolean;
  goalie?: boolean;
  /** What a good version looks like. Shown in the lab and at the top of every report. */
  look: string;
  frame(t: number): ClipFrame;
}

export const REST_SKATER = {
  x: 0,
  z: 0,
  angle: 0,
  vx: 0,
  vz: 0,
  stride: 0,
  skateDrive: 0,
  edgeLean: 0,
  rush: 0,
  checkTimer: 0,
  checkPower: 0,
  checkLanded: false,
  downTimer: 0,
  stumbleTimer: 0,
  diveTimer: 0,
  blockTimer: 0,
  liftTimer: 0,
  shotTimer: 0,
  pendingShot: null,
  saveTimer: 0,
  saveSide: 0,
  saveHeight: 0,
  shotStyle: 'wrist',
  shotDuration: 0.34,
  shotLoad: 0,
  shotSide: STICK.restSide,
  shotReach: STICK.restReach,
  stickSide: STICK.restSide,
  stickReach: STICK.restReach,
  stickSideVel: 0,
  stickReachVel: 0,
  dekeKind: null,
  dekeTimer: 0,
  dekeDir: 1,
  cellyKind: null,
  cellyTimer: 0,
  fallAngle: 0.6,
  passTimer: 0,
} satisfies ClipSkater;

const TAU = Math.PI * 2;
/** Rate the deke stick spring is integrated at. */
const STICK_HZ = 240;
/** The engine advances the stride phase 1.05 radians per metre skated. */
const STRIDE_PER_M = 1.05;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Seconds for `n` full stride cycles at `speed`, so a looping clip joins up. */
const cycles = (speed: number, n: number) => (n * TAU) / (STRIDE_PER_M * Math.abs(speed));
/** Straight-line skating along +z. */
const skate = (t: number, speed: number, drive: number): ClipSkater => ({
  vz: speed,
  skateDrive: drive,
  stride: t * Math.abs(speed) * STRIDE_PER_M,
  rush: Math.abs(speed),
});
/** Skating along the current facing. */
const along = (angle: number, speed: number): ClipSkater => ({
  angle,
  vx: Math.sin(angle) * speed,
  vz: Math.cos(angle) * speed,
  rush: speed,
});

const clip = (c: LabClip) => c;
const hold = (skater: ClipSkater, puck: ClipFrame['puck'] = 'tape', charge = 0): ClipFrame => ({
  skater,
  puck,
  charge,
});

type ShotStyle = 'wrist' | 'slap' | 'backhand' | 'pass';
const SHOT = {
  wrist: { load: 0.45, charge: 0.3, speed: 28, lift: 4, side: STICK.restSide },
  slap: { load: 0.55, charge: 1, speed: 38, lift: 3, side: STICK.restSide },
  backhand: { load: 0.45, charge: 0.3, speed: 22, lift: 3.5, side: -0.25 },
  pass: { load: 0.3, charge: 0, speed: 16, lift: 0, side: STICK.restSide },
} as const;
function shotClip(style: ShotStyle, label: string, look: string): LabClip {
  const { load, charge, speed, lift, side } = SHOT[style];
  const downswing = style === 'slap' ? SHOT_DOWNSWING : 0;
  const releaseAt = load + downswing;
  const duration = style === 'pass' ? 0.45 : 0.6;
  return clip({
    id: style === 'pass' || style === 'backhand' ? style : `${style}-shot`,
    label,
    group: 'Shots',
    duration: releaseAt + duration + 0.55,
    loop: false,
    look,
    frame(t) {
      const released = t >= releaseAt;
      const since = t - releaseAt;
      const skater: ClipSkater = {
        ...skate(t, 2, 0.15),
        stickSide: side,
        shotSide: side,
        shotReach: STICK.restReach,
        shotStyle: style,
        shotDuration: duration,
        shotTimer: released ? Math.max(0, duration - since) : 0,
        // What the windup was holding at release; the pose unwinds it through the shot.
        shotLoad: released ? (style === 'slap' ? 0 : charge) : 0,
        pendingShot:
          style === 'slap' && t >= load && !released
            ? { timer: releaseAt - t, load: 1, power: 1, aim: 0, height: 0.5, tick: 0 }
            : null,
      };
      const puck: ClipFrame['puck'] = released
        ? {
            x: side,
            y: Math.max(PUCK.restY, PUCK.restY + lift * since - 4.9 * since * since),
            z: STICK.restReach + speed * since,
          }
        : 'tape';
      return hold(skater, puck, t < load ? charge * smooth(t / (load * 0.8)) : 0);
    },
  });
}

function dekeClip(kind: DekeKind, dir: number, id: string, label: string, look: string) {
  const lead = 0.3,
    length = dekeDuration(kind),
    tail = 0.45;
  const start = sampleDeke(kind, 0, dir),
    end = sampleDeke(kind, 1, dir);
  const duration = lead + length + tail;
  // The engine springs the blade toward the deke pose (stiffer during a deke) and back to rest
  // after it, so the lab does too; setting the pose directly made pops the game doesn't have.
  const n = Math.ceil(duration * STICK_HZ) + 1;
  const path = new Float32Array(n * 2);
  let side = STICK.restSide,
    reach = STICK.restReach,
    sideVel = 0,
    reachVel = 0;
  for (let i = 0; i < n; i++) {
    path[i * 2] = side;
    path[i * 2 + 1] = reach;
    const into = i / STICK_HZ - lead;
    const on = into >= 0 && into < length;
    const pose = on ? sampleDeke(kind, into / length, dir) : null;
    const omega = on ? STICK.omega * 1.55 : STICK.omega,
      zeta = on ? 0.86 : STICK.zeta;
    const dt = 1 / STICK_HZ;
    sideVel +=
      (omega * omega * ((pose?.side ?? STICK.restSide) - side) - 2 * zeta * omega * sideVel) * dt;
    reachVel +=
      (omega * omega * ((pose?.reach ?? STICK.restReach) - reach) - 2 * zeta * omega * reachVel) *
      dt;
    side += sideVel * dt;
    reach += reachVel * dt;
  }
  const stickAt = (t: number, k: 0 | 1) => {
    const x = clamp(t * STICK_HZ, 0, n - 1),
      i = Math.min(n - 2, Math.floor(x));
    return path[i * 2 + k] + (path[(i + 1) * 2 + k] - path[i * 2 + k]) * (x - i);
  };
  return clip({
    id,
    label,
    group: 'Dekes',
    duration,
    loop: false,
    look,
    frame(t) {
      const into = t - lead;
      const on = into >= 0 && into < length;
      const pose = sampleDeke(kind, clamp(into / length, 0, 1), dir);
      const side = stickAt(t, 0),
        reach = stickAt(t, 1);
      return hold({
        ...skate(t, 5.5, 0.3),
        ...along(into < 0 ? 0 : (on ? pose.yaw : end.yaw) - start.yaw, 5.5),
        stride: t * 5.5 * STRIDE_PER_M,
        dekeKind: on ? kind : null,
        dekeTimer: on ? into : 0,
        dekeDir: dir,
        stickSide: side,
        stickReach: reach,
      });
    },
  });
}

function cellyClip(kind: CellyKind, id: string, label: string, look: string) {
  const lead = 0.15,
    length = cellyDuration(kind);
  return clip({
    id,
    label,
    group: 'Cellys',
    duration: lead + length + 0.25,
    loop: false,
    look,
    frame(t) {
      const into = t - lead;
      const on = into >= 0 && into < length;
      return hold(
        {
          ...skate(t, kind === 'dance' ? 1.4 : 3.2, kind === 'dance' ? 0.85 : 0.2),
          cellyKind: on ? kind : null,
          cellyTimer: on ? into : 0,
        },
        'none',
      );
    },
  });
}

/** A countdown timer that starts at `at` from `length`, the way the engine runs action timers. */
const countdown = (t: number, at: number, length: number) =>
  t < at ? 0 : Math.max(0, length - (t - at));

const ACCEL = 2.2;
/** Distance covered by 0 → 8.5 m/s on a smoothstep ramp over ACCEL seconds. */
function accelDistance(t: number) {
  const x = Math.min(t / ACCEL, 1);
  return 8.5 * (ACCEL * (x ** 3 - x ** 4 / 2) + Math.max(0, t - ACCEL));
}
const CARVE = 2.4;
const carveAngle = (t: number) =>
  ((1.26 * CARVE) / Math.PI) * (1 - Math.cos((Math.PI * t) / CARVE));

export const CLIPS: LabClip[] = [
  clip({
    id: 'stance',
    label: 'Stance',
    group: 'Skating',
    duration: 2,
    loop: true,
    look: 'Knees bent, weight centred, both gloves on the shaft, blade flat on the ice.',
    frame: () => hold({ stride: 0.5 }),
  }),
  clip({
    id: 'glide',
    label: 'Glide',
    group: 'Skating',
    duration: cycles(6, 2),
    loop: true,
    look: 'Both skates planted and still under the hips; nothing pumping.',
    frame: (t) => hold(skate(t, 6, 0)),
  }),
  clip({
    id: 'stride',
    label: 'Stride · puck',
    group: 'Skating',
    duration: cycles(7, 2),
    loop: true,
    look: 'Push out and back, toe flick, recovery under the hips. Skates stay on the ice while loaded; hands stay on the shaft.',
    frame: (t) => hold(skate(t, 7, 0.85)),
  }),
  clip({
    id: 'sprint',
    label: 'Sprint · no puck',
    group: 'Skating',
    duration: cycles(8.5, 2),
    loop: true,
    look: 'Bottom hand off the stick, free arm pumping opposite the push leg, deep knee bend.',
    frame: (t) => hold(skate(t, 8.5, 0.7), 'none'),
  }),
  clip({
    id: 'accelerate',
    label: 'Accelerate 0 → 8.5',
    group: 'Skating',
    duration: 2.8,
    loop: false,
    look: 'Short choppy first strides lengthening out; the bottom hand lets go smoothly around 4.5 m/s, no pop.',
    frame(t) {
      const speed = 8.5 * smooth(t / ACCEL);
      return hold(
        {
          vz: speed,
          rush: speed,
          skateDrive: 0.95 - 0.25 * smooth(t / ACCEL),
          stride: accelDistance(t) * STRIDE_PER_M,
        },
        'none',
      );
    },
  }),
  clip({
    id: 'backward',
    label: 'Backward C-cuts',
    group: 'Skating',
    duration: cycles(4, 2),
    loop: true,
    look: 'Seated, back straight, alternating C-cuts with toes turned in on the push; both skates stay down.',
    frame: (t) => hold(skate(t, -4, 0.8)),
  }),
  clip({
    id: 'crossover',
    label: 'Crossovers (left turn)',
    group: 'Skating',
    duration: cycles(7, 2),
    loop: true,
    look: 'Outside skate crosses over the inside one, body leans into the turn without tipping, stick stays on the ice.',
    frame: (t) => hold({ ...skate(t, 7, 0.8), ...along(1.3 * t, 7), edgeLean: 0.85 }),
  }),
  clip({
    id: 'carve',
    label: 'Carve in and out',
    group: 'Skating',
    duration: CARVE,
    loop: false,
    look: 'Edges build then release; lean comes from hips and skates, the torso stays over the feet.',
    frame(t) {
      const lean = 0.9 * Math.sin((Math.PI * t) / CARVE);
      return hold({ ...skate(t, 7, 0.35), ...along(carveAngle(t), 7), edgeLean: lean });
    },
  }),
  clip({
    id: 'stop',
    label: 'Hockey stop',
    group: 'Skating',
    duration: 1.4,
    loop: false,
    look: 'Skates turned sideways and scraping, knees absorbing, shoulders square to the play.',
    frame(t) {
      const left = 1 - smooth(t / 1.2);
      return hold({ vx: 7 * left, vz: 1.5 * left, edgeLean: -0.8 * left, rush: 7 * left });
    },
  }),
  clip({
    id: 'stumble',
    label: 'Stumble',
    group: 'Skating',
    duration: 1.1,
    loop: false,
    look: 'Off balance but on the skates: lurching torso, no limbs through each other.',
    frame: (t) => hold({ ...skate(t, 5, 0), stumbleTimer: countdown(t, 0.1, 0.8) }, 'none'),
  }),
  clip({
    id: 'handling',
    label: 'Stickhandling',
    group: 'Puck',
    duration: cycles(3, 1),
    loop: true,
    look: 'Blade cups the puck side to side, wrists roll, top hand stays in front of the belly.',
    frame: (t) =>
      hold({
        ...skate(t, 3, 0.3),
        stickSide: 0.18 + 0.62 * Math.sin((TAU * t) / cycles(3, 1)),
      }),
  }),
  clip({
    id: 'stick-sweep',
    label: 'Blade sweep across body',
    group: 'Puck',
    duration: 3,
    loop: true,
    look: 'Blade crosses from forehand (1.0) to backhand (-0.7): both hands must move continuously with no one-frame jump.',
    frame: (t) => hold({ stickSide: 0.15 + 0.85 * Math.cos((TAU * t) / 3) }),
  }),
  clip({
    id: 'toe-drag',
    label: 'Toe drag',
    group: 'Puck',
    duration: 1.6,
    loop: false,
    look: 'Puck pulled into the skates; the bottom hand may come off, the top hand must not clip the torso.',
    frame(t) {
      const pull = Math.sin((Math.PI * t) / 1.6);
      return hold({
        ...skate(t, 4, 0.2),
        stickSide: STICK.restSide - 0.45 * pull,
        stickReach: STICK.restReach - 0.9 * pull,
      });
    },
  }),
  clip({
    id: 'pull-in',
    label: 'Reach in and out',
    group: 'Puck',
    duration: 2.4,
    loop: true,
    look: 'Known limit: under ~0.8 reach the rigid stick stands up and the top hand rises. Look for pops at the switch.',
    frame: (t) => hold({ stickSide: 0.3, stickReach: 0.9 + 0.5 * Math.cos((TAU * t) / 2.4) }),
  }),
  shotClip(
    'wrist',
    'Wrist shot',
    'Small load then a snap through the puck, weight onto the front skate, follow-through toward the target.',
  ),
  shotClip(
    'slap',
    'Slap shot',
    'Big windup with the blade high, 75 ms downswing into the ice behind the puck, then follow-through. Hands stay on the shaft.',
  ),
  shotClip(
    'backhand',
    'Backhand',
    'Blade on the backhand side, the torso turns across and lifts through the release.',
  ),
  shotClip('pass', 'Pass', 'Short sweep, soft follow-through, hands barely lift.'),
  clip({
    id: 'windup-hold',
    label: 'Windup and hold',
    group: 'Shots',
    duration: 2,
    loop: false,
    look: 'Charge ramps to full then holds: the loaded pose must stay stable, no drift or jitter.',
    frame: (t) => hold({ ...skate(t, 2, 0.15) }, 'tape', smooth(t / 1)),
  }),
  dekeClip(
    'stride',
    1,
    'deke-right',
    'One-touch cut right',
    'Hard lateral push off the outside skate, puck yanked wide across the body.',
  ),
  dekeClip(
    'stride',
    -1,
    'deke-left',
    'One-touch cut left',
    'Mirror of the right cut. Compare them: they should be symmetrical.',
  ),
  dekeClip(
    'burst',
    1,
    'deke-burst',
    'Burst',
    'Puck punched ahead of the skates, body lunges through the gap.',
  ),
  dekeClip(
    'protect',
    1,
    'deke-protect',
    'Protect',
    'Shoulders turn between the defender and the puck; blade drawn in to the hip.',
  ),
  dekeClip(
    'jump',
    1,
    'deke-jump',
    'Jump',
    'Skates tuck, the skater leaves the ice and lands on bent knees.',
  ),
  dekeClip(
    'throughLegs',
    1,
    'deke-legs',
    'Through the legs',
    'Bottom hand releases, blade passes between the skates, re-grip without a pop.',
  ),
  dekeClip(
    'windmill',
    1,
    'deke-windmill',
    'Windmill',
    'One-handed sweep around; free arm balances, re-grip is continuous.',
  ),
  dekeClip(
    'spin',
    1,
    'deke-spin',
    'Spin-o-rama',
    'Immediate 360 on the edges, puck stays on the blade in front. No gather to center.',
  ),
  cellyClip(
    'helicopter',
    'celly-helicopter',
    'Celly · helicopter',
    'Stick spins overhead like a rotor; the body leans back and turns under it.',
  ),
  cellyClip(
    'jump',
    'celly-jump',
    'Celly · leap',
    'Deep crouch, then a huge jump with a spin and a stick raised over the head.',
  ),
  cellyClip(
    'limp',
    'celly-limp',
    'Celly · limp',
    'The skater goes slack. Live play uses the knockdown ragdoll; here the pose collapses.',
  ),
  cellyClip(
    'dance',
    'celly-dance',
    'Celly · dance',
    'Hips, knees and stick all moving on different beats; a little too much.',
  ),
  clip({
    id: 'check',
    label: 'Body check',
    group: 'Contact',
    duration: 1.2,
    loop: false,
    look: 'Load, then shoulder drives through; the bottom hand releases; recovery back to stance.',
    frame: (t) =>
      hold({ ...skate(t, 6, 0.5), checkTimer: countdown(t, 0.2, PHYSICS.checkWindow) }, 'none'),
  }),
  clip({
    id: 'dive',
    label: 'Dive block',
    group: 'Contact',
    duration: 1.6,
    loop: false,
    look: 'Belly-flop slide, arms and stick out front, legs trailing on the ice rather than folding under.',
    frame: (t) => hold({ ...skate(t, 4, 0), diveTimer: countdown(t, 0.2, 1.1) }, 'none'),
  }),
  clip({
    id: 'block',
    label: 'Lane block',
    group: 'Contact',
    duration: 1.8,
    loop: false,
    look: 'Stick laid across the lane, crouched lower, holds steady, returns smoothly.',
    frame: (t) => hold({ blockTimer: t > 0.2 && t < 1.3 ? 0.12 : countdown(t, 1.3, 0.12) }, 'none'),
  }),
  clip({
    id: 'lift',
    label: 'Stick lift',
    group: 'Contact',
    duration: 1,
    loop: false,
    look: 'Quick lift of the opponent stick; arms lift, torso leans in, no pop back.',
    frame: (t) => hold({ ...skate(t, 3, 0.2), liftTimer: countdown(t, 0.2, 0.4) }, 'none'),
  }),
  clip({
    id: 'goalie',
    label: 'Goalie ready',
    group: 'Goalie',
    goalie: true,
    duration: 2,
    loop: true,
    look: 'Wide stance, pads square, stick on the ice in front of the five-hole, glove open.',
    frame: () => hold({}, 'none'),
  }),
  clip({
    id: 'goalie-shuffle',
    label: 'Goalie shuffle',
    group: 'Goalie',
    goalie: true,
    duration: 2,
    loop: true,
    look: 'Lateral shuffle: skates stay on the ice, upper body quiet.',
    frame: (t) => hold({ vx: 1.5 * Math.sin(Math.PI * t) }, 'none'),
  }),
  ...(
    [
      [
        'goalie-low',
        'Butterfly save',
        0.1,
        0.7,
        'Drops to the butterfly, pads flare, then recovers to ready.',
      ],
      [
        'goalie-glove',
        'Glove save',
        1.25,
        0.7,
        'Glove snaps up and out to the puck, holds, then returns.',
      ],
      [
        'goalie-blocker',
        'Blocker save',
        0.9,
        -0.7,
        'Blocker side kicks out, stick stays covering the ice.',
      ],
    ] as const
  ).map(([id, label, height, side, look]) =>
    clip({
      id,
      label,
      group: 'Goalie',
      goalie: true,
      duration: 1.4,
      loop: false,
      look,
      frame: (t) =>
        hold(
          { saveTimer: countdown(t, 0.2, GOALIE_SAVE_TIME), saveHeight: height, saveSide: side },
          'none',
        ),
    }),
  ),
];

/** One frame of a live take: the skater, and the puck in rink space. */
export interface TakeFrame {
  t: number;
  skater: ClipSkater;
  puck: { x: number; y: number; z: number; owned: boolean };
  charge: number;
}
const DISCRETE = new Set([
  'dekeKind',
  'cellyKind',
  'shotStyle',
  'pendingShot',
  'checkLanded',
  'queuedCheck',
]);
function mixSkater(a: ClipSkater, b: ClipSkater, w: number): ClipSkater {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(a) as (keyof ClipSkater)[]) {
    const x = a[key],
      y = b[key];
    if (typeof x !== 'number' || typeof y !== 'number' || DISCRETE.has(key)) {
      out[key] = w < 0.5 ? x : y;
      continue;
    }
    // Headings take the short way round.
    const span = key === 'angle' ? Math.atan2(Math.sin(y - x), Math.cos(y - x)) : y - x;
    out[key] = x + span * w;
  }
  return out as ClipSkater;
}
/** A recorded live take as a scrubbable clip. Positions are relative to where it started. */
export function takeClip(id: string, frames: TakeFrame[]): LabClip {
  const x0 = frames[0].skater.x ?? 0,
    z0 = frames[0].skater.z ?? 0,
    t0 = frames[0].t;
  const times = frames.map((f) => f.t - t0);
  return {
    id,
    label: id.replace('take-', 'Take '),
    group: 'Takes',
    duration: times.at(-1)! || 1 / 60,
    loop: true,
    look: 'Recorded live. Knockdowns are physics and are not replayed here: use scripts/ragdoll-shots.mjs.',
    frame(t) {
      let i = 0;
      while (i < times.length - 2 && times[i + 1] <= t) i++;
      const a = frames[i],
        b = frames[Math.min(i + 1, frames.length - 1)];
      const span = times[Math.min(i + 1, times.length - 1)] - times[i];
      const w = span > 0 ? clamp((t - times[i]) / span, 0, 1) : 0;
      const skater = mixSkater(a.skater, b.skater, w);
      skater.x = (skater.x ?? 0) - x0;
      skater.z = (skater.z ?? 0) - z0;
      skater.downTimer = 0;
      const near = w < 0.5 ? a : b;
      let puck: ClipFrame['puck'] = 'tape';
      if (!near.puck.owned) {
        const angle = skater.angle ?? 0,
          dx = near.puck.x - x0 - skater.x,
          dz = near.puck.z - z0 - skater.z;
        puck = {
          x: Math.cos(angle) * dx - Math.sin(angle) * dz,
          y: near.puck.y,
          z: Math.sin(angle) * dx + Math.cos(angle) * dz,
        };
      }
      return { skater, puck, charge: a.charge + (b.charge - a.charge) * w };
    },
  };
}

const travelCache = new WeakMap<LabClip, Float32Array>();
const TRAVEL_HZ = 120;
/** Where the skater has skated to by `t`, integrating the clip's velocity from the origin. */
export function travelAt(clip: LabClip, t: number): { x: number; z: number } {
  if (clip.group === 'Takes') {
    const { x = 0, z = 0 } = clip.frame(t).skater;
    return { x, z };
  }
  let path = travelCache.get(clip);
  if (!path) {
    const n = Math.ceil(clip.duration * TRAVEL_HZ) + 1;
    path = new Float32Array(n * 2);
    for (let i = 1; i < n; i++) {
      const { vx = 0, vz = 0 } = clip.frame((i - 0.5) / TRAVEL_HZ).skater;
      path[i * 2] = path[i * 2 - 2] + vx / TRAVEL_HZ;
      path[i * 2 + 1] = path[i * 2 - 1] + vz / TRAVEL_HZ;
    }
    travelCache.set(clip, path);
  }
  const i = clamp(Math.round(t * TRAVEL_HZ), 0, path.length / 2 - 1);
  return { x: path[i * 2], z: path[i * 2 + 1] };
}
