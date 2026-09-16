import { describe, expect, it } from 'vitest';
import { createMatch, startMatch, stepMatch } from '../src/game/engine';
import { EMPTY_INPUT, RULES } from '../src/game/config';
import { canStartCelly, cellyDuration, cellyRagdoll, sampleCelly } from '../src/game/cellys';
import type { MatchState } from '../src/game/types';

function tick(s: MatchState, seconds: number, input = EMPTY_INPUT) {
  for (let t = 0; t < Math.ceil(seconds / RULES.fixedStep); t++) stepMatch(s, input);
}

function scoreHome(s: MatchState) {
  s.phase = 'playing';
  Object.assign(s.puck, { x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1, owner: null });
  stepMatch(s);
}

describe('goal celebrations', () => {
  it('starts a helicopter celly with A after a home goal and does not switch skaters', () => {
    const s = createMatch();
    startMatch(s);
    s.phase = 'playing';
    const before = s.controlled;
    scoreHome(s);
    expect(s.phase).toBe('goal');
    expect(s.scoringTeam).toBe(0);
    const you = s.skaters[s.controlled];
    expect(canStartCelly(s, you)).toBe(true);
    stepMatch(s, { ...EMPTY_INPUT, switchPlayer: true, celly: 'helicopter' });
    expect(s.controlled).toBe(before);
    expect(you.cellyKind).toBe('helicopter');
    expect(you.cellyTimer).toBe(0);
  });

  it('maps each face button to a different celly', () => {
    for (const kind of ['helicopter', 'jump', 'limp', 'dance'] as const) {
      const s = createMatch();
      startMatch(s);
      scoreHome(s);
      const you = s.skaters[s.controlled];
      stepMatch(s, { ...EMPTY_INPUT, celly: kind });
      expect(you.cellyKind).toBe(kind);
      expect(cellyRagdoll(you)).toBe(kind === 'limp');
    }
  });

  it('ignores celly input during open play', () => {
    const s = createMatch();
    startMatch(s);
    s.phase = 'playing';
    stepMatch(s, { ...EMPTY_INPUT, celly: 'dance' });
    expect(s.skaters[s.controlled].cellyKind).toBeNull();
  });

  it('does not let the home team celebrate an opponent goal', () => {
    const s = createMatch();
    startMatch(s);
    s.phase = 'playing';
    Object.assign(s.puck, { x: -25.8, z: 0.8, y: 0.4, vx: -44, lockout: 1, owner: null });
    stepMatch(s);
    expect(s.phase).toBe('goal');
    expect(s.scoringTeam).toBe(1);
    stepMatch(s, { ...EMPTY_INPUT, celly: 'jump' });
    expect(s.skaters[s.controlled].cellyKind).toBeNull();
  });

  it('holds the goal phase until a late celly finishes', () => {
    const s = createMatch();
    startMatch(s);
    scoreHome(s);
    s.countdown = 0.4;
    stepMatch(s, { ...EMPTY_INPUT, celly: 'dance' });
    expect(s.skaters[s.controlled].cellyKind).toBe('dance');
    expect(s.countdown).toBeGreaterThan(cellyDuration('dance'));
    tick(s, cellyDuration('dance') - 0.05);
    expect(s.phase).toBe('goal');
    expect(s.skaters[s.controlled].cellyKind).toBe('dance');
    tick(s, 0.8);
    expect(s.skaters[s.controlled].cellyKind).toBeNull();
  });

  it('clears a finished celly and still keeps the puck in the net', () => {
    const s = createMatch();
    startMatch(s);
    scoreHome(s);
    stepMatch(s, { ...EMPTY_INPUT, celly: 'jump' });
    tick(s, cellyDuration('jump') + 0.05);
    expect(s.skaters[s.controlled].cellyKind).toBeNull();
    expect(s.phase).toBe('goal');
  });
});

describe('celly poses', () => {
  it('sends the stick rotor spinning and the jumper way off the ice', () => {
    const chopper = sampleCelly('helicopter', 0.2);
    expect(chopper.rotor).toBeGreaterThan(10);
    expect(chopper.hop).toBeGreaterThan(0.5);
    expect(chopper.pitch).toBeLessThan(-0.2);
    const leap = sampleCelly('jump', 0.45);
    expect(leap.hop).toBeGreaterThan(2);
    expect(sampleCelly('limp', 0.5).ragdoll).toBe(true);
    const dance = sampleCelly('dance', 0.3);
    expect(Math.abs(dance.lean) + Math.abs(dance.headYaw)).toBeGreaterThan(0.4);
  });
});
