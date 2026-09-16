import { describe, expect, it } from 'vitest';
import { createMatch, startMatch, stepMatch, requestShot } from '../src/game/engine';
import { applySnapshot, encodeSnapshot, SNAPSHOT_BYTES } from '../src/net/snapshot';
import { EMPTY_INPUT, RULES } from '../src/game/config';
import type { MatchState, SideInputs } from '../src/game/types';
import { drive } from './support';

const play = (s: MatchState, inputs: SideInputs, seconds: number) => {
  for (let t = 0; t < Math.ceil(seconds / RULES.fixedStep); t++)
    stepMatch(s, inputs, RULES.fixedStep);
};

/** A match wound into a state with something happening at both ends. */
function busy() {
  const s = createMatch([0, 1]);
  startMatch(s);
  play(s, [null, null], 4);
  // Carry, wind up a shot, and deke, so pending shots, windups and stick geometry are all live.
  play(
    s,
    [
      { ...EMPTY_INPUT, moveX: 1, stickY: 0.8, hustle: true },
      { ...EMPTY_INPUT, moveX: -1, deke: true, check: true, checkPower: 0.7 },
    ],
    2.5,
  );
  return s;
}

/** Everything the scene reads off a skater to pose it. */
const POSE_KEYS = [
  'x',
  'z',
  'vx',
  'vz',
  'angle',
  'stamina',
  'cooldown',
  'checkTimer',
  'stride',
  'skateDrive',
  'edgeLean',
  'downTimer',
  'stumbleTimer',
  'rush',
  'hitLock',
  'checkPower',
  'checkLanded',
  'hitImmunity',
  'fallAngle',
  'stickSide',
  'stickReach',
  'stickSideVel',
  'stickReachVel',
  'shotTimer',
  'saveTimer',
  'saveKind',
  'saveSide',
  'saveHeight',
  'readTimer',
  'coverTimer',
  'shotStyle',
  'shotDuration',
  'shotSide',
  'shotReach',
  'shotLoad',
  'passTimer',
  'diveTimer',
  'blockTimer',
  'liftTimer',
  'dekeKind',
  'dekeTimer',
  'dekeDir',
  'cellyKind',
  'cellyTimer',
] as const;

describe('snapshot round trip', () => {
  it('fits one moment of a match in about a kilobyte', () => {
    // A quiet moment carries no calls, so it is well under the ceiling a busy one needs.
    const quiet = encodeSnapshot(createMatch()).byteLength;
    expect(quiet).toBeLessThan(1400);
    expect(SNAPSHOT_BYTES).toBeLessThan(2048);
    // Sixty a second is the rate the host publishes at: under a hundred kilobytes a second.
    expect(quiet * 60).toBeLessThan(100_000);
  });

  it('carries the calls the other end has not heard, once each', () => {
    const host = busy();
    host.events = [
      { id: 10, type: 'faceoff', power: 1 },
      { id: 11, type: 'hit', power: 0.8, x: 3.5, z: -2.25 },
      { id: 12, type: 'crossbar', power: 1, barDown: true },
    ];
    const guest = createMatch([0, 1]);
    applySnapshot(guest, encodeSnapshot(host));
    expect(guest.events.map((e) => e.type)).toEqual(['faceoff', 'hit', 'crossbar']);
    expect(guest.events[1].x).toBeCloseTo(3.5, 2);
    expect(guest.events[1].z).toBeCloseTo(-2.25, 2);
    expect(guest.events[2].barDown).toBe(true);
    // A call with no place of its own does not gain one at the origin.
    expect(guest.events[0].x).toBeUndefined();
    // Only what is new crosses, so nothing is played twice.
    applySnapshot(guest, encodeSnapshot(host, 11));
    expect(guest.events.map((e) => e.id)).toEqual([12]);
  });

  it('poses every skater onto a watching match within its quantisation', () => {
    const host = busy();
    const guest = createMatch([0, 1]);
    applySnapshot(guest, encodeSnapshot(host));
    host.skaters.forEach((from, i) => {
      const to = guest.skaters[i];
      for (const key of POSE_KEYS) {
        const a = from[key] ?? null,
          b = to[key] ?? null;
        if (typeof a === 'number' && typeof b === 'number') {
          // Metres land within ~4 mm, timers finer. Facing is compared as a direction, since it
          // is sent wrapped and a skater that has spun twice points the same way.
          const off =
            key === 'angle' || key === 'fallAngle'
              ? Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
              : Math.abs(a - b);
          expect(off, `skater ${i} ${key}`).toBeLessThan(0.005);
        } else {
          expect(b, `skater ${i} ${key}`).toEqual(a);
        }
      }
    });
  });

  it('carries the puck, the clock and both sides', () => {
    const host = busy();
    host.score = [2, 1];
    host.shots = [7, 4];
    const guest = createMatch([0, 1]);
    applySnapshot(guest, encodeSnapshot(host));
    expect(guest.phase).toBe(host.phase);
    expect(guest.score).toEqual(host.score);
    expect(guest.shots).toEqual(host.shots);
    expect(guest.tick).toBe(host.tick);
    expect(guest.puck.owner).toBe(host.puck.owner);
    expect(guest.puck.x).toBeCloseTo(host.puck.x, 2);
    expect(guest.puck.z).toBeCloseTo(host.puck.z, 2);
    expect(guest.puck.y).toBeCloseTo(host.puck.y, 2);
    expect(guest.puck.shot).toBe(host.puck.shot);
    for (const team of [0, 1] as const) {
      expect(guest.sides[team].controlled).toBe(host.sides[team].controlled);
      expect(guest.sides[team].human).toBe(host.sides[team].human);
      expect(guest.sides[team].shotCharge).toBeCloseTo(host.sides[team].shotCharge, 2);
      expect(guest.sides[team].passTarget).toBe(host.sides[team].passTarget);
    }
  });

  it('keeps the match object it was given, because the scene reads identity as a cut', () => {
    const guest = createMatch([0, 1]);
    const skater = guest.skaters[3],
      puck = guest.puck;
    applySnapshot(guest, encodeSnapshot(busy()));
    expect(guest.skaters[3]).toBe(skater);
    expect(guest.puck).toBe(puck);
  });

  it('keeps the names and numbers the receiver already had', () => {
    const host = busy();
    const guest = createMatch([0, 1]);
    const named = guest.skaters.map((p) => `${p.number} ${p.name} ${p.role}`);
    applySnapshot(guest, encodeSnapshot(host));
    expect(guest.skaters.map((p) => `${p.number} ${p.name} ${p.role}`)).toEqual(named);
  });

  it('survives a charged shot in flight, nulls and all', () => {
    const s = createMatch([0, 1]);
    startMatch(s);
    play(s, [null, null], 4);
    const carrier = s.skaters.find((p) => p.id === s.puck.owner);
    if (carrier) {
      drive(s, carrier.id);
      s.sides[carrier.team].shotCharge = 0.9;
      requestShot(s, carrier, 0.9, 0.3, 0.6);
    }
    const guest = createMatch([0, 1]);
    applySnapshot(guest, encodeSnapshot(s));
    s.skaters.forEach((from, i) => {
      const to = guest.skaters[i];
      expect(!!to.pendingShot, `skater ${i}`).toBe(!!from.pendingShot);
      if (from.pendingShot && to.pendingShot) {
        expect(to.pendingShot.tick).toBe(from.pendingShot.tick);
        expect(to.pendingShot.timer).toBeCloseTo(from.pendingShot.timer, 2);
        expect(to.pendingShot.load).toBeCloseTo(from.pendingShot.load, 2);
      }
    });
  });

  it('round trips repeatedly without drifting', () => {
    const host = busy();
    const guest = createMatch([0, 1]);
    applySnapshot(guest, encodeSnapshot(host));
    const once = guest.skaters.map(
      (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)},${p.angle.toFixed(4)}`,
    );
    // Re-encoding what was decoded must land on the same numbers, or error compounds over a match.
    for (let i = 0; i < 5; i++) applySnapshot(guest, encodeSnapshot(guest));
    expect(
      guest.skaters.map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)},${p.angle.toFixed(4)}`),
    ).toEqual(once);
  });
});
