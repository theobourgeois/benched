import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT } from '../src/game/config';
import { decodeInput, encodeInput, INPUT_BYTES } from '../src/net/input';
import { mergeEdges, noEdges } from '../src/input/frames';
import type { InputFrame } from '../src/game/types';

const busy: InputFrame = {
  ...EMPTY_INPUT,
  moveX: 0.625,
  moveZ: -0.5,
  stickX: -0.25,
  stickY: 0.875,
  shoot: true,
  shotPower: 0.75,
  aimZ: -0.375,
  shotHeight: 0.5,
  toeDrag: true,
  passHeld: true,
  pokeHeld: true,
  chip: true,
  deke: true,
  dekeSpecial: 'windmill',
  check: true,
  checkPower: 0.5,
  reach: true,
  block: true,
  stickIceX: 0.125,
  stickIceZ: -0.75,
  switchPlayer: true,
  hustle: true,
  pause: true,
  celly: 'dance',
};

describe('an input frame on the wire', () => {
  it('is small enough to send every frame without thinking about it', () => {
    // Sixty of these a second is well under a tenth of what the snapshots cost.
    expect(INPUT_BYTES).toBeLessThan(64);
  });

  it('comes back as it went, buttons and sticks alike', () => {
    const { frame, stamp, echo } = decodeInput(encodeInput(busy, 1234, 987654));
    expect(stamp).toBe(1234);
    expect(echo).toBe(987654);
    for (const key of Object.keys(busy) as (keyof InputFrame)[]) {
      const a = busy[key] ?? null,
        b = frame[key] ?? null;
      if (typeof a === 'number' && typeof b === 'number')
        expect(Math.abs(a - b), key).toBeLessThan(0.002);
      else expect(b, key).toEqual(a);
    }
  });

  it('keeps an untouched stick untouched', () => {
    const { frame } = decodeInput(encodeInput(EMPTY_INPUT, 0));
    expect(frame.moveX).toBe(0);
    expect(frame.shoot).toBe(false);
    expect(frame.dekeSpecial).toBeNull();
    expect(frame.celly).toBeNull();
  });
});

describe('presses across a gap in time', () => {
  it('fires a shot once, however many steps read the same frame', () => {
    // The simulation steps at 120 Hz and frames arrive at 60, so each one is read twice.
    let held = { ...EMPTY_INPUT, shoot: true, shotPower: 0.8 };
    const fired: boolean[] = [];
    for (let step = 0; step < 4; step++) {
      fired.push(held.shoot);
      held = noEdges(held);
    }
    expect(fired).toEqual([true, false, false, false]);
  });

  it('keeps a press made between two reads', () => {
    const idle = { ...EMPTY_INPUT, moveX: 1 };
    const pressed = { ...EMPTY_INPUT, moveX: 1, shoot: true, shotPower: 0.9 };
    // A frame that caught the press is folded into the next one, so the shot is not lost.
    const merged = mergeEdges(pressed, idle);
    expect(merged.shoot).toBe(true);
    expect(merged.shotPower).toBeCloseTo(0.9, 3);
  });

  it('does not invent a press that nobody made', () => {
    const merged = mergeEdges({ ...EMPTY_INPUT }, { ...EMPTY_INPUT, moveX: 1 });
    expect(merged.shoot).toBe(false);
    expect(merged.check).toBe(false);
    expect(merged.celly).toBeNull();
  });
});
