import { describe, expect, it } from 'vitest';
import { formatVolume, readVolume, stepVolume } from '../src/audio/sound';

describe('volume mixer', () => {
  it('clamps saved values onto 0–1', () => {
    expect(readVolume(0.4)).toBe(0.4);
    expect(readVolume(2)).toBe(1);
    expect(readVolume(-1)).toBe(0);
    expect(readVolume(undefined, 0.7)).toBe(0.7);
    expect(readVolume(Number.NaN, 0.7)).toBe(0.7);
  });

  it('steps in five-percent ticks and stops at the ends', () => {
    expect(stepVolume(0.7, 1)).toBe(0.75);
    expect(stepVolume(0.7, -1)).toBe(0.65);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(0.73, 1)).toBe(0.75);
    expect(stepVolume(0.73, -1)).toBe(0.7);
    expect(formatVolume(0.7)).toBe('70%');
  });
});
