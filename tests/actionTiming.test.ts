import { describe, expect, it } from 'vitest';
import { advancePendingShot, createMatch, requestShot, stepMatch } from '../src/game/engine';
import { GOALIE_SAVE_TIME, SHOT_DOWNSWING } from '../src/game/actionTiming';
import { EMPTY_INPUT } from '../src/game/config';
import { ReplayBuffer, createView, sampleReplay, REPLAY_HZ } from '../src/game/replay';
import {
  createGoalieAction,
  createHockeyAction,
  sampleGoalieAction,
  sampleHockeyAction,
  shotWindup,
} from '../src/scene/hockeyMotion';
import { drive, played, seat } from './support';

function chargedShot() {
  const s = createMatch(),
    p = s.skaters[0];
  drive(s, p.id);
  s.puck.owner = p.id;
  s.sides[played(s)].shotCharge = 0.85;
  requestShot(s, p, 0.9, 0.3, 0.6);
  return { s, p };
}

describe('charged-shot contact timing', () => {
  it('keeps the puck until the blade has completed the downswing, then releases once', () => {
    const { s, p } = chargedShot();
    expect(s.puck.owner).toBe(p.id);
    expect(s.shots[p.team]).toBe(0);
    expect(shotWindup(p, 0)).toBeCloseTo(0.85);
    requestShot(s, p, 0.1); // A second gesture must not restart or replace the committed action.
    expect(p.pendingShot!.power).toBe(0.9);
    for (let i = 1; i <= 8; i++) {
      s.tick++;
      advancePendingShot(s, p, 1 / 120);
      expect(s.puck.owner).toBe(p.id);
      expect(s.shots[p.team]).toBe(0);
    }
    const beforeContact = sampleHockeyAction(p, shotWindup(p, 0), createHockeyAction());
    // The blade is still descending on the last pre-contact frame; it reaches the ice at release.
    expect(beforeContact.bladeLift).toBeLessThan(0.08);
    s.tick++;
    advancePendingShot(s, p, 1 / 120);
    expect(p.pendingShot).toBeNull();
    expect(s.puck.owner).toBeNull();
    expect(s.shots[p.team]).toBe(1);
    expect(p.shotStyle).toBe('slap');
    expect(sampleHockeyAction(p, 0, createHockeyAction()).bladeLift).toBe(0);
    advancePendingShot(s, p, 1);
    expect(s.shots[p.team]).toBe(1);
  });

  it('advances the downswing through the real input and simulation loop', () => {
    const s = createMatch(0, 'freeSkate'),
      p = s.skaters[0];
    s.phase = 'playing';
    drive(s, 0);
    s.puck.owner = 0;
    s.sides[played(s)].shotCharge = 0.9;
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, shoot: true, shotPower: 0.9 }));
    expect(p.pendingShot).not.toBeNull();
    expect(s.shots[0]).toBe(0);
    for (let i = 0; i < 8; i++) stepMatch(s, seat(s, EMPTY_INPUT));
    expect(s.shots[0]).toBe(0);
    stepMatch(s, seat(s, EMPTY_INPUT));
    expect(s.shots[0]).toBe(1);
    expect(p.pendingShot).toBeNull();
    expect(s.puck.owner).toBeNull();
  });

  it('releases a tap, backhand and one-timer immediately', () => {
    for (const kind of ['tap', 'backhand', 'one-timer']) {
      const s = createMatch(),
        p = s.skaters[0];
      s.puck.owner = p.id;
      drive(s, p.id);
      s.sides[played(s)].shotCharge = kind === 'tap' ? 0 : 0.9;
      if (kind === 'backhand') p.stickSide = -0.6;
      if (kind === 'one-timer') p.passTimer = 0.2;
      requestShot(s, p, 0.9);
      expect(s.puck.owner).toBeNull();
      expect(s.shots[p.team]).toBe(1);
      expect(p.pendingShot).toBeNull();
    }
  });

  it('cancels the downswing when possession or the ability to shoot is lost', () => {
    for (const reason of ['possession', 'down', 'stumble', 'deke']) {
      const { s, p } = chargedShot();
      if (reason === 'possession') s.puck.owner = null;
      if (reason === 'down') p.downTimer = 1;
      if (reason === 'stumble') p.stumbleTimer = 1;
      if (reason === 'deke') p.dekeKind = 'stride';
      s.tick++;
      advancePendingShot(s, p, SHOT_DOWNSWING);
      expect(p.pendingShot).toBeNull();
      expect(s.shots[p.team]).toBe(0);
    }
  });

  it('records the committed aim and samples downswing time smoothly when scrubbing', () => {
    const { s, p } = chargedShot(),
      recorder = new ReplayBuffer();
    recorder.record(s);
    s.tick++;
    advancePendingShot(s, p, 1 / REPLAY_HZ);
    recorder.record(s);
    const frames = recorder.snapshot(),
      view = createView(s);
    expect(frames[0].skaters[0].pendingShot!.timer).toBe(SHOT_DOWNSWING);
    sampleReplay(view, frames, 0.5 / REPLAY_HZ);
    expect(view.skaters[0].pendingShot!.timer).toBeCloseTo(SHOT_DOWNSWING - 0.5 / REPLAY_HZ);
    expect(view.skaters[0].pendingShot!.aim).toBe(0.3);
    sampleReplay(view, frames, 0);
    expect(view.skaters[0].pendingShot!.timer).toBe(SHOT_DOWNSWING);
  });
});

describe('goalie motion', () => {
  it('reads incoming shots, ignores departing shots, and distinguishes glove-height saves', () => {
    const s = createMatch(),
      p = s.skaters[5],
      out = createGoalieAction();
    Object.assign(p, { x: 0, z: 0, angle: 0 });
    Object.assign(s.puck, { x: 0.3, z: 2, y: 0.1, vx: 0, vz: -20, vy: 0, shot: true, owner: null });
    sampleGoalieAction(p, s.puck, out);
    expect(out.drop).toBeGreaterThan(0.1);
    expect(out.side).toBeGreaterThan(0);
    s.puck.vz = 20;
    expect(sampleGoalieAction(p, s.puck, out).drop).toBe(0);
    p.saveTimer = GOALIE_SAVE_TIME * 0.65;
    p.saveKind = 'glove';
    p.saveSide = 0.8;
    p.saveHeight = 1.3;
    sampleGoalieAction(p, s.puck, out);
    expect(out.high).toBe(1);
    expect(out.glove).toBeGreaterThan(0.9);
    expect(out.gloveX).toBeCloseTo(0.8);
    expect(out.gloveY).toBeCloseTo(1.3);
    expect(out.drop).toBeLessThan(0.35);
    p.saveKind = 'butterfly';
    p.saveHeight = 0.1;
    expect(sampleGoalieAction(p, s.puck, out).drop).toBeGreaterThan(0.9);
    expect(out.glove).toBe(0);
    p.saveTimer = 0;
    expect(sampleGoalieAction(p, s.puck, out).reach).toBe(0);
    s.puck.owner = p.id;
    p.coverTimer = 0.6;
    // Going down onto the puck eases in over a few frames rather than cutting.
    expect(sampleGoalieAction(p, s.puck, out).cover).toBeGreaterThan(0.1);
    expect(out.cover).toBeLessThan(0.5);
    for (let i = 0; i < 30; i++) sampleGoalieAction(p, s.puck, out);
    expect(out.cover).toBe(1);
    expect(out.drop).toBe(1);
  });
});
