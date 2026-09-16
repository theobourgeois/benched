// Animation lab measurements: joint positions, angles, grip, skate and stick contact for one frame,
// then issue spans, one-frame pops and a plain-text report for a whole clip.
import * as THREE from 'three';
import type { PoseDebug } from '../scene/animationReview';
import { GRIP_ALONG, GRIP_OUT, type BoneName, type SkaterRig } from '../scene/skaterModel';
import type { StickParts } from '../scene/stick';
import type { Skater } from '../game/types';

export const JOINTS = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'elbowL',
  'wristL',
  'palmL',
  'shoulderR',
  'elbowR',
  'wristR',
  'palmR',
  'hipL',
  'kneeL',
  'ankleL',
  'toeL',
  'hipR',
  'kneeR',
  'ankleR',
  'toeR',
  'knob',
  'hosel',
] as const;
export type Joint = (typeof JOINTS)[number];
export type V3 = [number, number, number];

/** Thresholds for flagged frames. One place, so the lab and the report agree. */
export const LIMITS = {
  /** Middle of the closed fingers to the shaft axis while that hand should be holding, cm. */
  gripCm: 3.5,
  /** Shaft off the knuckle line while holding, degrees: past this it runs through the palm. */
  gripDeg: 35,
  kneeStraightDeg: 6,
  kneeFoldDeg: 145,
  elbowStraightDeg: 4,
  /** Hand bent off the forearm line. Past this the glove reads as a broken wrist. */
  wristDeg: 55,
  /** Shoulder-to-wrist or hip-to-ankle over the bone lengths: the IK could not reach. */
  stretch: 1.002,
  /** Ankle below its planted height, cm. */
  skateSinkCm: -1.5,
  /** Hosel below the ice, cm. */
  bladeSinkCm: -1,
  /** Shaft (below the top hand) to the pelvis–neck line, cm: under this it passes through the body. */
  shaftTorsoCm: 9,
  /** Second difference of a joint path in one 60 Hz frame, cm, and how far over its neighbours. */
  popCm: 1.6,
  popRatio: 4,
} as const;

export type IssueKind =
  | 'grip'
  | 'grip-angle'
  | 'knee-straight'
  | 'knee-fold'
  | 'elbow-straight'
  | 'wrist'
  | 'stretch'
  | 'skate-sink'
  | 'blade-sink'
  | 'shaft-torso'
  | 'shaft-length';
export interface Issue {
  kind: IssueKind;
  where: string;
  value: number;
  limit: number;
}

export interface LabSample {
  t: number;
  /** 60 Hz frame index, round(t * 60). */
  frame: number;
  /** Skater frame, metres: x to the skater's left, y above the rink surface, z ahead. */
  joints: Record<Joint, V3>;
  /** Degrees. Flexion is 0 when straight. Torso pitch + leans forward, roll + leans left, twist + turns the left shoulder forward of the hips. */
  angles: {
    kneeL: number;
    kneeR: number;
    hipL: number;
    hipR: number;
    elbowL: number;
    elbowR: number;
    wristL: number;
    wristR: number;
    torsoPitch: number;
    torsoRoll: number;
    torsoTwist: number;
  };
  /** Finger loop to the shaft axis (cm), hand spread along the shaft (cm), and the shaft's angle off each knuckle line (degrees). */
  grip: { L: number; R: number; spread: number; angleL: number; angleR: number };
  /** Ankle height over its planted height, cm. */
  lift: { L: number; R: number };
  /** Hosel height (cm), shaft angle from vertical, shaft length (m), shaft-to-torso distance (cm). */
  stick: { blade: number; tilt: number; length: number; torso: number };
  /** Fraction of full limb length in use. 1 is locked straight. */
  reach: { armL: number; armR: number; legL: number; legR: number };
  pose: Omit<PoseDebug, 'tip' | 'grip' | 'hosel'>;
  /** What the pose asked for before the stick was solved: blade tip, top-hand target, hosel (skater frame, m). */
  targets: { tip: V3; grip: V3; hosel: V3 };
  input: {
    speed: number;
    along: number;
    drive: number;
    stridePhase: number;
    edgeLean: number;
    stickSide: number;
    stickReach: number;
    charge: number;
    deke: string | null;
    dekeTimer: number;
    shotTimer: number;
    checkTimer: number;
    stumbleTimer: number;
    diveTimer: number;
    saveTimer: number;
  };
  issues: Issue[];
}

const _w = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _inv = new THREE.Matrix4(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3();
/** Wrist to the middle of the closed fingers in the hand bone's frame, world units (see holdStick). */
const PALM = new THREE.Vector3(0, GRIP_ALONG, GRIP_OUT);
/** Rig-root height plus the pose's ICE_Y: where a planted ankle sits above its bind height. */
const PLANT_Y = 0.01;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: V3, b: V3) => len(sub(a, b));
function between(a: V3, b: V3) {
  const d = dot(a, b) / (len(a) * len(b) || 1);
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
}
/** Bend at `b` on the chain a–b–c, 0 when straight. */
const flex = (a: V3, b: V3, c: V3) => 180 - between(sub(a, b), sub(c, b));
/** Angle between two lines, ignoring which way each points, degrees. */
const acute = (a: V3, b: V3) => Math.min(between(a, b), 180 - between(a, b));
const deg = (r: number) => (r * 180) / Math.PI;

/** Closest distance between segments p0–p1 and q0–q1. */
export function segmentDistance(p0: V3, p1: V3, q0: V3, q1: V3) {
  const d1 = sub(p1, p0),
    d2 = sub(q1, q0),
    r = sub(p0, q0);
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r);
  let s = 0,
    t = 0;
  if (a < 1e-9 && e < 1e-9) return len(r);
  if (a < 1e-9) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = dot(d1, r);
    if (e < 1e-9) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = dot(d1, d2),
        denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cp: V3 = [p0[0] + d1[0] * s, p0[1] + d1[1] * s, p0[2] + d1[2] * s];
  const cq: V3 = [q0[0] + d2[0] * t, q0[1] + d2[1] * t, q0[2] + d2[2] * t];
  return dist(cp, cq);
}

/** Palm distance to the infinite shaft line, and its position along it from the hosel (m). */
function onShaft(palm: V3, hosel: V3, knob: V3) {
  const axis = sub(knob, hosel),
    rel = sub(palm, hosel);
  const s = dot(rel, axis) / (dot(axis, axis) || 1);
  const foot: V3 = [hosel[0] + axis[0] * s, hosel[1] + axis[1] * s, hosel[2] + axis[2] * s];
  return { off: dist(palm, foot), along: s * len(axis) };
}

/** Everything the lab knows about the subject's current pose. Call after the rig is posed. */
export function measure(
  rig: SkaterRig,
  stick: StickParts,
  pose: PoseDebug,
  skater: Skater,
  charge: number,
  t: number,
): LabSample {
  const body = rig.root.parent?.parent ?? rig.root;
  body.updateMatrixWorld(true);
  _inv.copy(body.matrixWorld).invert();
  const lift = body.position.y;
  const local = (w: THREE.Vector3): V3 => {
    const p = w.applyMatrix4(_inv);
    return [r3(p.x), r3(p.y + lift), r3(p.z)];
  };
  const bone = (name: BoneName) => local(rig.bones[name].getWorldPosition(_w));
  const palm = (side: 'L' | 'R') => {
    const hand = rig.bones[`hand${side}`];
    hand.getWorldQuaternion(_q);
    return local(hand.getWorldPosition(_w).add(_a.copy(PALM).applyQuaternion(_q)));
  };
  const ends = [
    local(stick.shaft.localToWorld(_w.set(0, 0.5, 0))),
    local(stick.shaft.localToWorld(_w.set(0, -0.5, 0))),
  ];
  const j = {
    pelvis: bone('pelvis'),
    chest: bone('chest'),
    neck: bone('neck'),
    head: bone('head'),
    shoulderL: bone('upperArmL'),
    elbowL: bone('forearmL'),
    wristL: bone('handL'),
    palmL: palm('L'),
    shoulderR: bone('upperArmR'),
    elbowR: bone('forearmR'),
    wristR: bone('handR'),
    palmR: palm('R'),
    hipL: bone('thighL'),
    kneeL: bone('shinL'),
    ankleL: bone('footL'),
    toeL: bone('toeL'),
    hipR: bone('thighR'),
    kneeR: bone('shinR'),
    ankleR: bone('footR'),
    toeR: bone('toeR'),
    knob: ends[0],
    hosel: ends[1],
  } satisfies Record<Joint, V3>;
  // The knob is whichever end the top hand holds.
  if (dist(j.palmR, ends[1]) < dist(j.palmR, ends[0])) [j.knob, j.hosel] = [ends[1], ends[0]];

  const handAxis = (side: 'L' | 'R', axis: 'x' | 'y' = 'y'): V3 => {
    rig.bones[`hand${side}`].getWorldQuaternion(_q);
    // Direction only: rotate into the skater frame without the translation.
    _b.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, 0)
      .applyQuaternion(_q)
      .transformDirection(_inv);
    return [_b.x, _b.y, _b.z];
  };
  const torsoUp = sub(j.neck, j.pelvis);
  const shoulders = sub(j.shoulderL, j.shoulderR),
    hips = sub(j.hipL, j.hipR);
  const twist = Math.atan2(shoulders[2], shoulders[0]) - Math.atan2(hips[2], hips[0]);
  const angles = {
    kneeL: flex(j.hipL, j.kneeL, j.ankleL),
    kneeR: flex(j.hipR, j.kneeR, j.ankleR),
    hipL: 180 - between(torsoUp, sub(j.kneeL, j.hipL)),
    hipR: 180 - between(torsoUp, sub(j.kneeR, j.hipR)),
    elbowL: flex(j.shoulderL, j.elbowL, j.wristL),
    elbowR: flex(j.shoulderR, j.elbowR, j.wristR),
    wristL: between(sub(j.wristL, j.elbowL), handAxis('L')),
    wristR: between(sub(j.wristR, j.elbowR), handAxis('R')),
    torsoPitch: deg(Math.atan2(torsoUp[2], torsoUp[1])),
    torsoRoll: deg(Math.atan2(torsoUp[0], torsoUp[1])),
    torsoTwist: deg(Math.atan2(Math.sin(twist), Math.cos(twist))),
  };
  for (const key of Object.keys(angles) as (keyof typeof angles)[]) angles[key] = r1(angles[key]);

  const gripL = onShaft(j.palmL, j.hosel, j.knob),
    gripR = onShaft(j.palmR, j.hosel, j.knob);
  const shaft = sub(j.knob, j.hosel);
  const shaftLength = len(shaft);
  // Only the shaft below the top hand can pass through the body; the knob pokes past the glove.
  const held: V3 = [
    j.hosel[0] + (shaft[0] * gripR.along) / shaftLength,
    j.hosel[1] + (shaft[1] * gripR.along) / shaftLength,
    j.hosel[2] + (shaft[2] * gripR.along) / shaftLength,
  ];
  const limb = (a: BoneName, b: BoneName) =>
    (rig.bones[a].position.length() + rig.bones[b].position.length()) * rig.scale;
  const armL = limb('forearmL', 'handL'),
    armR = limb('forearmR', 'handR'),
    legL = limb('shinL', 'footL'),
    legR = limb('shinR', 'footR');
  const along = skater.vx * Math.sin(skater.angle) + skater.vz * Math.cos(skater.angle);
  const { tip, grip, hosel, action, ...rest } = pose;
  const target = (v: V3): V3 => [r3(v[0]), r3(v[1] + lift), r3(v[2])];
  const sample: LabSample = {
    t: r3(t),
    frame: Math.round(t * 60),
    joints: j,
    angles,
    grip: {
      L: r1(gripL.off * 100),
      R: r1(gripR.off * 100),
      spread: r1(Math.abs(gripR.along - gripL.along) * 100),
      angleL: r1(acute(shaft, handAxis('L', 'x'))),
      angleR: r1(acute(shaft, handAxis('R', 'x'))),
    },
    lift: {
      L: r1((j.ankleL[1] - PLANT_Y - rig.ankleHeight) * 100),
      R: r1((j.ankleR[1] - PLANT_Y - rig.ankleHeight) * 100),
    },
    stick: {
      blade: r1(j.hosel[1] * 100),
      tilt: r1(between(shaft, [0, 1, 0])),
      length: r3(shaftLength),
      torso: r1(segmentDistance(j.hosel, held, j.pelvis, j.neck) * 100),
    },
    reach: {
      armL: r3(dist(j.shoulderL, j.wristL) / armL),
      armR: r3(dist(j.shoulderR, j.wristR) / armR),
      legL: r3(dist(j.hipL, j.ankleL) / legL),
      legR: r3(dist(j.hipR, j.ankleR) / legR),
    },
    targets: { tip: target(tip), grip: target(grip), hosel: target(hosel) },
    pose: {
      ...rest,
      action: Object.fromEntries(
        Object.entries(action).map(([k, v]) => [k, r3(v)]),
      ) as unknown as PoseDebug['action'],
    },
    input: {
      speed: r3(Math.hypot(skater.vx, skater.vz)),
      along: r3(along),
      drive: r3(skater.skateDrive),
      stridePhase: r3((((skater.stride / (Math.PI * 2)) % 1) + 1) % 1),
      edgeLean: r3(skater.edgeLean),
      stickSide: r3(skater.stickSide),
      stickReach: r3(skater.stickReach),
      charge: r3(charge),
      deke: skater.dekeKind,
      dekeTimer: r3(skater.dekeTimer),
      shotTimer: r3(skater.shotTimer),
      checkTimer: r3(skater.checkTimer),
      stumbleTimer: r3(skater.stumbleTimer),
      diveTimer: r3(skater.diveTimer),
      saveTimer: r3(skater.saveTimer ?? 0),
    },
    issues: [],
  };
  sample.issues = findIssues(sample);
  return sample;
}

/** Frame-level problems, judged against LIMITS. Ragdoll and fallen frames are not judged. */
export function findIssues(s: LabSample): Issue[] {
  const out: Issue[] = [];
  const { pose } = s;
  if (pose.ragdoll || pose.stickBlend < 0.4) return out;
  const flag = (kind: IssueKind, where: string, value: number, limit: number) =>
    out.push({ kind, where, value, limit });
  if (s.grip.R > LIMITS.gripCm) flag('grip', 'top hand (R)', s.grip.R, LIMITS.gripCm);
  if (!pose.goalie && pose.freeHand < 0.05 && s.grip.L > LIMITS.gripCm)
    flag('grip', 'bottom hand (L)', s.grip.L, LIMITS.gripCm);
  if (!pose.goalie && s.grip.angleR > LIMITS.gripDeg)
    flag('grip-angle', 'top hand (R)', s.grip.angleR, LIMITS.gripDeg);
  if (!pose.goalie && pose.freeHand < 0.05 && s.grip.angleL > LIMITS.gripDeg)
    flag('grip-angle', 'bottom hand (L)', s.grip.angleL, LIMITS.gripDeg);
  for (const side of ['L', 'R'] as const) {
    const knee = s.angles[`knee${side}`],
      elbow = s.angles[`elbow${side}`],
      wrist = s.angles[`wrist${side}`];
    if (knee < LIMITS.kneeStraightDeg)
      flag('knee-straight', `knee ${side}`, knee, LIMITS.kneeStraightDeg);
    if (knee > LIMITS.kneeFoldDeg) flag('knee-fold', `knee ${side}`, knee, LIMITS.kneeFoldDeg);
    if (elbow < LIMITS.elbowStraightDeg)
      flag('elbow-straight', `elbow ${side}`, elbow, LIMITS.elbowStraightDeg);
    if (wrist > LIMITS.wristDeg) flag('wrist', `wrist ${side}`, wrist, LIMITS.wristDeg);
    if (s.reach[`arm${side}`] > LIMITS.stretch)
      flag('stretch', `arm ${side}`, s.reach[`arm${side}`], LIMITS.stretch);
    if (s.reach[`leg${side}`] > LIMITS.stretch)
      flag('stretch', `leg ${side}`, s.reach[`leg${side}`], LIMITS.stretch);
    if (s.lift[side] < LIMITS.skateSinkCm)
      flag('skate-sink', `skate ${side}`, s.lift[side], LIMITS.skateSinkCm);
  }
  if (s.stick.blade < LIMITS.bladeSinkCm)
    flag('blade-sink', 'blade', s.stick.blade, LIMITS.bladeSinkCm);
  if (s.stick.torso < LIMITS.shaftTorsoCm)
    flag('shaft-torso', 'shaft', s.stick.torso, LIMITS.shaftTorsoCm);
  return out;
}

export const ISSUE_TEXT: Record<IssueKind, string> = {
  grip: 'hand off the shaft',
  'grip-angle': 'shaft through the palm',
  'knee-straight': 'knee locked straight',
  'knee-fold': 'knee over-folded',
  'elbow-straight': 'elbow locked straight',
  wrist: 'wrist folded',
  stretch: 'limb stretched past its bones',
  'skate-sink': 'skate through the ice',
  'blade-sink': 'blade through the ice',
  'shaft-torso': 'shaft through the body',
  'shaft-length': 'shaft length changed',
};
const UNITS: Record<IssueKind, string> = {
  grip: 'cm',
  'grip-angle': '°',
  'knee-straight': '°',
  'knee-fold': '°',
  'elbow-straight': '°',
  wrist: '°',
  stretch: '×',
  'skate-sink': 'cm',
  'blade-sink': 'cm',
  'shaft-torso': 'cm',
  'shaft-length': 'm',
};
export const issueLabel = (i: Issue) =>
  `${i.where}: ${ISSUE_TEXT[i.kind]} (${i.value}${UNITS[i.kind]}, limit ${i.limit}${UNITS[i.kind]})`;

export interface IssueSpan {
  kind: IssueKind;
  where: string;
  from: number;
  to: number;
  /** Time and value of the worst frame. */
  at: number;
  worst: number;
  limit: number;
}
export interface Pop {
  joint: Joint;
  at: number;
  /** One-frame jump (second difference), cm, and the typical value around it. */
  cm: number;
  around: number;
}
export interface Analysis {
  frames: number;
  issues: IssueSpan[];
  pops: Pop[];
  ranges: Record<string, [number, number]>;
}

const POP_JOINTS: Joint[] = [
  'palmL',
  'palmR',
  'elbowL',
  'elbowR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
  'knob',
  'hosel',
  'pelvis',
  'head',
];
/** Worse means further past the limit: lower for minimum limits, higher for maximum ones. */
const lowerIsWorse = new Set<IssueKind>([
  'knee-straight',
  'elbow-straight',
  'skate-sink',
  'blade-sink',
  'shaft-torso',
]);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Issue spans, one-frame pops and value ranges over a track of samples. */
export function analyze(samples: LabSample[]): Analysis {
  const track = [...samples].sort((a, b) => a.frame - b.frame);
  const issues: IssueSpan[] = [];
  const open = new Map<string, IssueSpan & { last: number }>();
  for (const s of track) {
    for (const issue of s.issues) {
      const key = `${issue.kind}|${issue.where}`;
      const span = open.get(key);
      if (span && s.frame - span.last <= 2) {
        span.to = s.t;
        span.last = s.frame;
        const worse = lowerIsWorse.has(issue.kind)
          ? issue.value < span.worst
          : issue.value > span.worst;
        if (worse) {
          span.worst = issue.value;
          span.at = s.t;
        }
      } else {
        if (span) issues.push(span);
        open.set(key, {
          kind: issue.kind,
          where: issue.where,
          from: s.t,
          to: s.t,
          at: s.t,
          worst: issue.value,
          limit: issue.limit,
          last: s.frame,
        });
      }
    }
  }
  issues.push(...open.values());
  for (const span of issues) delete (span as Partial<{ last: number }>).last;
  issues.sort((a, b) => a.from - b.from);

  const pops: Pop[] = [];
  for (const joint of POP_JOINTS) {
    const acc: { i: number; cm: number }[] = [];
    for (let i = 2; i < track.length; i++) {
      const [a, b, c] = [track[i - 2], track[i - 1], track[i]];
      if (b.frame - a.frame !== 1 || c.frame - b.frame !== 1) continue;
      if (a.pose.ragdoll || b.pose.ragdoll || c.pose.ragdoll) continue;
      const p0 = a.joints[joint],
        p1 = b.joints[joint],
        p2 = c.joints[joint];
      acc.push({
        i,
        cm:
          Math.hypot(
            p2[0] - 2 * p1[0] + p0[0],
            p2[1] - 2 * p1[1] + p0[1],
            p2[2] - 2 * p1[2] + p0[2],
          ) * 100,
      });
    }
    for (let k = 0; k < acc.length; k++) {
      const around = median(
        acc
          .slice(Math.max(0, k - 8), k + 9)
          .filter((_, n, all) => all[n] !== acc[k])
          .map((a) => a.cm),
      );
      const { i, cm } = acc[k];
      if (cm < LIMITS.popCm || cm < LIMITS.popRatio * Math.max(around, 0.05)) continue;
      const last = pops.at(-1);
      // A pop shows as a spike in consecutive second differences; keep the peak.
      if (last && last.joint === joint && track[i].t - last.at < 0.05) {
        if (cm > last.cm) Object.assign(last, { at: track[i].t, cm: r1(cm) });
        continue;
      }
      pops.push({ joint, at: track[i].t, cm: r1(cm), around: r1(around) });
    }
  }
  pops.sort((a, b) => a.at - b.at);

  const ranges: Record<string, [number, number]> = {};
  const note = (key: string, v: number) => {
    const r = (ranges[key] ??= [v, v]);
    r[0] = Math.min(r[0], v);
    r[1] = Math.max(r[1], v);
  };
  for (const s of track) {
    if (s.pose.ragdoll) continue;
    for (const [k, v] of Object.entries(s.angles)) note(k, v);
    note('gripL', s.grip.L);
    note('gripR', s.grip.R);
    note('liftL', s.lift.L);
    note('liftR', s.lift.R);
    note('blade', s.stick.blade);
    note('shaftTilt', s.stick.tilt);
    note('shaftTorso', s.stick.torso);
    note('crouch', r3(s.pose.crouch));
    note('freeHand', r3(s.pose.freeHand));
  }
  return { frames: track.length, issues, pops, ranges };
}

const pad = (v: string | number, n: number) => String(v).padStart(n);
/** Markdown report an LLM or a person can act on without opening the images. */
export function reportText(opts: {
  clip: { id: string; label: string; duration: number; look: string; group: string };
  samples: LabSample[];
  analysis: Analysis;
  files: string[];
  cameras: string[];
  travel: boolean;
}) {
  const { clip, analysis, samples, files, cameras } = opts;
  const track = [...samples].sort((a, b) => a.frame - b.frame);
  const lines = [
    `# ${clip.label} (\`${clip.id}\`)`,
    '',
    `${clip.group} · ${clip.duration.toFixed(2)} s · ${analysis.frames} frames at 60 Hz · cameras ${cameras.join(', ')}${opts.travel ? ' · travelling' : ' · in place'}`,
    '',
    `**Looks right when:** ${clip.look}`,
    '',
    "Frame: skater space in metres, x to the skater's left, y up, z ahead. Left side is drawn cyan, right side orange. L is the bottom hand, R the top hand (left-shot).",
    '',
    `## Issues (${analysis.issues.length})`,
  ];
  if (!analysis.issues.length) lines.push('None past the limits.');
  for (const i of analysis.issues)
    lines.push(
      `- ${i.from.toFixed(2)}–${i.to.toFixed(2)} s · ${i.where}: ${ISSUE_TEXT[i.kind]}, worst ${i.worst} at ${i.at.toFixed(2)} s (limit ${i.limit})`,
    );
  lines.push('', `## Pops (${analysis.pops.length})`);
  if (!analysis.pops.length) lines.push('No one-frame jumps.');
  for (const p of analysis.pops)
    lines.push(
      `- ${p.at.toFixed(3)} s · ${p.joint} jumped ${p.cm} cm in one frame (neighbours ~${p.around} cm)`,
    );
  lines.push('', '## Ranges', '', '| metric | min | max |', '|---|---|---|');
  for (const [k, [lo, hi]] of Object.entries(analysis.ranges))
    lines.push(`| ${k} | ${lo} | ${hi} |`);
  lines.push(
    '',
    '## Timeline',
    '',
    'Angles in degrees (flexion, 0 = straight); grip = palm to shaft (cm); lift = ankle over planted (cm); blade = hosel height (cm).',
    '',
    '```',
    '     t  knee L/R   hip L/R   elbow L/R  wrist L/R  torso p/r/tw     grip L/R   lift L/R  blade crouch free  issues',
  );
  const every = Math.max(1, Math.round(track.length / 24));
  track.forEach((s, n) => {
    if (n % every && n !== track.length - 1 && !s.issues.length) return;
    const a = s.angles;
    lines.push(
      [
        pad(s.t.toFixed(2), 6),
        `${pad(a.kneeL.toFixed(0), 4)}/${pad(a.kneeR.toFixed(0), 3)}`,
        `${pad(a.hipL.toFixed(0), 5)}/${pad(a.hipR.toFixed(0), 3)}`,
        `${pad(a.elbowL.toFixed(0), 6)}/${pad(a.elbowR.toFixed(0), 3)}`,
        `${pad(a.wristL.toFixed(0), 6)}/${pad(a.wristR.toFixed(0), 3)}`,
        `${pad(a.torsoPitch.toFixed(0), 5)}/${pad(a.torsoRoll.toFixed(0), 3)}/${pad(a.torsoTwist.toFixed(0), 3)}`,
        `${pad(s.grip.L, 8)}/${pad(s.grip.R, 4)}`,
        `${pad(s.lift.L, 6)}/${pad(s.lift.R, 4)}`,
        pad(s.stick.blade, 6),
        pad(s.pose.crouch.toFixed(2), 6),
        pad(s.pose.freeHand.toFixed(2), 5),
        ` ${s.pose.ragdoll ? 'ragdoll ' : ''}${s.issues.map((i) => `${i.where} ${ISSUE_TEXT[i.kind]}`).join('; ')}`,
      ].join(''),
    );
  });
  lines.push('```', '', '## Files', '', ...files.map((f) => `- ${f}`), '');
  return lines.join('\n');
}
