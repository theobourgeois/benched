import { describe, expect, it } from 'vitest';
import { celebrationLevel, GOAL_LEAD_IN, songCueTime } from '../src/audio/goalSongs';
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

describe('goal lead-in', () => {
  it('parks the playhead short of the drop', () => {
    expect(songCueTime(29.88)).toBeCloseTo(29.88 - GOAL_LEAD_IN);
    expect(songCueTime(0.4)).toBe(0);
  });

  it('stays quiet at the cue and hits full as the drop lands', () => {
    const drop = 30;
    expect(celebrationLevel(drop - GOAL_LEAD_IN, drop, false)).toBeCloseTo(0.28);
    expect(celebrationLevel(drop - GOAL_LEAD_IN / 2, drop, false)).toBeLessThan(0.55);
    expect(celebrationLevel(drop, drop, false)).toBe(1);
    expect(celebrationLevel(drop + 0.4, drop, false)).toBe(1);
    expect(celebrationLevel(drop - GOAL_LEAD_IN, drop, true)).toBe(0.22);
  });
});
