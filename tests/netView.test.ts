import { describe, expect, it } from 'vitest';
import { createMatch, startMatch, stepMatch } from '../src/game/engine';
import { EMPTY_INPUT, RULES } from '../src/game/config';
import { decodeSnapshot, encodeSnapshot } from '../src/net/snapshot';
import { DELAY_MAX, DELAY_MIN, SnapshotView, SNAPSHOT_HZ } from '../src/net/view';
import type { MatchState } from '../src/game/types';

/**
 * The guest draws a moment behind the newest snapshot, blended between the two around it. What
 * matters is that the moment moves every frame at real speed, that nothing the host said is
 * played twice or never, and that a late packet costs a little more buffer rather than a hitch.
 */

const STEPS_PER_SNAPSHOT = Math.round(1 / RULES.fixedStep / SNAPSHOT_HZ);

/** A host in the middle of a shift, with the puck carrier skating hard. */
function host() {
  const s = createMatch([0, 1]);
  startMatch(s);
  for (let i = 0; i < 4 / RULES.fixedStep; i++) stepMatch(s, [null, null], RULES.fixedStep);
  return s;
}
/** Advance the host one snapshot's worth and say what happened. */
function snapshotAfter(s: MatchState, sent: { event: number }, steps = STEPS_PER_SNAPSHOT) {
  for (let i = 0; i < steps; i++)
    stepMatch(s, [{ ...EMPTY_INPUT, moveX: 1, hustle: true }, null], RULES.fixedStep);
  const snap = decodeSnapshot(encodeSnapshot(s, sent.event));
  sent.event = s.events.at(-1)?.id ?? sent.event;
  return snap;
}
const puckAt = (s: MatchState) => ({ x: s.puck.x, z: s.puck.z });

describe('the guest view of a match', () => {
  it('draws something new every frame, not only when a snapshot lands', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    // A little buffered, then a frame rate well above the snapshot rate.
    for (let i = 0; i < 6; i++) view.push(snapshotAfter(h, sent));
    const frame = 1 / 150;
    const positions: string[] = [];
    let ticks: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Snapshots keep arriving at their own rate while frames are drawn faster.
      if (i % Math.round(150 / SNAPSHOT_HZ) === 0) view.push(snapshotAfter(h, sent));
      view.pose(guest, frame);
      const p = puckAt(guest);
      positions.push(`${p.x.toFixed(5)},${p.z.toFixed(5)}`);
      ticks.push(view.tick);
    }
    // Every frame is a fresh pose; nothing is drawn twice in a row.
    expect(new Set(positions).size).toBe(positions.length);
    // And the moment moves at real time: a frame is a frame's worth of steps, give or take the
    // small correction that keeps it in place behind the newest snapshot.
    ticks = ticks.slice(5);
    for (let i = 1; i < ticks.length; i++) {
      const stepped = ticks[i] - ticks[i - 1];
      expect(stepped).toBeGreaterThan((frame / RULES.fixedStep) * 0.8);
      expect(stepped).toBeLessThan((frame / RULES.fixedStep) * 1.35);
    }
  });

  it('hands over every call once, when the moment reaches it', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    h.events = [];
    const heard: number[] = [];
    let expected: number[] = [];
    for (let i = 0; i < 60; i++) {
      const snap = snapshotAfter(h, sent);
      // Plant a call in every third snapshot, as if the host had whistled.
      if (i % 3 === 0) snap.events.push({ id: 1000 + i, type: 'hit', power: 0.5 });
      expected = expected.concat(snap.events.map((e) => e.id));
      view.push(snap);
      view.pose(guest, 1 / SNAPSHOT_HZ);
      heard.push(...guest.events.map((e) => e.id));
    }
    // Drain what is still ahead of the moment.
    for (let i = 0; i < 30; i++) {
      view.pose(guest, 1 / SNAPSHOT_HZ);
      heard.push(...guest.events.map((e) => e.id));
    }
    expect(heard).toEqual(expected);
  });

  it('blends what moves and snaps what does not', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    const a = snapshotAfter(h, sent, 1);
    const b = snapshotAfter(h, sent, 60);
    view.push(a);
    view.push(b);
    // Land the moment exactly halfway between the two.
    view.pose(guest, 0);
    const behind = view.tick;
    view.pose(guest, ((h.tick - 30 - behind) * RULES.fixedStep) / 1.3);
    while (view.tick < h.tick - 30 - 0.01) view.pose(guest, RULES.fixedStep / 1.3);
    const t = (view.tick - (h.tick - 60)) / 60;
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.6);
    const fromB = createMatch([0, 1]);
    for (let i = 0; i < 60; i++) stepMatch(fromB, [null, null], RULES.fixedStep);
    // The clock is a line between the two readings; the score and phase are one or the other.
    const clockA = a.match[2] as number,
      clockB = b.match[2] as number;
    expect(guest.clock).toBeCloseTo(clockA + (clockB - clockA) * t, 3);
    expect(Number.isInteger(guest.period)).toBe(true);
    expect(['faceoff', 'playing']).toContain(guest.phase);
  });

  it('keeps more in hand after a late packet, and gives it back while they are on time', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    // Snapshots on time, frames in step with them: the view settles in behind the newest.
    for (let i = 0; i < 120; i++) {
      view.push(snapshotAfter(h, sent));
      view.pose(guest, 1 / SNAPSHOT_HZ);
    }
    const settled = view.delayMs,
      starved = view.starved;
    // A snapshot that is a long time coming: the view runs into the newest and has to wait.
    for (let i = 0; i < 20; i++) view.pose(guest, 1 / SNAPSHOT_HZ);
    view.push(snapshotAfter(h, sent, STEPS_PER_SNAPSHOT * 20));
    view.pose(guest, 1 / SNAPSHOT_HZ);
    // One wait, however many frames it lasted, and a little more buffer for next time.
    expect(view.starved).toBe(starved + 1);
    expect(view.delayMs).toBeGreaterThan(settled);
    expect(view.delayMs).toBeLessThanOrEqual(DELAY_MAX * RULES.fixedStep * 1000 + 1);
    // Then a long quiet stretch of packets on time, and it eases back toward the least it needs.
    for (let i = 0; i < 60 * 30; i++) {
      view.push(snapshotAfter(h, sent));
      view.pose(guest, 1 / SNAPSHOT_HZ);
    }
    expect(view.delayMs).toBe(Math.round(DELAY_MIN * RULES.fixedStep * 1000));
    expect(view.starved).toBe(starved + 1);
  });

  it('does not mistake a host standing still for a late packet', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    for (let i = 0; i < 30; i++) {
      view.push(snapshotAfter(h, sent));
      view.pose(guest, 1 / SNAPSHOT_HZ);
    }
    const starved = view.starved;
    // Between periods the host keeps talking but its clock does not move.
    h.phase = 'intermission';
    for (let i = 0; i < 120; i++) {
      view.push(snapshotAfter(h, sent));
      view.pose(guest, 1 / SNAPSHOT_HZ);
    }
    expect(guest.phase).toBe('intermission');
    expect(view.starved).toBe(starved);
  });

  it('starts over when the host does', () => {
    const h = host(),
      sent = { event: -1 },
      view = new SnapshotView(),
      guest = createMatch([0, 1]);
    for (let i = 0; i < 4; i++) view.push(snapshotAfter(h, sent));
    view.pose(guest, 1 / SNAPSHOT_HZ);
    expect(view.tick).toBeGreaterThan(100);
    // A fresh match has a tick near zero. The view follows it rather than waiting to catch up.
    const again = createMatch([0, 1]);
    startMatch(again);
    view.push(snapshotAfter(again, { event: -1 }));
    view.pose(guest, 1 / SNAPSHOT_HZ);
    expect(view.tick).toBeLessThan(10);
    expect(view.buffered).toBe(1);
  });
});
