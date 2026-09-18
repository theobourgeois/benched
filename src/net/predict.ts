import { RULES } from '../game/config';
import { predictSkater } from '../game/engine';
import { createHuman } from '../game/humans';
import type { InputFrame, MatchState, Skater, Team } from '../game/types';
import { INPUT_HZ } from './input';
import {
  poseSkater,
  snapshotHitstop,
  snapshotHuman,
  snapshotPhase,
  snapshotPuckOwner,
  STAMP_WRAP,
  type Snapshot,
} from './snapshot';

/**
 * Where the guest's own skater is, before the host says.
 *
 * Everything the guest draws is the host's word, and that word is a round trip plus the view's
 * buffer old by the time it lands. For everyone else on the ice that is fine: it is smooth, and
 * nobody can tell. For the skater in the guest's own hands it is the whole feel of the game:
 * every push arrives late. So the guest keeps the presses it has sent that the host has not yet
 * answered, and each frame runs its own skater forward from the host's newest word through
 * those presses. That is the same skating model the host will run with the same inputs, so it
 * lands where the host does; and it responds the moment the stick moves.
 *
 * Only skating and the stick are guessed. Contact, the puck, shots and calls stay the host's:
 * a guess about those would be wrong often enough to be worse than late. When the host's word
 * disagrees with the guess, from a hit, a collision or a dropped frame, the difference is
 * folded into an offset that melts away over a few frames, so it reads as a nudge, not a pop.
 * The same offset carries the skater through the guess switching off and on, at a freeze, a
 * whistle or a change of skater, so nothing ever jumps back to where the host last drew it.
 */

/** Simulation steps one input frame stands for on the host. */
const STEPS_PER_INPUT = Math.max(1, Math.round(1 / RULES.fixedStep / INPUT_HZ));
/**
 * The furthest ahead the guess runs. Past this the line is bad enough that a late skater is
 * the honest picture; the presses beyond it are still sent, just not guessed at.
 */
const MAX_FRAMES = 15;
/** Frames kept while waiting for an answer, well past anything a live line needs. */
const SENT_MAX = 120;
/** How quickly a correction melts: about a tenth of a second to mostly gone. */
const CORRECTION_TAU = 0.05;
/** A correction this large is a teleport, not a disagreement; it is shown at once. */
const SNAP_DISTANCE = 2;
/** An offset smaller than this has melted. */
const SETTLED = 0.002;

/** What the guess writes back onto the drawn skater; the rest stays the host's. */
const PREDICTED: readonly (keyof Skater)[] = [
  'x',
  'z',
  'vx',
  'vz',
  'angle',
  'stride',
  'skateDrive',
  'edgeLean',
  'rush',
  'stickSide',
  'stickReach',
  'stickSideVel',
  'stickReachVel',
];

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Pose {
  x: number;
  z: number;
  angle: number;
}
/** A skater still easing from where the guess last drew it to where the host has it. */
interface Easing extends Pose {
  id: number;
}

export interface PredictStats {
  /** How far ahead of the host's newest word the own skater is drawn, in milliseconds. */
  aheadMs: number;
}

export class Predictor {
  readonly stats: PredictStats = { aheadMs: 0 };
  /**
   * Presses sent, oldest first, from the first one the last guess's snapshot had not stepped.
   * Ones a newer snapshot has since answered stay until the next guess, which needs them to run
   * the old snapshot forward on equal terms with the new one.
   */
  private sent: { stamp: number; frame: InputFrame }[] = [];
  /** The newest stamp the host has said it stepped. */
  private acked = -1;
  /** The snapshot the last guess ran from, to measure how far the newest moved it. */
  private base: Snapshot | null = null;
  private id = -1;
  private team: Team = 0;
  private ghost: Skater | null = null;
  private stale: Skater | null = null;
  private readonly human = createHuman(0);
  /** How far from the guess the skater is drawn, melting toward zero. */
  private readonly offset: Pose = { x: 0, z: 0, angle: 0 };
  /** Where the skater in hand was drawn last frame, or null if it was left to the host. */
  private drawn: Pose | null = null;
  /** A skater just let go of, still easing back onto the host's word. */
  private leaving: Easing | null = null;

  reset() {
    this.sent = [];
    this.acked = -1;
    this.base = null;
    this.id = -1;
    this.ghost = null;
    this.stale = null;
    this.drawn = null;
    this.leaving = null;
    this.zero();
  }

  /** A frame went out with this stamp. */
  record(stamp: number, frame: InputFrame) {
    this.sent.push({ stamp, frame });
    if (this.sent.length > SENT_MAX) this.sent.splice(0, this.sent.length - SENT_MAX);
  }

  /** The host has stepped everything up to and including this stamp. */
  acknowledge(echo: number) {
    this.acked = echo;
  }

  /** Frames sent that the host has not said it stepped. */
  get pending() {
    return this.sent.length - this.answered();
  }

  /**
   * After the view has posed the match, move this person's skater to where it will be. `current`
   * is what the stick is doing this very frame, not yet sent.
   */
  apply(
    s: MatchState,
    newest: Snapshot | null,
    current: InputFrame | null,
    team: Team,
    delta: number,
  ) {
    this.easeLeaving(s, delta);
    const seat = newest && snapshotHuman(newest, team, 0);
    const p = seat ? s.skaters[seat.controlled] : undefined;
    if (p && seat && seat.controlled !== this.id) {
      // A new skater in hand. The old one is left to the host, easing back onto its word; the
      // new one starts from the host's word with nothing owed.
      this.letGo(s);
      this.id = seat.controlled;
      this.team = team;
      this.ghost = null;
      this.stale = null;
    }
    // The host moves skaters through play and the celebration, and nowhere else: not at a
    // faceoff, not between periods, and not while a hit has frozen the frame.
    const phase = newest ? snapshotPhase(newest) : 'menu';
    const frozen = !!newest && snapshotHitstop(newest) > 0;
    const live = !!p && p.role !== 'G' && (phase === 'playing' || phase === 'goal') && !frozen;
    if (!live || !newest || !p) {
      if (p && newest && this.drawn) {
        // The skater was drawn ahead of the host. It eases back rather than jumping, and is let
        // go once it has arrived. When the host has stopped everyone, at a whistle or a frozen
        // frame, it eases onto the host's newest word: the view is still catching up to that
        // stop, and easing onto the view would slide back past it and forward again. A frozen
        // frame does not melt at all: the host is not moving the skater, so neither does the
        // guess, which picks up from here when the frame thaws. A skater the host is still
        // moving, a goalie in hand, eases against the view as it goes.
        const still = frozen || (phase !== 'playing' && phase !== 'goal');
        const onto = still ? this.stopped(newest, p) : p;
        this.owe(this.drawn, onto);
        if (!frozen) this.melt(delta);
        if (this.settled()) this.drawn = null;
        else {
          if (onto !== p) {
            p.x = onto.x;
            p.z = onto.z;
            p.angle = onto.angle;
          }
          this.place(s, p);
        }
      } else {
        this.zero();
        this.drawn = null;
      }
      this.base = null;
      this.stats.aheadMs = 0;
      return;
    }
    // Everything in hand is what the old snapshot had not stepped; the newest has answered the
    // first `answered` of them.
    const answered = this.answered();
    const frames = this.sent.map((f) => f.frame);
    if (current) frames.push(current);
    const now = (this.ghost = this.run(s, newest, this.ghost ?? { ...p }, frames.slice(answered)));
    if (this.base && this.base !== newest) {
      // Where the previous word put us with these same presses, against where the new one does:
      // that gap is the host disagreeing, and is smoothed rather than shown.
      const stale = (this.stale = this.run(s, this.base, this.stale ?? { ...p }, frames));
      this.offset.x += stale.x - now.x;
      this.offset.z += stale.z - now.z;
      this.offset.angle = wrapAngle(this.offset.angle + wrapAngle(stale.angle - now.angle));
      if (Math.hypot(this.offset.x, this.offset.z) > SNAP_DISTANCE) this.zero();
    } else if (!this.base && this.drawn) {
      // The guess is starting again on a skater still drawn where it was left: pick up from there.
      this.owe(this.drawn, now);
    }
    this.base = newest;
    if (answered) this.sent.splice(0, answered);
    this.melt(delta);

    const target = p as unknown as Record<string, unknown>;
    const source = now as unknown as Record<string, unknown>;
    for (const key of PREDICTED) target[key] = source[key];
    this.place(s, p);
    const steps = Math.min(frames.length - answered, MAX_FRAMES) * STEPS_PER_INPUT;
    this.stats.aheadMs = Math.round(steps * RULES.fixedStep * 1000);
  }

  /** How many frames at the front of `sent` the host has stepped, the clock's wrap allowed for. */
  private answered() {
    if (this.acked < 0) return 0;
    let n = 0;
    while (
      n < this.sent.length &&
      (this.acked - this.sent[n].stamp + STAMP_WRAP) % STAMP_WRAP < STAMP_WRAP / 2
    )
      n++;
    return n;
  }

  /** This person's skater as `snap` has it, run through `frames`. Writes into and returns `into`. */
  private run(s: MatchState, snap: Snapshot, into: Skater, frames: InputFrame[]): Skater {
    const id = this.id;
    poseSkater(into, snap, id);
    const seat = snapshotHuman(snap, this.team, 0);
    this.human.controlled = id;
    this.human.autoSkate = seat?.autoSkate ?? false;
    const carrying = snapshotPuckOwner(snap) === id;
    const from = Math.max(0, frames.length - MAX_FRAMES);
    for (let i = from; i < frames.length; i++)
      for (let k = 0; k < STEPS_PER_INPUT; k++)
        predictSkater(s, into, frames[i], this.human, RULES.fixedStep, carrying);
    return into;
  }

  /** Where the host's newest word has the skater in hand, while it is standing still. */
  private stopped(newest: Snapshot, p: Skater): Pose {
    const ghost = (this.ghost ??= { ...p });
    return poseSkater(ghost, newest, this.id) ? ghost : p;
  }

  /** Make the offset carry the skater from where it was drawn to `to`, unless that is a teleport. */
  private owe(from: Pose, to: Pose) {
    this.offset.x = from.x - to.x;
    this.offset.z = from.z - to.z;
    this.offset.angle = wrapAngle(from.angle - to.angle);
    if (Math.hypot(this.offset.x, this.offset.z) > SNAP_DISTANCE) this.zero();
  }

  private melt(delta: number) {
    const keep = Math.exp(-delta / CORRECTION_TAU);
    this.offset.x *= keep;
    this.offset.z *= keep;
    this.offset.angle *= keep;
    if (Math.hypot(this.offset.x, this.offset.z) < SETTLED && Math.abs(this.offset.angle) < SETTLED)
      this.zero();
  }

  private settled() {
    return this.offset.x === 0 && this.offset.z === 0 && this.offset.angle === 0;
  }

  /** Draw `p` offset from where it is, remember that, and keep a carried puck on its blade. */
  private place(s: MatchState, p: Skater) {
    p.x += this.offset.x;
    p.z += this.offset.z;
    p.angle += this.offset.angle;
    this.drawn = { x: p.x, z: p.z, angle: p.angle };
    if (s.puck.owner === p.id) ridePuck(s, p);
  }

  /** The skater in hand goes back to the host, easing from where it was drawn if that differs. */
  private letGo(s: MatchState) {
    const was = this.id >= 0 ? s.skaters[this.id] : undefined;
    if (was && this.drawn) {
      const x = this.drawn.x - was.x,
        z = this.drawn.z - was.z,
        angle = wrapAngle(this.drawn.angle - was.angle);
      this.leaving = Math.hypot(x, z) > SNAP_DISTANCE ? null : { id: was.id, x, z, angle };
    }
    this.drawn = null;
    this.base = null;
    this.zero();
  }

  private easeLeaving(s: MatchState, delta: number) {
    const e = this.leaving;
    if (!e) return;
    const keep = Math.exp(-delta / CORRECTION_TAU);
    e.x *= keep;
    e.z *= keep;
    e.angle *= keep;
    if (Math.hypot(e.x, e.z) < SETTLED && Math.abs(e.angle) < SETTLED) {
      this.leaving = null;
      return;
    }
    const p = s.skaters[e.id];
    if (!p) return;
    p.x += e.x;
    p.z += e.z;
    p.angle += e.angle;
    if (s.puck.owner === p.id) ridePuck(s, p);
  }

  private zero() {
    this.offset.x = 0;
    this.offset.z = 0;
    this.offset.angle = 0;
  }
}

/** A carried puck sits on the blade it is drawn with, as `advancePuck` puts it on the host. */
function ridePuck(s: MatchState, p: Skater) {
  const fx = Math.sin(p.angle),
    fz = Math.cos(p.angle);
  s.puck.x = p.x + fx * p.stickReach + fz * p.stickSide;
  s.puck.z = p.z + fz * p.stickReach - fx * p.stickSide;
  s.puck.vx = p.vx;
  s.puck.vz = p.vz;
}
