import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../src/input/controller';

type FakePad = {
  connected: boolean;
  index: number;
  id: string;
  mapping: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
};
const pad = (index: number): FakePad => ({
  connected: true,
  index,
  id: 'Xbox Wireless Controller (test)',
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
});
let pads: FakePad[] = [];

beforeEach(() => {
  pads = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => pads },
  });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  });
});

/** Seats register themselves globally, so every one opened by a test is closed again. */
const opened: (() => void)[] = [];
afterEach(() => {
  while (opened.length) opened.pop()!();
});
/** Two seats, read in order, the way the frame loop drives them. */
function seats() {
  const one = new Controller(),
    two = new Controller(false);
  const detachOne = one.attach(),
    detachTwo = two.attach();
  opened.push(detachOne, detachTwo);
  // Seat one picks first; seat two is told what it left behind. Same order as the frame loop.
  const frame = () => {
    one.claimed = [];
    one.read(1 / 60);
    two.claimed = one.padIndex === undefined ? [] : [one.padIndex];
    two.read(1 / 60);
  };
  return { one, two, frame, detach: () => (detachOne(), detachTwo()) };
}

describe('two seats sharing the gamepad list', () => {
  it('gives the only pad to seat one, and nothing to seat two', () => {
    pads = [pad(0)];
    const { one, two, frame } = seats();
    frame();
    expect(one.status.connected).toBe(true);
    expect(two.status.connected).toBe(false);
  });

  it('gives each seat its own pad when two are plugged in', () => {
    pads = [pad(0), pad(1)];
    const { one, two, frame } = seats();
    frame();
    expect([one.status.connected, two.status.connected]).toEqual([true, true]);
    expect(one.lastPad?.index).not.toBe(two.lastPad?.index);
  });

  it('keeps each seat on the same pad across frames', () => {
    pads = [pad(0), pad(1)];
    const { one, two, frame } = seats();
    frame();
    const claims = [one.lastPad?.index, two.lastPad?.index];
    for (let i = 0; i < 10; i++) frame();
    expect([one.lastPad?.index, two.lastPad?.index]).toEqual(claims);
  });

  it('hands seat two a pad that arrives later, without taking seat one away', () => {
    pads = [pad(0)];
    const { one, two, frame } = seats();
    frame();
    pads = [pad(0), pad(1)];
    frame();
    expect([one.status.connected, two.status.connected]).toEqual([true, true]);
    expect(one.lastPad?.index).toBe(0);
    expect(two.lastPad?.index).toBe(1);
  });

  it('keeps seat one on the pad across a remount, the way strict mode replays effects', () => {
    pads = [pad(0)];
    const { one, two, frame, detach } = seats();
    frame();
    // React mounts, tears down and mounts again in development. The claim must survive that.
    detach();
    one.attach();
    two.attach();
    frame();
    expect(one.status.connected).toBe(true);
    expect(two.status.connected).toBe(false);
    expect(one.padIndex).toBe(0);
  });
});
