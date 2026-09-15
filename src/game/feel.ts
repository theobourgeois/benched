import { useSyncExternalStore } from 'react';
import { clamp } from './math';
import { DEFAULT_PHYSICS, DEFAULT_STICK, PHYSICS, STICK } from './config';

export type FeelGroupId = 'skate' | 'hit' | 'stick' | 'puck' | 'shot';
type PhysicsKey = keyof typeof PHYSICS;
type StickKey = keyof typeof STICK;

export type FeelParam = {
  group: FeelGroupId;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  meaning: string;
  higher: string;
  lower: string;
} & ({ table: 'physics'; key: PhysicsKey } | { table: 'stick'; key: StickKey });

export const FEEL_GROUPS: { id: FeelGroupId; label: string; tryThis: string }[] = [
  {
    id: 'skate',
    label: 'Skating',
    tryThis: 'Build to top speed, cut 90°, plant a stop, then hustle with and without the puck.',
  },
  {
    id: 'hit',
    label: 'Hitting',
    tryThis: 'Throw a loaded shoulder, a tap, then skate through someone without flicking.',
  },
  {
    id: 'stick',
    label: 'Deking',
    tryThis: 'Toe-drag at pace, then flick a deke and feel whether the body follows the puck.',
  },
  {
    id: 'puck',
    label: 'Possession',
    tryThis: 'Pick up a loose puck, poke from a stride, then try a stick lift on a carrier.',
  },
  {
    id: 'shot',
    label: 'Puck movement',
    tryThis: 'Wrist, slap, saucer, dump, and a dive on a loose puck.',
  },
];

const p = (
  group: FeelGroupId,
  key: PhysicsKey,
  label: string,
  min: number,
  max: number,
  step: number,
  meaning: string,
  higher: string,
  lower: string,
  unit?: string,
): FeelParam => ({
  table: 'physics',
  group,
  key,
  label,
  min,
  max,
  step,
  meaning,
  higher,
  lower,
  unit,
});

const s = (
  group: FeelGroupId,
  key: StickKey,
  label: string,
  min: number,
  max: number,
  step: number,
  meaning: string,
  higher: string,
  lower: string,
  unit?: string,
): FeelParam => ({
  table: 'stick',
  group,
  key,
  label,
  min,
  max,
  step,
  meaning,
  higher,
  lower,
  unit,
});

export const FEEL_PARAMS: FeelParam[] = [
  p(
    'skate',
    'maxSpeed',
    'Cruise speed',
    6,
    16,
    0.1,
    'Top speed without hustle. The pace you live at.',
    'the ice feels faster, more NHL',
    'everyone feels heavy, more beer-league',
    'm/s',
  ),
  p(
    'skate',
    'hustleSpeed',
    'Hustle speed',
    7,
    18,
    0.1,
    'Sprint ceiling after you have already built pace.',
    'chasers can run people down',
    'hustle barely outruns a cruise',
    'm/s',
  ),
  p(
    'skate',
    'skateAcceleration',
    'First stride',
    4,
    28,
    0.5,
    'Forward punch. Hustle does not make this faster.',
    'explosive first three steps',
    'sluggish get-up, more glide than push',
    'm/s²',
  ),
  p(
    'skate',
    'autoSkatePush',
    'Switch push',
    1,
    2.2,
    0.05,
    'First-stride multiplier after a defensive switch while the left stick is quiet.',
    'the new skater jumps at the play',
    'they keep their old pace',
  ),
  p(
    'skate',
    'edgeAcceleration',
    'Edge bite',
    8,
    48,
    0.5,
    'How hard you can redirect velocity. Pace widens the turning circle.',
    'tight, grabby turns at speed',
    'long, floaty turning circles',
    'm/s²',
  ),
  p(
    'skate',
    'carveBleed',
    'Carve bleed',
    0,
    0.6,
    0.01,
    'Speed you spend loading an edge through a tight turn.',
    'cuts feel costly and committed',
    'you can cut without losing pace',
  ),
  p(
    'skate',
    'pivotRate',
    'Pivot rate',
    4,
    28,
    0.5,
    'How fast the blades realign at low speed, independent of the torso.',
    'snappy pivots and Mohawks',
    'the feet lag behind the stick',
  ),
  p(
    'skate',
    'stopDeceleration',
    'Hockey stop',
    6,
    40,
    0.5,
    'A planted stop sheds metres per second, not a velocity multiply.',
    'you can dump speed in a few metres',
    'it takes a rink to stop',
    'm/s²',
  ),
  p(
    'skate',
    'stopAlign',
    'Stop threshold',
    -1,
    0,
    0.02,
    'How opposite the stick must be before a hockey stop plants.',
    'easier to trigger a stop',
    'you carve around instead of planting',
  ),
  p(
    'skate',
    'coastDrag',
    'Coast drag',
    0,
    1.2,
    0.02,
    'How fast you bleed speed with no input.',
    'ice feels sticky, you have to keep pushing',
    'you glide forever, more pond hockey',
  ),
  p(
    'skate',
    'edgeGrip',
    'Edge grip',
    4,
    28,
    0.5,
    'Baseline blade grip. Dekes and stick speed can sap this.',
    'edges hold; less sliding out',
    'slippery, you wash out of cuts',
  ),
  p(
    'skate',
    'dekeGrip',
    'Deke grip',
    2,
    20,
    0.5,
    'Edge grip while the puck is out on a deke.',
    'dekes stay planted',
    'dekes feel loose and slidey',
  ),
  p(
    'skate',
    'backskateSpeed',
    'Backskate speed',
    0.3,
    1,
    0.02,
    'Fraction of cruise speed while backwards.',
    'you can retreat at almost full pace',
    'backskating is a crawl',
  ),
  p(
    'skate',
    'hustleDrain',
    'Hustle drain',
    0,
    0.6,
    0.02,
    'Stamina spent while the extra pace is actually on.',
    'sprints are short bursts',
    'you can hustle all shift',
  ),
  p(
    'skate',
    'staminaRecover',
    'Stamina recover',
    0,
    0.5,
    0.01,
    'How fast the tank fills when you are not sprinting.',
    'you are ready to go again quickly',
    'one sprint and you are cooked',
  ),
  p(
    'skate',
    'carrySpeed',
    'Carry speed',
    0.8,
    1,
    0.005,
    'Cruise penalty with the puck, so a chaser can close but not walk you down.',
    'carriers feel slower, easier to catch',
    'nobody loses a step with the puck',
  ),
  p(
    'skate',
    'carryHustle',
    'Carry hustle',
    0.7,
    1,
    0.005,
    'Hustle penalty with the puck. A chasing defender should be able to run a carrier down.',
    'puck-carriers get run down',
    'you can still pull away with the puck',
  ),

  p(
    'hit',
    'checkLunge',
    'Check lunge',
    0,
    6,
    0.1,
    'Speed a committed check adds at the flick, before loading.',
    'hits launch you into people',
    'checks are just skating into them',
    'm/s',
  ),
  p(
    'hit',
    'checkLoadLunge',
    'Load lunge',
    0,
    4,
    0.1,
    'Extra lunge from a fully pulled-back check.',
    'loading the shoulder really commits you',
    'wind-up does not add much step',
    'm/s',
  ),
  p(
    'hit',
    'checkLungeCap',
    'Lunge cap',
    0.5,
    3,
    0.05,
    'How far above hustle speed a lunge is allowed to go.',
    'you can fly through the hit',
    'the lunge cannot outrun your stride',
    'm/s',
  ),
  p(
    'hit',
    'checkWindow',
    'Check window',
    0.15,
    1,
    0.01,
    'How long a committed check is live from the flick.',
    'long, floaty follow-throughs',
    'you have to time the contact tight',
    's',
  ),
  p(
    'hit',
    'checkRecovery',
    'Follow-through',
    0.04,
    0.4,
    0.01,
    'The last part of the window is only a bump, not a hit.',
    'more of the animation is a real hit',
    'late contact is just a bump',
    's',
  ),
  p(
    'hit',
    'checkDrive',
    'Check drive',
    0,
    1,
    0.05,
    'How much the hitter’s own speed counts, not only closing speed.',
    'you can truck someone you catch from behind',
    'hits need a head-on collision to land',
  ),
  p(
    'hit',
    'checkShoulderDrive',
    'Shoulder drive',
    0,
    2.5,
    0.02,
    'Skating speed a live shoulder adds as hit power on side contact.',
    'drive-bys still finish people',
    'you have to square up for power',
  ),
  p(
    'hit',
    'checkReach',
    'Check reach',
    0,
    0.8,
    0.02,
    'Extra body reach while a check is live.',
    'you clip people from further out',
    'you have to be right on them',
    'm',
  ),
  p(
    'hit',
    'checkBuffer',
    'Check buffer',
    0,
    0.6,
    0.02,
    'A flick during cooldown is held this long and fires when it can.',
    'queued hits feel generous',
    'whiffed flicks are gone',
    's',
  ),
  p(
    'hit',
    'hitLockLead',
    'Aim lead',
    0,
    0.35,
    0.01,
    'Lead time for one-time aim assist at launch. The path cannot home after.',
    'you throw toward where they will be',
    'you have to aim at where they are',
    's',
  ),
  p(
    'hit',
    'checkCommit',
    'Commit power',
    0,
    4,
    0.05,
    'Flat power a committed check adds on top of closing momentum.',
    'even slow hits finish',
    'momentum has to do all the work',
  ),
  p(
    'hit',
    'checkLoadBonus',
    'Load bonus',
    0,
    3,
    0.05,
    'How much a fully loaded check scales that commitment.',
    'wind-ups feel like slap shots',
    'loading the shoulder is mostly for show',
  ),
  p(
    'hit',
    'checkStumble',
    'Stumble bar',
    2,
    12,
    0.1,
    'Closing power that staggers the victim and knocks the puck loose.',
    'people pop off the puck easier',
    'you need a real truck to knock it loose',
  ),
  p(
    'hit',
    'checkKnockdown',
    'Knockdown bar',
    4,
    16,
    0.1,
    'Closing power that puts the victim on the ice.',
    'big hits sit people down',
    'almost nobody goes down',
  ),
  p(
    'hit',
    'bumpKnockdown',
    'Bump knockdown',
    6,
    20,
    0.1,
    'Incidental collisions never exceed a stumble unless closing this hard.',
    'accidental run-ins can still deck someone',
    'only a committed check sits people down',
  ),
  p(
    'hit',
    'bumpStumble',
    'Bump stumble',
    3,
    14,
    0.1,
    'Incidental closing that staggers whoever was on their heels.',
    'traffic feels dangerous',
    'skating into people is a shrug',
  ),
  p(
    'hit',
    'checkBrace',
    'Brace',
    0.4,
    1.2,
    0.02,
    'Squaring up takes this much off a hit. It does not cancel it.',
    'facing up really soaks the blow',
    'bracing barely helps',
  ),
  p(
    'hit',
    'checkExposed',
    'Exposed',
    1,
    1.6,
    0.02,
    'A victim mid-deke or already off balance takes this much more.',
    'dekes are punishable',
    'you can deke through contact',
  ),
  p(
    'hit',
    'checkFromBehind',
    'From behind',
    0.4,
    1.2,
    0.02,
    'Reduce impact when the victim is skating away along the contact.',
    'chasing hits are weaker',
    'you can still destroy them from behind',
  ),
  p(
    'hit',
    'hitLockRange',
    'Lock range',
    1.5,
    8,
    0.1,
    'How far a committed check will pick a target.',
    'you can throw from further out',
    'you have to be in their kitchen',
    'm',
  ),
  p(
    'hit',
    'hitLockCone',
    'Lock cone',
    0.2,
    0.95,
    0.01,
    'How aimed the flick has to be. Higher is a tighter cone.',
    'you have to point right at them',
    'generous, almost auto-aims nearby bodies',
  ),
  p(
    'hit',
    'checkAimAssist',
    'Aim assist',
    0,
    0.8,
    0.01,
    'Maximum launch correction, in radians. No homing after.',
    'the flick steers onto them',
    'you own the angle',
    'rad',
  ),
  p(
    'hit',
    'checkStamina',
    'Check stamina',
    0,
    0.25,
    0.01,
    'Stamina a committed check costs. Loading costs a little more.',
    'throwing the body is expensive',
    'you can hit all shift',
  ),
  p(
    'hit',
    'hitstop',
    'Hitstop',
    0,
    0.25,
    0.01,
    'Freeze on a knockdown so the impact reads.',
    'big hits feel heavier',
    'they bounce off with no punctuation',
    's',
  ),

  s(
    'stick',
    'omega',
    'Puck weight',
    6,
    40,
    0.5,
    'Natural frequency of the puck follow. Lower feels heavier.',
    'the puck snaps to the blade',
    'the puck has mass, it trails the move',
  ),
  s(
    'stick',
    'zeta',
    'Follow-through',
    0.3,
    1.2,
    0.02,
    'Under 1 leaves follow-through instead of settling on the pose.',
    'the blade overshoots, more buttery',
    'it parks on the pose with no hang',
  ),
  s(
    'stick',
    'cut',
    'Deke cut',
    0,
    1.5,
    0.05,
    'How much blade speed pushes the skater sideways, like an edge cut.',
    'the body goes with the deke',
    'the puck moves, you stay put',
  ),
  s(
    'stick',
    'drift',
    'Off-center drift',
    0,
    2.5,
    0.05,
    'Extra edge while skating with the puck held wide.',
    'protecting the puck pulls you that way',
    'you can hold it out without drifting',
  ),

  p(
    'puck',
    'pickupRadius',
    'Pickup radius',
    0.4,
    1.6,
    0.02,
    'How close the blade has to be to take a loose puck.',
    'pucks magnet onto you',
    'you have to be on top of it',
    'm',
  ),
  p(
    'puck',
    'puckDrag',
    'Loose-puck drag',
    0,
    1.2,
    0.02,
    'How fast a free puck dies on the ice.',
    'dumps die, easier to retrieve',
    'the puck slides forever',
  ),
  p(
    'puck',
    'pokeReach',
    'Poke reach',
    0.3,
    1.2,
    0.02,
    'Blade must be this close to lift the puck on a poke.',
    'pokes steal from further out',
    'you have to nick the puck',
    'm',
  ),
  p(
    'puck',
    'pokeExtend',
    'Poke extend',
    0.1,
    0.8,
    0.02,
    'Stick jab length on a poke. Not a steal from across a body-length.',
    'the jab covers more ice',
    'it is a short stab',
    'm',
  ),
  p(
    'puck',
    'sweepReach',
    'Sweep reach',
    0.1,
    0.8,
    0.02,
    'Extra blade reach while holding a sweep poke.',
    'a held poke covers a lane',
    'sweep barely longer than a tap',
    'm',
  ),
  p(
    'puck',
    'liftRange',
    'Stick-lift range',
    0.6,
    2.5,
    0.02,
    'How close you have to be to lift a carrier’s stick.',
    'you can lift from a step away',
    'you have to be in their pocket',
    'm',
  ),

  p(
    'shot',
    'shotSpeed',
    'Shot speed',
    18,
    50,
    0.5,
    'Released shot velocity before the skater’s own pace stacks on.',
    'shots get on net in a hurry',
    'goalies have time to set',
    'm/s',
  ),
  p(
    'shot',
    'puckCarry',
    'Shooter carry',
    0,
    0.6,
    0.01,
    'Share of the skater’s pace a released puck keeps. Shots still land on the aim point.',
    'shots and passes take on your speed',
    'the puck leaves at stick speed only',
  ),
  p(
    'shot',
    'passSpeed',
    'Pass speed',
    10,
    36,
    0.5,
    'Tape-to-tape pass velocity.',
    'passes zip, harder to pick',
    'saucers and outlets hang in the air',
    'm/s',
  ),
  p(
    'shot',
    'passDump',
    'Dump distance',
    4,
    20,
    0.5,
    'How far a pass goes when nobody is in the aim cone.',
    'missed outlets become dumps',
    'they dribble into the slot',
    'm',
  ),
  p(
    'shot',
    'passAssist',
    'Pass cone',
    0.2,
    0.95,
    0.01,
    'How aimed you have to be to pick a teammate. Higher is tighter.',
    'you have to point right at them',
    'the outlet finds people for you',
  ),
  p(
    'shot',
    'chipSpeed',
    'Chip speed',
    8,
    28,
    0.5,
    'Chip / dump release speed, plus some of your skating speed.',
    'chips clear the zone',
    'chips die at their feet',
    'm/s',
  ),
  p(
    'shot',
    'chipLift',
    'Chip lift',
    0,
    8,
    0.1,
    'How much air a chip gets.',
    'you can chip it over sticks',
    'chips stay on the ice',
    'm/s',
  ),
  p(
    'shot',
    'saucerLift',
    'Saucer lift',
    0,
    10,
    0.1,
    'Lift on a tapped saucer pass.',
    'saucers hop sticks',
    'they roll along the ice',
    'm/s',
  ),
  p(
    'shot',
    'chopSpeed',
    'Chop speed',
    6,
    24,
    0.5,
    'Whack on a loose puck when you chip without possession.',
    'you can bang it out of a scrum',
    'chops barely move it',
    'm/s',
  ),
  p(
    'shot',
    'diveSpeed',
    'Dive speed',
    4,
    16,
    0.2,
    'Floor on dive slide speed.',
    'dives cover a lot of ice',
    'you flop in place',
    'm/s',
  ),
  p(
    'shot',
    'diveTime',
    'Dive time',
    0.3,
    1.4,
    0.02,
    'How long you are on your belly.',
    'long, committed slides',
    'you pop back up immediately',
    's',
  ),
];

const STORAGE_KEY = 'benched-feel-v1';
let revision = 0;
const listeners = new Set<() => void>();

const publishFeel = () => {
  revision++;
  listeners.forEach((fn) => fn());
};

export function feelValue(param: FeelParam) {
  return param.table === 'physics' ? PHYSICS[param.key] : STICK[param.key];
}

export function feelDefault(param: FeelParam) {
  return param.table === 'physics' ? DEFAULT_PHYSICS[param.key] : DEFAULT_STICK[param.key];
}

export function feelChanged(param: FeelParam) {
  return feelValue(param) !== feelDefault(param);
}

export function formatFeel(value: number, step: number) {
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(digits);
}

function persistFeel() {
  try {
    const physics: Partial<Record<PhysicsKey, number>> = {};
    const stick: Partial<Record<StickKey, number>> = {};
    for (const key of Object.keys(PHYSICS) as PhysicsKey[])
      if (PHYSICS[key] !== DEFAULT_PHYSICS[key]) physics[key] = PHYSICS[key];
    for (const key of Object.keys(STICK) as StickKey[])
      if (STICK[key] !== DEFAULT_STICK[key]) stick[key] = STICK[key];
    const empty = Object.keys(physics).length === 0 && Object.keys(stick).length === 0;
    if (empty) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ physics, stick }));
  } catch {
    /* private mode / tests */
  }
}

function applyRecord(target: Record<string, number>, source: unknown, allowed: Set<string>) {
  if (!source || typeof source !== 'object') return;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!allowed.has(key) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    target[key] = value;
  }
}

export function bootFeel() {
  if (import.meta.env.MODE === 'test') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { physics?: unknown; stick?: unknown };
    applyRecord(PHYSICS as Record<string, number>, parsed.physics, new Set(Object.keys(PHYSICS)));
    applyRecord(STICK as Record<string, number>, parsed.stick, new Set(Object.keys(STICK)));
  } catch {
    /* ignore bad payloads */
  }
}

export function setFeelParam(param: FeelParam, value: number) {
  if (!Number.isFinite(value)) return;
  const next = clamp(value, param.min, param.max);
  if (param.table === 'physics') PHYSICS[param.key] = next;
  else STICK[param.key] = next;
  persistFeel();
  publishFeel();
}

export function resetFeelParam(param: FeelParam) {
  setFeelParam(param, feelDefault(param));
}

export function resetFeelGroup(group: FeelGroupId) {
  for (const param of FEEL_PARAMS)
    if (param.group === group) {
      if (param.table === 'physics') PHYSICS[param.key] = DEFAULT_PHYSICS[param.key];
      else STICK[param.key] = DEFAULT_STICK[param.key];
    }
  persistFeel();
  publishFeel();
}

export function resetFeel() {
  Object.assign(PHYSICS, DEFAULT_PHYSICS);
  Object.assign(STICK, DEFAULT_STICK);
  persistFeel();
  publishFeel();
}

export function changedFeelParams() {
  return FEEL_PARAMS.filter(feelChanged);
}

export function copyFeelTweaks() {
  const changed = changedFeelParams();
  if (changed.length === 0) return '// No feel tweaks. Everything is at the shipped defaults.\n';
  const lines = ['// Feel tweaks — paste into src/game/config.ts', ''];
  for (const param of changed) {
    const table = param.table === 'physics' ? 'PHYSICS' : 'STICK';
    lines.push(
      `${table}.${param.key} = ${formatFeel(feelValue(param), param.step)}; // default ${formatFeel(feelDefault(param), param.step)} · ${param.meaning}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function useFeel() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => revision,
  );
  return {
    changed: changedFeelParams().length,
  };
}
