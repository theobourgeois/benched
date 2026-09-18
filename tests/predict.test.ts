import { describe, expect, it } from 'vitest';
import { createMatch, startMatch, stepMatch } from '../src/game/engine';
import { EMPTY_INPUT, RULES } from '../src/game/config';
import type { InputFrame, MatchState } from '../src/game/types';
import { decodeSnapshot, encodeSnapshot, STAMP_WRAP } from '../src/net/snapshot';
import { Predictor } from '../src/net/predict';
import { SnapshotView } from '../src/net/view';
import { INPUT_HZ } from '../src/net/input';

/**
 * The guest draws its own skater where the host will put it, not where the host last said it
 * was. A host and a guest are run against a link with a fixed delay each way; the guest's guess
 * at any moment is measured against what the host really did once those presses reached it.
 */

const STEPS_PER_INPUT = Math.round(1 / RULES.fixedStep / INPUT_HZ);
const FRAME = 1 / INPUT_HZ;

/** What the stick is doing on frame `k`: a long carving turn, so the guess has to earn it. */
const stick = (k: number): InputFrame => ({
  ...EMPTY_INPUT,
  moveX: Math.cos(k / 40),
  moveZ: Math.sin(k / 40),
  hustle: k % 90 < 45,
  stickX: Math.sin(k / 15) * 0.6,
});

/** One person alone on the rink with the puck, on team 1: contact-free, so any gap is the guess. */
function host() {
  const s = createMatch([1], 'freeSkate');
  startMatch(s);
  for (let i = 0; i < 2 / RULES.fixedStep; i++) stepMatch(s, [[], []], RULES.fixedStep);
  return s;
}
const you = (s: MatchState) => s.skaters[s.sides[1].humans[0].controlled];
const apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Run `frames` input frames through a link `delay` frames long each way. Returns where the host
 * had the skater on every frame, and where the guest drew it, with and without the guess.
 */
function play(frames: number, delay: number, nudge?: (h: MatchState, k: number) => void) {
  const h = host();
  const g = createMatch([1], 'freeSkate');
  const plain = createMatch([1], 'freeSkate');
  const view = new SnapshotView();
  const plainView = new SnapshotView();
  const predictor = new Predictor();
  const inFlight: { at: number; buffer: ArrayBuffer }[] = [];
  const truth: { x: number; z: number }[] = [];
  const guessed: { x: number; z: number }[] = [];
  const drawn: { x: number; z: number }[] = [];
  let sentEvent = -1;
  for (let k = 0; k < frames; k++) {
    // The guest presses, stamps and sends.
    const frame = stick(k);
    predictor.record(k, frame);
    // The host steps the frame that has just reached it, and says what happened.
    const arrived = k - delay;
    const input = arrived >= 0 ? stick(arrived) : EMPTY_INPUT;
    for (let i = 0; i < STEPS_PER_INPUT; i++) stepMatch(h, [[], [input]], RULES.fixedStep);
    nudge?.(h, k);
    truth.push({ x: you(h).x, z: you(h).z });
    inFlight.push({ at: k + delay, buffer: encodeSnapshot(h, sentEvent, k, Math.max(0, arrived)) });
    sentEvent = h.events.at(-1)?.id ?? sentEvent;
    // Snapshots land on the guest after the same delay.
    while (inFlight.length && inFlight[0].at <= k) {
      const snap = decodeSnapshot(inFlight.shift()!.buffer);
      predictor.acknowledge(Math.max(0, arrived - delay));
      view.push(snap);
      plainView.push(decodeSnapshot(encodeSnapshot(h, -1)));
      void snap;
    }
    plainView.pose(plain, FRAME);
    drawn.push({ x: you(plain).x, z: you(plain).z });
    view.pose(g, FRAME);
    predictor.apply(g, view.newest, null, 1, FRAME);
    guessed.push({ x: you(g).x, z: you(g).z });
  }
  return { truth, guessed, drawn, delay, g, h };
}

describe('the guest guessing its own skater', () => {
  it('lands where the host puts the skater once the presses arrive', () => {
    const delay = 4;
    const { truth, guessed, drawn } = play(240, delay);
    // The guest's guess on frame k is where the host is on frame k + delay, when the host has
    // stepped the presses the guest had made by k. Skip the start while the link is filling.
    let worst = 0,
      worstPlain = 0;
    for (let k = 60; k + delay < truth.length; k++) {
      worst = Math.max(worst, apart(guessed[k], truth[k + delay]));
      worstPlain = Math.max(worstPlain, apart(drawn[k], truth[k + delay]));
    }
    expect(worst).toBeLessThan(0.08);
    // Without the guess the skater is drawn a full round trip and a buffer behind: far off.
    expect(worstPlain).toBeGreaterThan(0.5);
  });

  it('carries the puck on the blade it draws', () => {
    const { g } = play(120, 3);
    const p = you(g);
    expect(g.puck.owner).toBe(p.id);
    const fx = Math.sin(p.angle),
      fz = Math.cos(p.angle);
    expect(g.puck.x).toBeCloseTo(p.x + fx * p.stickReach + fz * p.stickSide, 5);
    expect(g.puck.z).toBeCloseTo(p.z + fz * p.stickReach - fx * p.stickSide, 5);
  });

  it('smooths a disagreement with the host rather than popping to it', () => {
    // Halfway through, the host has the skater shoved half a metre sideways.
    const { guessed } = play(200, 3, (h, k) => {
      if (k === 100) you(h).z += 0.5;
    });
    // Each frame's motion is close to the frame before it: no single jump of the shove itself.
    let biggestJump = 0;
    for (let k = 90; k < 130; k++) {
      const step = apart(guessed[k], guessed[k - 1]);
      const before = apart(guessed[k - 1], guessed[k - 2]);
      biggestJump = Math.max(biggestJump, Math.abs(step - before));
    }
    expect(biggestJump).toBeLessThan(0.2);
  });

  it('holds through a frozen frame and picks up again without a jump', () => {
    // A hit freezes the host for a quarter of a second mid-carry.
    const { guessed, truth, delay } = play(260, 3, (h, k) => {
      if (k === 100) h.hitstop = 0.25;
    });
    let biggestJump = 0;
    for (let k = 90; k < 160; k++)
      biggestJump = Math.max(biggestJump, apart(guessed[k], guessed[k - 1]));
    // Nothing moves much further in a frame than a skater at full tilt does, about 0.17 m: a
    // pop back to where the host last drew it would be most of a metre.
    expect(biggestJump).toBeLessThan(0.25);
    // And once the frame thaws the guess is back on the host's line.
    let worst = 0;
    for (let k = 200; k + delay < truth.length; k++)
      worst = Math.max(worst, apart(guessed[k], truth[k + delay]));
    expect(worst).toBeLessThan(0.08);
  });

  it('eases back onto the host when the guess switches off', () => {
    // A whistle: the host stops moving skaters, where they stand, until the puck drops.
    const { guessed, drawn, truth } = play(240, 4, (h, k) => {
      if (k === 100) {
        h.phase = 'faceoff';
        h.countdown = 60;
      }
    });
    // The guess had run a round trip ahead of where the host stopped. It comes back over
    // several frames, never most of the way in one, and each frame's step is smaller than the last.
    // The whistle reaches the guest a link's delay later, so the gap is at its widest then.
    let gap = 0;
    for (let k = 100; k < 110; k++) gap = Math.max(gap, apart(guessed[k], truth[100]));
    expect(gap).toBeGreaterThan(0.5);
    const steps: number[] = [];
    for (let k = 101; k < 140; k++) steps.push(apart(guessed[k], guessed[k - 1]));
    expect(Math.max(...steps)).toBeLessThan(gap / 2);
    const first = steps.indexOf(Math.max(...steps));
    const easing = steps.slice(
      first,
      steps.findIndex((d, i) => i > first && d < 0.005),
    );
    for (let i = 1; i < easing.length; i++) expect(easing[i]).toBeLessThan(easing[i - 1] + 0.01);
    // Once settled the guest draws exactly what the host said.
    expect(apart(guessed[239], drawn[239])).toBeLessThan(0.001);
  });

  it('forgets presses the host has answered, across the clock wrapping', () => {
    const predictor = new Predictor();
    for (let i = 0; i < 6; i++) predictor.record((STAMP_WRAP - 3 + i) % STAMP_WRAP, EMPTY_INPUT);
    expect(predictor.pending).toBe(6);
    predictor.acknowledge(STAMP_WRAP - 1);
    expect(predictor.pending).toBe(3);
    predictor.acknowledge(1);
    expect(predictor.pending).toBe(1);
  });
});
