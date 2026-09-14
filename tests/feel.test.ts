import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_STICK, PHYSICS, STICK } from '../src/game/config';
import { copyFeelTweaks, FEEL_PARAMS, formatFeel } from '../src/game/feel';

describe('feel tuner coverage', () => {
  it('exposes every live-feel physics and stick constant except body geometry', () => {
    const skipPhysics = new Set(['playerRadius']);
    const skipStick = new Set(['restSide', 'restReach', 'pivotSide', 'pivotReach']);
    const physics = new Set(
      FEEL_PARAMS.filter((param) => param.table === 'physics').map((param) => param.key),
    );
    const stick = new Set(
      FEEL_PARAMS.filter((param) => param.table === 'stick').map((param) => param.key),
    );
    for (const key of Object.keys(PHYSICS) as (keyof typeof PHYSICS)[])
      if (!skipPhysics.has(key)) expect(physics.has(key), key).toBe(true);
    for (const key of Object.keys(STICK) as (keyof typeof STICK)[])
      if (!skipStick.has(key)) expect(stick.has(key), key).toBe(true);
  });
  it('starts at shipped defaults and copy is a no-op note', () => {
    expect(PHYSICS).toEqual(DEFAULT_PHYSICS);
    expect(STICK).toEqual(DEFAULT_STICK);
    expect(copyFeelTweaks()).toMatch(/No feel tweaks/);
  });
  it('formats slider values from the step size', () => {
    expect(formatFeel(9.6, 0.1)).toBe('9.6');
    expect(formatFeel(0.965, 0.005)).toBe('0.965');
    expect(formatFeel(12, 0.5)).toBe('12.0');
  });
});
