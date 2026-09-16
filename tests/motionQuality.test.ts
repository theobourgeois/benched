import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game/engine';
import { sampleDeke } from '../src/game/dekes';
import { SHOT_DOWNSWING } from '../src/game/actionTiming';
import { STICK } from '../src/game/config';
import {
  createHockeyAction,
  sampleHockeyAction,
  sampleTrack,
  shotWindup,
} from '../src/scene/hockeyMotion';
import type { DekeKind } from '../src/game/types';

describe('hockey movement continuity', () => {
  it('keeps contact plateaus flat and never overshoots authored values', () => {
    const track = [
      [0, 0],
      [0.2, 1],
      [0.45, 1],
      [0.7, 0],
      [1, 0],
    ] as const;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000,
        value = sampleTrack(track, t);
      expect(value).toBeGreaterThanOrEqual(-1e-10);
      expect(value).toBeLessThanOrEqual(1 + 1e-10);
      if (t >= 0.2 && t <= 0.45) expect(value).toBeCloseTo(1, 10);
      if (t >= 0.7) expect(value).toBeCloseTo(0, 10);
    }
  });

  it('returns the deke body to neutral before the action timer clears', () => {
    const kinds: DekeKind[] = [
      'stride',
      'burst',
      'protect',
      'jump',
      'throughLegs',
      'windmill',
      'spin',
    ];
    for (const kind of kinds)
      for (const direction of [-1, 1]) {
        const end = sampleDeke(kind, 1, direction);
        for (const key of ['lean', 'dip', 'headYaw', 'lift'] as const) {
          expect(end[key], `${kind}.${key}`).toBeCloseTo(0, 8);
          expect(sampleDeke(kind, 1 - 1e-6, direction)[key], `${kind}.${key} exit`).toBeCloseTo(
            0,
            4,
          );
        }
      }
  });

  it('starts the spin-o-rama as a 360 instead of gathering to center first', () => {
    const early = sampleDeke('spin', 0.12, 1);
    expect(Math.abs(early.yaw)).toBeGreaterThan(0.7);
    expect(Math.abs(early.side - STICK.restSide)).toBeLessThan(0.12);
  });

  it('one-touch dekes yank the puck the way NHL 14 does', () => {
    let maxSide = 0,
      maxReach = 0,
      maxProtectYaw = 0;
    for (let i = 0; i <= 50; i++) {
      const u = i / 50;
      maxSide = Math.max(maxSide, Math.abs(sampleDeke('stride', u, 1).side - STICK.restSide));
      maxReach = Math.max(maxReach, sampleDeke('burst', u, 0).reach);
      maxProtectYaw = Math.max(maxProtectYaw, Math.abs(sampleDeke('protect', u, 1).yaw));
    }
    expect(maxSide).toBeGreaterThan(1.2);
    expect(maxReach).toBeGreaterThan(STICK.restReach + 0.4);
    expect(maxProtectYaw).toBeGreaterThan(0.55);
  });

  it('compresses for a jump without sinking the skates or dropping the crouch at takeoff', () => {
    for (let i = 0; i <= 100; i++)
      expect(sampleDeke('jump', i / 100, 1).hop).toBeGreaterThanOrEqual(0);
    const a = sampleDeke('jump', 0.16 - 1e-6, 1);
    const b = sampleDeke('jump', 0.16 + 1e-6, 1);
    expect(a.dip).toBeCloseTo(b.dip, 4);
  });

  it('loads a compact backhand and transfers onto the opposite skate', () => {
    const p = createMatch().skaters[0];
    const forehand = { ...sampleHockeyAction(p, 1, createHockeyAction()) };
    p.stickSide = -0.5;
    const backhand = sampleHockeyAction(p, 1, createHockeyAction());
    expect(forehand.bladeLift).toBeGreaterThan(1.5);
    expect(backhand.bladeLift).toBeLessThan(0.2);
    expect(backhand.twist * forehand.twist).toBeLessThan(0);
    p.shotStyle = 'backhand';
    p.shotDuration = 0.6;
    p.shotTimer = 0.4;
    const follow = sampleHockeyAction(p, 0, createHockeyAction());
    expect(follow.weightTo).toBeLessThan(0);
    expect(follow.drag).toBeLessThan(0);
  });

  it('joins the charged downswing to release without resetting the body or moving contact', () => {
    const p = createMatch().skaters[0];
    p.pendingShot = { timer: SHOT_DOWNSWING, load: 0.85, power: 1, aim: 0, height: 0.5, tick: 0 };
    let previous = Infinity;
    for (let i = 0; i <= 100; i++) {
      p.pendingShot.timer = SHOT_DOWNSWING * (1 - i / 100);
      const a = sampleHockeyAction(p, shotWindup(p, 0), createHockeyAction());
      expect(a.bladeLift).toBeLessThanOrEqual(previous + 1e-9);
      previous = a.bladeLift;
    }
    const contact = sampleHockeyAction(p, 0, createHockeyAction());
    p.pendingShot = null;
    p.shotStyle = 'slap';
    p.shotTimer = p.shotDuration = 0.6;
    const release = sampleHockeyAction(p, 0, createHockeyAction());
    for (const key of Object.keys(contact) as (keyof typeof contact)[])
      expect(release[key], key).toBeCloseTo(contact[key], 8);
    expect(release.bladeLift).toBe(0);
    expect(release.bladeReach).toBe(0);
  });
});
