import { clamp } from './math';
import type { GameEvent, MatchState, Phase, Puck, Skater, Team } from './types';

/** Snapshots per second; playback blends between neighbours, so slow motion stays smooth. */
export const REPLAY_HZ = 60;
/** Seconds of play kept for the instant replay. */
export const REPLAY_SECONDS = 20;
/** Instant replay opens this far back from the latest moment. */
export const INSTANT_LOOKBACK = 6;
export const REPLAY_SPEEDS = [0.25, 0.5, 1] as const;
/** Goal replay: the build-up at full speed, then the finish in slow motion. */
export const GOAL_REPLAY = {
  /** Live celebration before the replay rolls. Long enough to watch a celly. */
  celebrate: 5,
  before: 4,
  after: 0.9,
  /** Slow motion starts this long before the puck crosses the line. */
  slowFrom: 1.1,
  slowRate: 0.45,
};

export interface ReplayFrame {
  phase: Phase;
  controlled: number;
  shotCharge: number;
  shotLift: number;
  scoringTeam: Team | null;
  shootoutShooter: Team;
  skaters: Skater[];
  puck: Puck;
  /** Events emitted since the previous snapshot. */
  events: GameEvent[];
}

/** Rolling window of recent play. Cleared on a new match or period, where the ends switch. */
export class ReplayBuffer {
  private frames: ReplayFrame[] = [];
  private head = 0;
  private match: MatchState | null = null;
  private period = 0;
  private lastEvent = -1;
  constructor(readonly capacity = REPLAY_SECONDS * REPLAY_HZ) {}
  get length() {
    return this.frames.length;
  }
  clear() {
    this.frames = [];
    this.head = 0;
  }
  /** Snapshots the match; returns the frame so the scene can attach what it drew. */
  record(s: MatchState) {
    if (s !== this.match || s.period !== this.period) {
      this.clear();
      this.match = s;
      this.period = s.period;
      this.lastEvent = s.events.at(-1)?.id ?? -1;
    }
    const events = s.events.filter((e) => e.id > this.lastEvent).map((e) => ({ ...e }));
    this.lastEvent = s.events.at(-1)?.id ?? this.lastEvent;
    const frame: ReplayFrame = {
      phase: s.phase,
      controlled: s.controlled,
      shotCharge: s.shotCharge,
      shotLift: s.shotLift,
      scoringTeam: s.scoringTeam,
      shootoutShooter: s.shootoutShooter,
      skaters: s.skaters.map((p) => ({
        ...p,
        queuedCheck: p.queuedCheck && { ...p.queuedCheck },
        pendingShot: p.pendingShot ? { ...p.pendingShot } : null,
      })),
      puck: { ...s.puck },
      events,
    };
    if (this.frames.length < this.capacity) this.frames.push(frame);
    else {
      this.frames[this.head] = frame;
      this.head = (this.head + 1) % this.capacity;
    }
    return frame;
  }
  /** Recorded frames, oldest first. */
  snapshot(): ReplayFrame[] {
    return [...this.frames.slice(this.head), ...this.frames.slice(0, this.head)];
  }
}

export type ReplayKind = 'goal' | 'instant';
export type ReplayCameraMode = 'puck' | 'free' | 'broadcast' | 'cinematic';
export const REPLAY_CAMERAS: { mode: ReplayCameraMode; label: string }[] = [
  { mode: 'puck', label: 'Puck cam' },
  { mode: 'free', label: 'Free cam' },
  { mode: 'broadcast', label: 'Broadcast' },
];

export interface ReplayCamera {
  mode: ReplayCameraMode;
  yaw: number;
  pitch: number;
  distance: number;
  focus: { x: number; y: number; z: number };
  /** False until the orbit is adopted from wherever the camera is, so switching never jumps. */
  seeded: boolean;
  /** Stick and key rates for this frame, −1 to 1. */
  input: { orbitX: number; orbitY: number; moveX: number; moveZ: number; zoom: number };
  /** Pointer movement in pixels and wheel delta since the camera last ran. */
  drag: { x: number; y: number; panX: number; panY: number; wheel: number };
  /** Current cinematic shot; a new one is a hard cut. */
  shot: string;
}

export interface ReplaySession {
  kind: ReplayKind;
  frames: ReplayFrame[];
  /** Playback window, in seconds from the first frame. */
  start: number;
  end: number;
  time: number;
  playing: boolean;
  speed: number;
  /** Signed playback rate on the last advance; 0 while held still. */
  rate: number;
  /** What the renderer draws: a match-shaped copy posed from the frames. */
  view: MatchState;
  goal: { time: number; team: Team; scorer: number | null } | null;
  camera: ReplayCamera;
  eventId: number;
}

const ANGLES = new Set(['angle', 'fallAngle', 'stride']);
/** A move this far between snapshots is a reset (faceoff, shootout attempt), not motion. */
const TELEPORT = 4;
type Fields = Record<string, unknown>;
function wrap(a: number) {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}
function blend<T extends object>(out: T, a: T, b: T, t: number) {
  const o = out as Fields,
    x = a as Fields,
    y = b as Fields;
  const jump =
    Math.hypot((y.x as number) - (x.x as number), (y.z as number) - (x.z as number)) > TELEPORT;
  const mix = jump ? Math.round(t) : t;
  const near = mix < 0.5 ? x : y;
  for (const key of Object.keys(x)) {
    const from = x[key],
      to = y[key];
    if (typeof from === 'number' && typeof to === 'number')
      o[key] = ANGLES.has(key) ? from + wrap(to - from) * mix : from + (to - from) * mix;
    else o[key] = near[key];
  }
}

export function createView(match: MatchState): MatchState {
  return {
    ...match,
    skaters: match.skaters.map((p) => ({ ...p })),
    puck: { ...match.puck },
    events: [],
    passHeld: false,
  };
}

/** Poses the view at a moment on the timeline, blending the snapshots either side of it. */
export function sampleReplay(view: MatchState, frames: ReplayFrame[], time: number) {
  const f = clamp(time * REPLAY_HZ, 0, frames.length - 1);
  const i = Math.floor(f),
    t = f - i;
  const a = frames[i],
    b = frames[Math.min(i + 1, frames.length - 1)],
    near = t < 0.5 ? a : b;
  view.phase = near.phase;
  view.controlled = near.controlled;
  view.scoringTeam = near.scoringTeam;
  view.shootoutShooter = near.shootoutShooter;
  view.shotCharge = a.shotCharge + (b.shotCharge - a.shotCharge) * t;
  view.shotLift = a.shotLift + (b.shotLift - a.shotLift) * t;
  view.skaters.forEach((p, k) => {
    const from = a.skaters[k],
      to = b.skaters[k];
    blend(p, from, to, t);
    // A newly triggered action starts at its recorded contact, never halfway through a clip
    // in the frame before release. Its sockets and duration are discrete event metadata.
    const action = to.shotTimer > from.shotTimer && t < 1 ? from : near.skaters[k];
    p.shotStyle = action.shotStyle;
    p.shotDuration = action.shotDuration;
    p.shotSide = action.shotSide;
    p.shotReach = action.shotReach;
    p.shotLoad = action.shotLoad;
    if (to.shotTimer > from.shotTimer && t < 1) p.shotTimer = from.shotTimer;
    if (to.checkTimer > from.checkTimer && t < 1) p.checkTimer = from.checkTimer;
    if ((to.saveTimer ?? 0) > (from.saveTimer ?? 0) && t < 1) {
      p.saveTimer = from.saveTimer;
      p.saveSide = from.saveSide;
      p.saveHeight = from.saveHeight;
    }
    if (k === view.controlled && !from.pendingShot && to.pendingShot && t < 1)
      view.shotCharge = a.shotCharge;
    if (from.pendingShot && to.pendingShot && from.pendingShot.tick === to.pendingShot.tick) {
      p.pendingShot = {
        ...from.pendingShot,
        timer: from.pendingShot.timer + (to.pendingShot.timer - from.pendingShot.timer) * t,
      };
    } else if (t < 1) {
      p.pendingShot = from.pendingShot
        ? { ...from.pendingShot, timer: Math.max(0, from.pendingShot.timer - t / REPLAY_HZ) }
        : null;
    }
  });
  blend(view.puck, a.puck, b.puck, t);
}

/** Events from snapshots passed while playing forward from one moment to the next. */
export function eventsBetween(frames: ReplayFrame[], from: number, to: number) {
  const first = Math.floor(from * REPLAY_HZ) + 1,
    last = Math.min(Math.floor(to * REPLAY_HZ), frames.length - 1);
  const events: GameEvent[] = [];
  for (let i = Math.max(0, first); i <= last; i++) events.push(...frames[i].events);
  return events;
}

/** The latest goal in the frames, with the skater who last carried it for the scoring side. */
export function findGoal(frames: ReplayFrame[]) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (!frame.events.some((e) => e.type === 'goal') || frame.scoringTeam === null) continue;
    const team = frame.scoringTeam;
    let scorer: number | null = null;
    for (let j = i; j >= Math.max(0, i - GOAL_REPLAY.before * REPLAY_HZ); j--) {
      const owner = frames[j].puck.owner;
      if (owner !== null && frames[j].skaters[owner].team === team) {
        scorer = owner;
        break;
      }
    }
    return { time: i / REPLAY_HZ, team, scorer };
  }
  return null;
}

function newCamera(mode: ReplayCameraMode): ReplayCamera {
  return {
    mode,
    yaw: 0,
    pitch: 0.6,
    distance: 18,
    focus: { x: 0, y: 0.5, z: 0 },
    seeded: false,
    input: { orbitX: 0, orbitY: 0, moveX: 0, moveZ: 0, zoom: 0 },
    drag: { x: 0, y: 0, panX: 0, panY: 0, wheel: 0 },
    shot: '',
  };
}

export function startReplay(
  match: MatchState,
  frames: ReplayFrame[],
  kind: ReplayKind,
): ReplaySession | null {
  if (frames.length < 2) return null;
  const last = (frames.length - 1) / REPLAY_HZ;
  const goal = kind === 'goal' ? findGoal(frames) : null;
  if (kind === 'goal' && !goal) return null;
  const start = goal ? Math.max(0, goal.time - GOAL_REPLAY.before) : 0;
  const end = goal ? Math.min(last, goal.time + GOAL_REPLAY.after) : last;
  const session: ReplaySession = {
    kind,
    frames,
    start,
    end,
    time: goal ? start : Math.max(0, last - INSTANT_LOOKBACK),
    // Instant replays open held, so the camera can be lined up before anything moves.
    playing: kind === 'goal',
    speed: 1,
    rate: 0,
    view: createView(match),
    goal,
    camera: newCamera(goal ? 'cinematic' : 'puck'),
    eventId: 0,
  };
  sampleReplay(session.view, frames, session.time);
  return session;
}

/** Goal replays run the build-up at full speed and ease into slow motion for the finish. */
export function goalReplayRate(r: ReplaySession) {
  if (!r.goal) return r.speed;
  const t = r.time - r.goal.time + GOAL_REPLAY.slowFrom;
  const k = clamp((t + 0.3) / 0.35, 0, 1);
  return 1 + (GOAL_REPLAY.slowRate - 1) * k * k * (3 - 2 * k);
}

/**
 * Moves the playhead. `scrub` (−1 to 1, from the triggers) overrides the transport and runs up
 * to 2× either way. Returns events crossed while moving forward, and whether a goal replay ended.
 */
export function advanceReplay(r: ReplaySession, dt: number, scrub = 0) {
  const rate =
    scrub !== 0 ? scrub * 2 : !r.playing ? 0 : r.kind === 'goal' ? goalReplayRate(r) : r.speed;
  const before = r.time;
  r.time = clamp(before + dt * rate, r.start, r.end);
  r.rate = dt > 0 ? (r.time - before) / dt : 0;
  const events = r.time > before ? eventsBetween(r.frames, before, r.time) : [];
  if (r.kind === 'instant' && r.time >= r.end && scrub === 0) r.playing = false;
  sampleReplay(r.view, r.frames, r.time);
  pushViewEvents(r, events);
  return { events, finished: r.kind === 'goal' && r.time >= r.end };
}

/** Jumps the playhead without replaying the events in between. */
export function seekReplay(r: ReplaySession, time: number) {
  r.time = clamp(time, r.start, r.end);
  r.rate = 0;
  sampleReplay(r.view, r.frames, r.time);
}

export function stepReplay(r: ReplaySession, frames: number) {
  r.playing = false;
  seekReplay(r, r.time + frames / REPLAY_HZ);
}

export function toggleReplayPlayback(r: ReplaySession) {
  if (!r.playing && r.time >= r.end) seekReplay(r, r.start);
  r.playing = !r.playing;
}

export function shiftReplaySpeed(r: ReplaySession, direction: number) {
  const index = REPLAY_SPEEDS.indexOf(r.speed as (typeof REPLAY_SPEEDS)[number]);
  r.speed = REPLAY_SPEEDS[clamp(index + direction, 0, REPLAY_SPEEDS.length - 1)];
}

export function setReplayCamera(r: ReplaySession, mode: ReplayCameraMode) {
  if (r.camera.mode === mode) return;
  // Orbit cameras pick up from the current shot; puck and free share one orbit.
  if (mode === 'puck' || mode === 'free') {
    if (r.camera.mode !== 'puck' && r.camera.mode !== 'free') r.camera.seeded = false;
  }
  r.camera.mode = mode;
}

export function cycleReplayCamera(r: ReplaySession) {
  const index = REPLAY_CAMERAS.findIndex((c) => c.mode === r.camera.mode);
  setReplayCamera(r, REPLAY_CAMERAS[(index + 1) % REPLAY_CAMERAS.length].mode);
}

/** Replayed hits and shots feed the view's event list, so ice spray bursts again on replay. */
function pushViewEvents(r: ReplaySession, events: GameEvent[]) {
  for (const e of events) r.view.events.push({ ...e, id: ++r.eventId });
  if (r.view.events.length > 32) r.view.events.splice(0, r.view.events.length - 32);
}
