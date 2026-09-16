import { RULES } from '../game/config';
import type { MatchState } from '../game/types';
import { blendSnapshots, poseSnapshot, snapshotTick, type Snapshot } from './snapshot';

/**
 * What the guest draws, and when.
 *
 * What the host says arrives in bursts and gaps, never at the steady rate it was sent, and far
 * less often than the guest draws. Drawing the newest snapshot as it lands makes the match
 * stutter at the packet rate, with every late packet a visible hitch. So the guest does not
 * draw the newest thing it has heard. It keeps a short buffer and draws a moment slightly behind
 * the newest snapshot, blending between the two either side of that moment along the host's own
 * timeline of simulation steps. Every frame drawn is then a fresh pose, and a packet that turns
 * up a little late has already been allowed for.
 *
 * The moment runs at real time. When it drifts from where it should sit behind the newest
 * snapshot it speeds up or slows down slightly, and only jumps when far off, so the eye never
 * sees the correction.
 */

/** Snapshots a second. The watcher blends between them, so this sets how far behind it draws. */
export const SNAPSHOT_HZ = 60;
/** Simulation steps a second, which is the unit the host's timeline is kept in. */
const STEPS_PER_SECOND = 1 / RULES.fixedStep;
const STEPS_PER_SNAPSHOT = STEPS_PER_SECOND / SNAPSHOT_HZ;
/**
 * How far behind the newest snapshot the guest draws, in simulation steps. Two snapshots'
 * worth is the least that keeps a pair to blend between; it grows when packets arrive late
 * enough to run the buffer dry, and eases back down while they do not.
 */
export const DELAY_MIN = 2 * STEPS_PER_SNAPSHOT;
export const DELAY_START = 3 * STEPS_PER_SNAPSHOT;
export const DELAY_MAX = 0.25 * STEPS_PER_SECOND;
/** Steps the buffer grows by each time it runs dry, and shrinks by each second it does not. */
const DELAY_GROW = STEPS_PER_SNAPSHOT;
const DELAY_EASE = 0.5;
/** Further off than this and the view jumps to where it should be rather than racing there. */
const RESYNC_STEPS = 0.5 * STEPS_PER_SECOND;
/** Snapshots kept before the oldest are dropped, if the view somehow stops consuming them. */
const BUFFER_MAX = 2 * SNAPSHOT_HZ;
/**
 * A tick this far behind the newest is not a packet that overtook another, which is only ever a
 * few steps: the host started over.
 */
const REWIND_STEPS = 1 * STEPS_PER_SECOND;

/** A snapshot as it landed, with where it sits on the host's timeline. */
interface Arrival {
  snap: Snapshot;
  tick: number;
}

export class SnapshotView {
  /** How far behind the newest snapshot the view is drawing, in milliseconds. */
  delayMs = 0;
  /** Times the view caught up with the newest snapshot and had to wait for the next. */
  starved = 0;

  /** What the host has said, oldest first, from the one being drawn onward. */
  private buffer: Arrival[] = [];
  /** The moment being drawn, on the host's timeline. Negative until the first snapshot. */
  private renderTick = -1;
  private delay = DELAY_START;
  /** Snapshots whose calls have been handed to the scene. */
  private reached = 0;
  /** The tick before the newest one heard, which tells a stalled host from a late packet. */
  private previousTick = -1;
  /** Whether the view is sitting on the newest snapshot with nothing to draw toward. */
  private waiting = false;
  private blended: Snapshot | null = null;

  /** Where the view is drawing on the host's timeline, for tests and readouts. */
  get tick() {
    return this.renderTick;
  }
  get buffered() {
    return this.buffer.length;
  }

  /** A new match is a new timeline: nothing heard about the old one applies to it. */
  reset() {
    this.buffer = [];
    this.renderTick = -1;
    this.reached = 0;
    this.previousTick = -1;
    this.waiting = false;
    this.delay = DELAY_START;
    this.starved = 0;
  }

  push(snap: Snapshot) {
    const tick = snapshotTick(snap);
    // The host's timeline only runs forward. A little way back is a packet that was overtaken,
    // and is stale; a long way back means the host started a new match.
    const newest = this.buffer.at(-1);
    if (newest && tick < newest.tick) {
      if (newest.tick - tick < REWIND_STEPS) return;
      this.buffer = [];
      this.renderTick = -1;
      this.reached = 0;
      this.previousTick = -1;
    } else this.previousTick = newest?.tick ?? -1;
    this.buffer.push({ snap, tick });
    if (this.buffer.length > BUFFER_MAX) {
      const dropped = this.buffer.length - BUFFER_MAX;
      this.buffer.splice(0, dropped);
      this.reached = Math.max(0, this.reached - dropped);
      this.renderTick = -1;
    }
  }

  /**
   * Pose the match on the moment being drawn, `delta` seconds after the last one. The match
   * takes the calls of every snapshot the moment has passed, once each. True when any were new.
   */
  pose(s: MatchState, delta: number): boolean {
    const buffer = this.buffer;
    if (!buffer.length) return false;
    const last = buffer[buffer.length - 1];
    const newest = last.tick;
    const target = newest - this.delay;
    let starved = false;
    if (this.renderTick < 0) this.renderTick = target;
    else {
      // Behind by a little: hurry. Ahead by a little: linger. Far off: jump.
      const error = target - this.renderTick;
      if (Math.abs(error) > RESYNC_STEPS) this.renderTick = target;
      else {
        const rate = Math.max(0.85, Math.min(1.3, 1 + error * 0.03));
        this.renderTick += delta * STEPS_PER_SECOND * rate;
      }
      if (this.renderTick > newest) {
        // Nothing newer to draw toward. Hold the newest, and keep more in hand next time. A
        // host whose clock has stopped, between periods, is not late: only a moving one counts,
        // and only once per wait however many frames it lasts.
        starved = !this.waiting && newest > this.previousTick;
        this.waiting = true;
        this.renderTick = newest;
      } else this.waiting = false;
    }
    if (starved) {
      this.starved++;
      this.delay = Math.min(DELAY_MAX, this.delay + DELAY_GROW);
    } else this.delay = Math.max(DELAY_MIN, this.delay - DELAY_EASE * delta);
    this.delayMs = Math.round((this.delay / STEPS_PER_SECOND) * 1000);

    // The pair either side of the moment. Everything before it is finished with.
    let i = 0;
    while (i + 1 < buffer.length && buffer[i + 1].tick <= this.renderTick) i++;
    if (i > 0) {
      buffer.splice(0, i);
      this.reached = Math.max(0, this.reached - i);
    }
    const a = buffer[0],
      b = buffer[1] as Arrival | undefined;
    // A snapshot's calls are handed over the moment the view reaches it.
    const events = [];
    let fresh = false;
    while (this.reached < buffer.length && buffer[this.reached].tick <= this.renderTick) {
      events.push(...buffer[this.reached].snap.events);
      this.reached++;
      fresh = true;
    }
    if (b && b.tick > a.tick && this.renderTick > a.tick) {
      const t = (this.renderTick - a.tick) / (b.tick - a.tick);
      const span = (b.tick - a.tick) / STEPS_PER_SECOND;
      this.blended = blendSnapshots(a.snap, b.snap, t, span, this.blended ?? undefined);
      poseSnapshot(s, this.blended);
    } else poseSnapshot(s, a.snap);
    s.events = events;
    return fresh;
  }
}
