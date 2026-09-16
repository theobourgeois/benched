import { describe, expect, it } from 'vitest';
import {
  createMatch,
  isOnIce,
  nextPeriod,
  passPuck,
  resetFormation,
  shootPuck,
  startMatch,
  stepMatch,
  stickCarryTarget,
  stickTip,
  togglePause,
  netShotTarget,
  shotSpread,
} from '../src/game/engine';
import {
  attackDirection,
  EMPTY_INPUT,
  GET_UP,
  IRON,
  PHYSICS,
  PUCK,
  RINK,
  RULES,
  STICK,
} from '../src/game/config';
import { decideAI } from '../src/game/ai';
import { dekeDuration } from '../src/game/dekes';
import { constrainToRink } from '../src/game/math';
import type { MatchState } from '../src/game/types';
import { drive, played, seat } from './support';
function tick(s: MatchState, seconds: number) {
  for (let t = 0; t < Math.ceil(seconds / RULES.fixedStep); t++) stepMatch(s);
}
function openIce() {
  const s = createMatch();
  s.phase = 'playing';
  s.skaters.forEach((p, i) => {
    p.x = -20 + (i % 6) * 3;
    p.z = p.team ? -10 : 10;
    p.cooldown = 10;
  });
  return s;
}
describe('match rules', () => {
  it('starts with two teams, five skaters and a goalie per team', () => {
    const s = createMatch();
    expect(s.skaters).toHaveLength(12);
    expect(s.skaters.filter((p) => p.role === 'G')).toHaveLength(2);
    expect(s.clock).toBe(300);
  });
  it('keeps the period clock frozen during faceoff and pause', () => {
    const s = createMatch();
    startMatch(s);
    tick(s, 2);
    expect(s.clock).toBe(300);
    expect(s.phase).toBe('faceoff');
    togglePause(s);
    const countdown = s.countdown;
    tick(s, 4);
    expect(s.countdown).toBe(countdown);
    togglePause(s);
    tick(s, 1.1);
    expect(s.phase).toBe('playing');
    expect(s.clock).toBeLessThan(300);
  });
  it('plays three five-minute periods, reverses ends and ends a tie as a draw', () => {
    const s = createMatch();
    for (let period = 1; period <= 3; period++) {
      expect(s.period).toBe(period);
      expect(s.clock).toBe(300);
      s.phase = 'playing';
      s.clock = 0.01;
      tick(s, 0.02);
      expect(s.phase).toBe(period < 3 ? 'intermission' : 'final');
      if (period < 3) {
        const dir = attackDirection(0, s.period);
        nextPeriod(s);
        expect(attackDirection(0, s.period)).toBe(-dir);
        expect(s.phase).toBe('faceoff');
      }
    }
    expect(s.score).toEqual([0, 0]);
    tick(s, 10);
    expect(s.clock).toBe(0);
  });
});
describe('puck physics', () => {
  it('counts a fast swept goal once and resets to center ice', () => {
    const s = openIce();
    Object.assign(s.puck, { x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1 });
    stepMatch(s);
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('goal');
    tick(s, RULES.goalSeconds - 1);
    expect(s.score).toEqual([1, 0]);
    tick(s, 1.1);
    expect(s.phase).toBe('faceoff');
    expect(s.puck.x).toBe(0);
  });
  it('keeps skating after a goal instead of freezing the play', () => {
    const s = openIce();
    Object.assign(s.puck, { x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1 });
    for (const p of s.skaters) {
      p.vx = 5;
      p.cooldown = 10;
    }
    stepMatch(s);
    expect(s.phase).toBe('goal');
    expect(s.puck.vx).not.toBe(0);
    const clock = s.clock;
    const before = s.skaters.map((p) => p.x);
    tick(s, 0.45);
    expect(s.phase).toBe('goal');
    expect(s.clock).toBe(clock);
    expect(s.score).toEqual([1, 0]);
    expect(s.puck.x).toBeGreaterThan(RINK.goalX);
    expect(s.puck.x).toBeLessThan(RINK.goalX + 1.55);
    expect(s.skaters.some((p, i) => Math.abs(p.x - before[i]) > 0.05)).toBe(true);
  });
  it('credits the correct team after switching ends', () => {
    const s = openIce();
    s.period = 2;
    Object.assign(s.puck, { x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1 });
    stepMatch(s);
    expect(s.score).toEqual([0, 1]);
  });
  it('does not score wide, high, or from behind the goal', () => {
    for (const scenario of [
      { x: 25.8, z: 3, y: 0.4, vx: 44 },
      { x: 25.8, z: 0, y: 2, vx: 44 },
      { x: 26.2, z: 0, y: 0.4, vx: -44 },
    ]) {
      const s = openIce();
      Object.assign(s.puck, scenario, { lockout: 1 });
      stepMatch(s);
      expect(s.score).toEqual([0, 0]);
    }
  });
  it('rebounds off a post and rounded boards', () => {
    const s = openIce();
    Object.assign(s.puck, { x: 25.8, z: 1.8, y: 0.4, vx: 44, lockout: 1 });
    stepMatch(s);
    expect(s.puck.vx).toBeLessThan(0);
    expect(s.events.some((e) => e.type === 'post')).toBe(true);
    Object.assign(s.puck, { x: 0, z: 12.8, y: 0.13, vx: 0, vz: 20, lockout: 1 });
    stepMatch(s);
    expect(s.puck.vz).toBeLessThan(0);
    const corner = { x: 29, z: 12 };
    const n = constrainToRink(corner, 0.2);
    expect(n).not.toBeNull();
    expect(Math.hypot(corner.x - 23, corner.z - 6)).toBeCloseTo(6.8);
  });
  it('drops a puck that catches the underside of the crossbar into the net', () => {
    const s = openIce(),
      reach = IRON.radius + IRON.puckFace;
    Object.assign(s.puck, { x: 25.8, z: 0.5, y: IRON.crossbarY - reach * 0.8, vx: 30, lockout: 1 });
    for (let i = 0; i < 120 && s.phase === 'playing'; i++) stepMatch(s);
    expect(s.score).toEqual([1, 0]);
    expect(s.events.find((e) => e.type === 'crossbar')?.barDown).toBe(true);
    expect(s.events.find((e) => e.type === 'goal')?.barDown).toBe(true);
  });
  it('rings a square crossbar hit back out', () => {
    const s = openIce();
    Object.assign(s.puck, { x: 25.8, z: 0.5, y: IRON.crossbarY, vx: 30, lockout: 1 });
    for (let i = 0; i < 60; i++) stepMatch(s);
    expect(s.score).toEqual([0, 0]);
    expect(s.puck.vx).toBeLessThan(0);
    const ring = s.events.find((e) => e.type === 'crossbar');
    expect(ring?.barDown).toBeUndefined();
  });
  it('lets a puck go in off the inside of the post', () => {
    const s = openIce(),
      reach = IRON.radius + IRON.puckRim;
    Object.assign(s.puck, {
      x: 25.8,
      z: RINK.goalHalfWidth - reach * 0.8,
      y: 0.4,
      vx: 30,
      lockout: 1,
    });
    for (let i = 0; i < 60 && s.phase === 'playing'; i++) stepMatch(s);
    expect(s.events.some((e) => e.type === 'post')).toBe(true);
    expect(s.score).toEqual([1, 0]);
    expect(s.events.find((e) => e.type === 'goal')?.barDown).toBeUndefined();
  });
  it('rings a post the drawn puck clips, and the corner where the post meets the crossbar', () => {
    for (const at of [
      { z: RINK.goalHalfWidth - IRON.radius - PUCK.radius * 0.9, y: 0.4 },
      { z: RINK.goalHalfWidth + 0.03, y: IRON.crossbarY + 0.03 },
    ]) {
      const s = openIce();
      Object.assign(s.puck, { x: 25.8, ...at, vx: 30, lockout: 1 });
      for (let i = 0; i < 60 && s.phase === 'playing'; i++) stepMatch(s);
      expect(s.events.some((e) => e.type === 'post' || e.type === 'crossbar')).toBe(true);
    }
  });
  it('lands a shot inside its aim circle even while skating across the slot', () => {
    for (let tick = 0; tick < 24; tick++) {
      const s = openIce(),
        p = s.skaters[0];
      Object.assign(p, { x: 16, z: -1, angle: Math.PI / 2, vx: 2, vz: 8 });
      s.tick = tick * 13;
      s.puck.owner = p.id;
      const aimed = netShotTarget(s, p, 0.4, 0.4),
        spread = shotSpread(s, p, 0.3, aimed);
      shootPuck(s, p, 0.3, 0.4, 0.4);
      while (s.puck.x < RINK.goalX - 0.3) stepMatch(s);
      const lead = (RINK.goalX - s.puck.x) / s.puck.vx;
      const z = s.puck.z + s.puck.vz * lead,
        y = s.puck.y + s.puck.vy * lead;
      expect(Math.hypot(z - aimed.z, y - aimed.y)).toBeLessThan(spread + 0.05);
    }
  });
  it('opens the aim circle for skating across the shot and for a backhand', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 16, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
    const set = shotSpread(s, p, 0);
    p.vz = 8;
    const crossing = shotSpread(s, p, 0);
    p.vz = 0;
    p.stickSide = -0.5;
    expect(crossing).toBeGreaterThan(set * 1.5);
    expect(shotSpread(s, p, 0)).toBeGreaterThan(set);
  });
  it('lets the goalie make a save and rebound the puck', () => {
    const s = openIce();
    Object.assign(s.skaters[11], { x: 25, z: 0 });
    Object.assign(s.puck, { x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    tick(s, 0.05);
    expect(s.events.some((e) => e.type === 'save')).toBe(true);
    expect(s.skaters[11].saveTimer).toBeGreaterThan(0);
    expect(s.skaters[11].saveKind).toBe('body');
    expect(s.skaters[11].saveHeight).toBeCloseTo(0.4, 1);
    expect(s.puck.vx).toBeLessThan(0);
    expect(s.score).toEqual([0, 0]);
  });
  it('charges harder shots and passes in the aimed direction', () => {
    const s = createMatch();
    const p = s.skaters[0];
    s.puck.owner = p.id;
    shootPuck(s, p, 0.1);
    const wrist = Math.hypot(s.puck.vx, s.puck.vz);
    s.puck.owner = p.id;
    shootPuck(s, p, 1);
    expect(Math.hypot(s.puck.vx, s.puck.vz)).toBeGreaterThan(wrist);
    expect(s.shots[0]).toBe(2);
    s.puck.owner = p.id;
    passPuck(s, p, 0, -1);
    expect(s.sides[played(s)].controlled).toBe(1);
    expect(s.puck.vz).toBeLessThan(0);
    expect(s.puck.owner).toBeNull();
  });
});
describe('skating and defense', () => {
  it('accelerates smoothly, glides, drains hustle stamina, and recovers it', () => {
    const s = openIce();
    const p = s.skaters[s.sides[played(s)].controlled];
    p.x = 0;
    p.z = 0;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1, hustle: true }));
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(PHYSICS.hustleSpeed);
    expect(p.stamina).toBe(1); // Hustle only drains once the stride opens up.
    const speed = p.vx;
    stepMatch(s);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(speed);
    expect(p.stamina).toBeGreaterThan(0.998);
    for (let i = 0; i < 120; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1, hustle: true }));
    expect(p.stamina).toBeLessThan(0.95);
  });
  it('pivots on the spot at a standstill and carves a wide arc at speed', () => {
    const still = openIce(),
      p = still.skaters[still.sides[played(still)].controlled];
    Object.assign(p, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2 });
    for (let i = 0; i < 30; i++) stepMatch(still, seat(still, { ...EMPTY_INPUT, moveZ: 1 }));
    expect(Math.abs(p.angle)).toBeLessThan(0.15);
    const fast = openIce(),
      q = fast.skaters[fast.sides[played(fast)].controlled];
    Object.assign(q, { x: -10, z: 0, vx: PHYSICS.maxSpeed, vz: 0, angle: Math.PI / 2 });
    for (let i = 0; i < 30; i++) stepMatch(fast, seat(fast, { ...EMPTY_INPUT, moveZ: 1 }));
    expect(q.angle).toBeGreaterThan(0.15);
    expect(Math.hypot(q.vx, q.vz)).toBeGreaterThan(PHYSICS.maxSpeed * 0.65);
    // The velocity follows the skates: little sideways slip relative to the facing.
    const slip = q.vx * -Math.cos(q.angle) + q.vz * Math.sin(q.angle);
    expect(Math.abs(slip)).toBeLessThan(Math.hypot(q.vx, q.vz) * 0.4);
  });
  it('a hard carve at pace scrubs speed but keeps rolling', () => {
    const s = openIce(),
      p = s.skaters[s.sides[played(s)].controlled];
    Object.assign(p, { x: -10, z: 0, vx: PHYSICS.maxSpeed, vz: 0, angle: Math.PI / 2 });
    for (let i = 0; i < 60; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveZ: 1 }));
    const speed = Math.hypot(p.vx, p.vz);
    expect(speed).toBeLessThan(PHYSICS.maxSpeed);
    expect(speed).toBeGreaterThan(PHYSICS.maxSpeed * 0.6);
    expect(p.vz).toBeGreaterThan(p.vx);
  });
  it('reaches a higher top speed while hustling and carrying the puck costs a little', () => {
    const run = (hustle: boolean, carry: boolean) => {
      const s = createMatch(0, 'freeSkate'),
        p = s.skaters[s.sides[played(s)].controlled];
      s.phase = 'playing';
      Object.assign(p, { x: -20, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, stamina: 1 });
      if (carry) s.puck.owner = p.id;
      else Object.assign(s.puck, { owner: null, x: 0, z: -12 });
      for (let i = 0; i < 240; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1, hustle }));
      return Math.hypot(p.vx, p.vz);
    };
    expect(run(true, false)).toBeGreaterThan(run(false, false) + 1);
    expect(run(false, false)).toBeGreaterThan(run(false, true));
    expect(run(false, false)).toBeGreaterThan(PHYSICS.maxSpeed * 0.9);
  });
  it('switches to a nearby teammate on defensive trigger input', () => {
    const s = openIce();
    Object.assign(s.skaters[2], { x: 0, z: 1 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, pass: true }));
    expect(s.sides[played(s)].controlled).toBe(2);
  });
  it('switches to the defender in front of a rush instead of a closer chaser', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 8, z: 0 });
    Object.assign(s.skaters[1], { x: 4, z: 0.4 });
    Object.assign(s.skaters[2], { x: 12, z: 8 });
    Object.assign(s.skaters[3], { x: -8, z: 0.6 });
    Object.assign(s.skaters[4], { x: -10, z: 11 });
    Object.assign(s.skaters[6], { x: 2, z: 0 });
    Object.assign(s.puck, { owner: 6, x: 2, z: 0 });
    drive(s, 0);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, switchPlayer: true }));
    expect(s.sides[played(s)].controlled).toBe(3);
  });
  it('keeps accelerating after a switch instead of coasting to a stop', () => {
    const setup = () => {
      const s = openIce();
      Object.assign(s.skaters[0], { x: 12, z: 8, vx: 0, vz: 0 });
      Object.assign(s.skaters[1], { x: 18, z: 10 });
      Object.assign(s.skaters[2], { x: 16, z: -10 });
      Object.assign(s.skaters[3], { x: -4, z: 0, vx: 6, vz: 0, angle: Math.PI / 2, stamina: 1 });
      Object.assign(s.skaters[4], { x: 18, z: -8 });
      Object.assign(s.skaters[6], { x: 8, z: 0, vx: 3, vz: 0 });
      Object.assign(s.puck, { owner: 6, x: 8, z: 0 });
      drive(s, 0);
      return s;
    };
    const auto = setup();
    stepMatch(auto, seat(auto, { ...EMPTY_INPUT, switchPlayer: true }));
    expect(auto.sides[played(auto)].controlled).toBe(3);
    expect(auto.sides[played(auto)].autoSkate).toBe(true);
    for (let i = 0; i < 24; i++) stepMatch(auto);
    const coast = setup();
    drive(coast, 3);
    for (let i = 0; i < 25; i++) stepMatch(coast);
    expect(auto.skaters[3].vx).toBeGreaterThan(6);
    expect(auto.skaters[3].vx).toBeGreaterThan(coast.skaters[3].vx + 0.35);
  });
  it('steers on the first stick input after a switch', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 12, z: 8, vx: 0, vz: 0 });
    Object.assign(s.skaters[1], { x: 18, z: 10 });
    Object.assign(s.skaters[2], { x: 16, z: -10 });
    Object.assign(s.skaters[3], { x: -4, z: 0, vx: 6, vz: 0, angle: Math.PI / 2, stamina: 1 });
    Object.assign(s.skaters[4], { x: 18, z: -8 });
    Object.assign(s.skaters[6], { x: 8, z: 0, vx: 3, vz: 0 });
    Object.assign(s.puck, { owner: 6, x: 8, z: 0 });
    drive(s, 0);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, switchPlayer: true, moveZ: 1 }));
    expect(s.sides[played(s)].controlled).toBe(3);
    expect(s.sides[played(s)].autoSkate).toBe(false);
    for (let i = 0; i < 12; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveZ: 1 }));
    expect(s.skaters[3].vz).toBeGreaterThan(1.5);
  });
  it('drives through a carrier already in range after a switch instead of easing off', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 12, z: 8, vx: 0, vz: 0 });
    Object.assign(s.skaters[1], { x: 18, z: 10 });
    Object.assign(s.skaters[2], { x: 16, z: -10 });
    Object.assign(s.skaters[3], { x: 0.4, z: 0, vx: 7, vz: 0, angle: Math.PI / 2, stamina: 1 });
    Object.assign(s.skaters[4], { x: 18, z: -8 });
    Object.assign(s.skaters[6], { x: 3.2, z: 0, vx: 4, vz: 0, cooldown: 10 });
    Object.assign(s.puck, { owner: 6, x: 3.2, z: 0 });
    drive(s, 0);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, switchPlayer: true }));
    expect(s.sides[played(s)].controlled).toBe(3);
    for (let i = 0; i < 18; i++) stepMatch(s);
    expect(s.skaters[3].vx).toBeGreaterThan(6.5);
  });
  it('a poke check dislodges enemy possession', () => {
    const s = openIce();
    const a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(b, { x: 0, z: 0, angle: 0, cooldown: 10 });
    // Face to face, so the poker's blade meets the puck on the carrier's blade.
    Object.assign(a, {
      x: 2 * STICK.restSide,
      z: 2 * STICK.restReach,
      angle: Math.PI,
      cooldown: 0,
      stickSide: STICK.restSide,
      stickReach: STICK.restReach,
    });
    const puck = stickTip(b);
    Object.assign(s.puck, { owner: 6, x: puck.x, z: puck.z });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, poke: true }));
    expect(s.puck.owner).toBeNull();
    expect(s.events.some((e) => e.type === 'hit')).toBe(true);
  });
  it('a poke from a body-length away does not steal the puck', () => {
    const s = openIce();
    const a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(b, { x: 0, z: 0, angle: 0, cooldown: 10 });
    Object.assign(a, { x: 0, z: 3.4, angle: Math.PI, cooldown: 0, vx: 0, vz: 0 });
    const puck = stickTip(b);
    Object.assign(s.puck, { owner: 6, x: puck.x, z: puck.z });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, poke: true }));
    expect(s.puck.owner).toBe(6);
  });
  it('chips the puck into space and chips it on net from the slot', () => {
    const dump = openIce();
    const carrier = dump.skaters[0];
    Object.assign(carrier, { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    dump.puck.owner = 0;
    stepMatch(dump, seat(dump, { ...EMPTY_INPUT, chip: true, stickIceX: 1 }));
    expect(dump.puck.owner).toBeNull();
    expect(dump.puck.vx).toBeGreaterThan(10);
    expect(dump.puck.vy).toBeGreaterThan(2);
    expect(dump.puck.shot).toBe(false);
    expect(dump.notice).toBe('CHIP');
    const slot = openIce();
    Object.assign(slot.skaters[0], { x: 20, z: 0, angle: Math.PI / 2, cooldown: 0 });
    slot.puck.owner = 0;
    stepMatch(slot, seat(slot, { ...EMPTY_INPUT, chip: true, stickIceX: 1 }));
    expect(slot.puck.shot).toBe(true);
    expect(slot.shots[0]).toBe(1);
    expect(slot.notice).toBe('CHIP IN');
  });
  it('lifts a saucer pass off the ice', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    s.puck.owner = 0;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, saucer: true, moveX: 1 }));
    expect(s.puck.owner).toBeNull();
    expect(s.puck.vy).toBeGreaterThan(3);
    expect(s.notice).toBe('SAUCER');
  });
  it('dives to block a shot and stick-lifts a nearby carrier', () => {
    const block = openIce();
    const diver = block.skaters[0];
    Object.assign(diver, { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0, vx: 3, vz: 0 });
    Object.assign(block.puck, {
      owner: null,
      x: 1.1,
      z: 0,
      y: 0.35,
      vx: -22,
      vz: 0,
      shot: true,
      lockout: 0,
    });
    stepMatch(block, seat(block, { ...EMPTY_INPUT, dive: true, stickIceX: 1 }));
    expect(diver.diveTimer).toBeGreaterThan(0.5);
    expect(diver.downTimer).toBe(0);
    for (let i = 0; i < 24 && block.puck.shot; i++) stepMatch(block);
    expect(block.puck.shot).toBe(false);
    expect(block.puck.vx).toBeGreaterThan(-10);
    const lift = openIce();
    const thief = lift.skaters[0],
      carrier = lift.skaters[6];
    Object.assign(carrier, { x: 0, z: 0, angle: 0, cooldown: 10 });
    Object.assign(thief, { x: 0.9, z: 0.4, angle: Math.PI, cooldown: 0 });
    const puck = stickTip(carrier);
    Object.assign(lift.puck, { owner: 6, x: puck.x, z: puck.z });
    stepMatch(lift, seat(lift, { ...EMPTY_INPUT, switchPlayer: true }));
    expect(lift.puck.owner).toBe(0);
    expect(lift.notice).toBe('STICK LIFT');
  });
  it('a dive hits the ice then ragdolls, and the body still blocks shots', () => {
    const s = openIce();
    const diver = s.skaters[0];
    Object.assign(diver, { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0, vx: 3, vz: 0 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, dive: true, stickIceX: 1 }));
    expect(diver.downTimer).toBe(0);
    tick(s, PHYSICS.diveLand + 0.04);
    expect(diver.diveTimer).toBeGreaterThan(0);
    expect(diver.downTimer).toBeGreaterThan(GET_UP);
    Object.assign(s.puck, {
      owner: null,
      x: diver.x + 0.35,
      z: diver.z,
      y: 0.32,
      vx: -20,
      vz: 0,
      shot: true,
      lockout: 0,
    });
    for (let i = 0; i < 24 && s.puck.shot; i++) stepMatch(s);
    expect(s.puck.shot).toBe(false);
    expect(s.notice).toBe('DIVE BLOCK');
  });
  it('a skill-stick check and a loose-puck chop both move the play', () => {
    const hit = openIce();
    Object.assign(hit.skaters[0], {
      x: 0,
      z: 0,
      vx: 4,
      vz: 0,
      angle: Math.PI / 2,
      rush: 0,
      cooldown: 0,
    });
    Object.assign(hit.skaters[6], { x: 1, z: 0, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    hit.puck.owner = 6;
    stepMatch(hit, seat(hit, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    for (let i = 0; i < 12 && hit.hits[0] === 0; i++) stepMatch(hit);
    expect(hit.hits[0]).toBeGreaterThan(0);
    expect(hit.puck.owner).not.toBe(6);
    const chop = openIce();
    Object.assign(chop.skaters[0], { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(chop.puck, {
      owner: null,
      x: 0.8,
      z: 0,
      y: PUCK.restY,
      vx: 0,
      vz: 0,
      lockout: 0,
    });
    stepMatch(chop, seat(chop, { ...EMPTY_INPUT, chip: true, stickIceX: 1 }));
    expect(chop.puck.vx).toBeGreaterThan(6);
    expect(chop.notice).toBe('CHOP');
  });
  it('remains finite and on the rink through an extended AI match', () => {
    const s = createMatch();
    startMatch(s);
    for (let t = 0; t < 180 / RULES.fixedStep; t++) {
      const ai = decideAI(s, s.skaters[s.sides[played(s)].controlled]);
      stepMatch(
        s,
        seat(s, {
          ...EMPTY_INPUT,
          moveX: ai.move.x,
          moveZ: ai.move.z,
          shoot: ai.shoot,
          shotPower: 0.7,
          stickX: 0.8,
          pass: ai.pass,
          passRelease: ai.pass,
          poke: ai.poke,
        }),
      );
    }
    for (const p of s.skaters) {
      expect(Number.isFinite(p.x + p.z + p.vx + p.vz)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThan(RINK.halfLength);
      expect(Math.abs(p.z)).toBeLessThan(RINK.halfWidth);
    }
    expect(Number.isFinite(s.puck.x + s.puck.y + s.puck.z)).toBe(true);
    expect(s.shots[0] + s.shots[1]).toBeGreaterThan(0);
  });
});

describe('contact, elevation and puck handling', () => {
  /**
   * Skater 0 skates at a puck carrier standing a body-length away. `check` flicks the skill stick
   * at them; `load` is how far it was pulled back first. `braced` squares the carrier up to the hit.
   */
  function collision(
    speed: number,
    {
      teammate = false,
      check = false,
      load = 0,
      braced = false,
      victimVx = 0,
      victimAngle = braced ? -Math.PI / 2 : 0,
      hasPuck = true,
    } = {},
  ) {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[teammate ? 1 : 6];
    Object.assign(a, { x: 0, z: 0, vx: speed, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 1, z: 0, vx: victimVx, vz: 0, angle: victimAngle });
    if (hasPuck) s.puck.owner = b.id;
    else Object.assign(s.puck, { owner: null, x: -12, z: -8 });
    const input = check
      ? { ...EMPTY_INPUT, check: true, checkPower: load, stickIceX: 1 }
      : EMPTY_INPUT;
    stepMatch(s, seat(s, input));
    for (let i = 0; i < 6 && s.hits[0] === 0 && b.hitImmunity <= 0; i++) stepMatch(s);
    return { s, a, b };
  }
  it('a committed check at speed knocks a carrier down and counts one hit', () => {
    const { s, a, b } = collision(9, { check: true });
    expect(b.downTimer).toBeGreaterThan(1);
    expect(b.vx).toBeGreaterThan(5);
    expect(a.vx).toBeGreaterThan(3);
    expect(s.puck.owner).not.toBe(b.id);
    expect(s.hits[0]).toBe(1);
    expect(s.notice).toBe('BIG HIT');
    tick(s, 0.5);
    expect(s.hits[0]).toBe(1);
  });
  it('a knockdown holds the frame for a beat', () => {
    const { s } = collision(10, { check: true });
    expect(s.hitstop).toBeGreaterThan(0);
    Object.assign(s.puck, { vx: 8, lockout: 5 });
    const x = s.puck.x,
      tickBefore = s.tick;
    stepMatch(s);
    expect(s.puck.x).toBe(x);
    expect(s.tick).toBe(tickBefore + 1);
    tick(s, PHYSICS.hitstop + 0.05);
    expect(s.hitstop).toBe(0);
    expect(s.puck.x).toBeGreaterThan(x);
  });
  it('skating into a carrier without checking can rock them but never puts them down', () => {
    const bump = collision(10);
    expect(bump.b.downTimer).toBe(0);
    expect(bump.b.stumbleTimer).toBeGreaterThan(0);
    expect(bump.s.puck.owner).not.toBe(bump.b.id);
    const rub = collision(5);
    expect(rub.b.stumbleTimer).toBe(0);
    expect(rub.b.downTimer).toBe(0);
    expect(rub.s.puck.owner).toBe(rub.b.id);
    expect(rub.s.hits[0]).toBe(0);
    expect(rub.b.vx).toBeGreaterThan(0.3);
  });
  it('rubbing a carrier at matching speed only jostles', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2 });
    Object.assign(b, { x: 0, z: 0.9, vx: 8, vz: 0, angle: Math.PI / 2 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(b.downTimer).toBe(0);
    expect(b.stumbleTimer).toBe(0);
    expect(s.puck.owner).toBe(b.id);
    expect(a.vx).toBeGreaterThan(5);
    expect(s.hits[0]).toBe(0);
  });
  it('a committed shoulder check at matching speed is a knockdown, not a rub', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 0, z: 0.9, vx: 8, vz: 0, angle: Math.PI / 2, cooldown: 10 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, moveX: 1, checkPower: 1 }));
    for (let i = 0; i < 8 && s.hits[0] === 0; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(s.hits[0]).toBe(1);
    expect(b.downTimer).toBeGreaterThan(0);
    expect(s.puck.owner).not.toBe(b.id);
    expect(s.notice).toBe('BIG HIT');
  });
  it('running down a breakaway and connecting knocks the puck loose; loaded, it drops them', () => {
    const chase = collision(12, { check: true, victimVx: 8.8, victimAngle: Math.PI / 2 });
    expect(chase.b.downTimer).toBe(0);
    expect(chase.b.stumbleTimer).toBeGreaterThan(0);
    expect(chase.s.puck.owner).not.toBe(chase.b.id);
    expect(chase.s.hits[0]).toBe(1);
    const loaded = collision(12, { check: true, load: 1, victimVx: 8.8, victimAngle: Math.PI / 2 });
    expect(loaded.b.downTimer).toBeGreaterThan(0);
    // Without a flick, catching up from behind is only a rub.
    const bump = collision(12, { victimVx: 8.8, victimAngle: Math.PI / 2 });
    expect(bump.b.stumbleTimer).toBe(0);
    expect(bump.s.puck.owner).toBe(bump.b.id);
    expect(bump.s.hits[0]).toBe(0);
  });
  it('a flick thrown a hair early fires when the body is free', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 9, vz: 0, angle: Math.PI / 2, cooldown: 0.12 });
    Object.assign(b, { x: 2.6, z: 0, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.checkTimer).toBe(0);
    expect(a.queuedCheck).not.toBeNull();
    for (let i = 0; i < 40 && s.hits[0] === 0; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(a.queuedCheck).toBeNull();
    expect(s.hits[0]).toBe(1);
  });
  it('a live check reaches an opponent crossing just outside body contact', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 9, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 2.4, z: 1.3, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.hitLock).toBe(b.id);
    for (let i = 0; i < 40 && s.hits[0] === 0; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(s.hits[0]).toBe(1);
  });
  it('a standing flick is a shove on a braced carrier and never a knockdown', () => {
    const braced = collision(0, { check: true, braced: true });
    expect(braced.b.downTimer).toBe(0);
    expect(braced.b.stumbleTimer).toBe(0);
    expect(braced.s.puck.owner).toBe(braced.b.id);
    expect(braced.s.hits[0]).toBe(0);
    expect(braced.b.vx).toBeGreaterThan(0.5);
    const blindside = collision(0, { check: true });
    expect(blindside.b.downTimer).toBe(0);
    const creeping = collision(3);
    expect(creeping.b.stumbleTimer).toBe(0);
    expect(creeping.s.puck.owner).toBe(creeping.b.id);
    expect(creeping.s.hits[0]).toBe(0);
  });
  it('closing speed decides the hit: shove, stagger, then knockdown', () => {
    const shove = collision(0, { check: true, braced: true });
    expect(shove.s.hits[0]).toBe(0);
    expect(shove.b.stumbleTimer).toBe(0);
    const stagger = collision(3, { check: true, braced: true });
    expect(stagger.b.downTimer).toBe(0);
    expect(stagger.b.stumbleTimer).toBeGreaterThan(0.4);
    expect(stagger.s.puck.owner).not.toBe(stagger.b.id);
    expect(stagger.s.hits[0]).toBe(1);
    expect(stagger.s.notice).toBe('HIT');
    const dump = collision(8, { check: true, braced: true });
    expect(dump.b.downTimer).toBeGreaterThan(1);
  });
  it('loading a check before the flick hits harder', () => {
    const quick = collision(4, { check: true, braced: true, load: 0 }),
      loaded = collision(4, { check: true, braced: true, load: 1 });
    expect(loaded.b.stumbleTimer + loaded.b.downTimer).toBeGreaterThan(
      quick.b.stumbleTimer + quick.b.downTimer,
    );
    expect(loaded.a.stamina).toBeLessThan(quick.a.stamina);
  });
  it('squaring up softens a hit and a carrier mid-deke is exposed', () => {
    const open = collision(8, { check: true });
    const braced = collision(8, { check: true, braced: true });
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 1, z: 0, vx: 0, vz: 0, angle: 0, dekeKind: 'stride', dekeTimer: 0.1 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(braced.b.downTimer).toBeGreaterThan(0);
    expect(open.b.downTimer).toBeGreaterThan(braced.b.downTimer);
    expect(b.downTimer).toBeGreaterThan(open.b.downTimer);
  });
  it('a check lands from the front or the side; from behind it strips the puck without a knockdown', () => {
    const side = collision(8, { check: true });
    const front = collision(8, { check: true, braced: true });
    const back = collision(8, { check: true, victimVx: 7, victimAngle: Math.PI / 2 });
    expect(side.s.hits[0]).toBe(1);
    expect(front.s.hits[0]).toBe(1);
    expect(side.b.downTimer).toBeGreaterThan(0);
    expect(front.b.downTimer).toBeGreaterThan(0);
    expect(back.b.downTimer).toBe(0);
    expect(back.b.vx).toBeGreaterThan(7);
    expect(back.s.puck.owner).not.toBe(back.b.id);
  });
  it('a check that finds nothing leaves you overextended', () => {
    const s = openIce(),
      a = s.skaters[0];
    Object.assign(a, { x: 0, z: 0, vx: 6, vz: 0, angle: Math.PI / 2, cooldown: 0, stamina: 1 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.checkTimer).toBeGreaterThan(0.3);
    expect(a.vx).toBeGreaterThan(8);
    expect(a.stamina).toBeLessThan(1);
    tick(s, PHYSICS.checkWindow);
    expect(a.checkTimer).toBe(0);
    expect(a.stumbleTimer).toBeGreaterThan(0.15);
    expect(a.cooldown).toBeGreaterThan(0.2);
  });
  it('a live check steers onto a near miss and still connects', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 9, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 3, z: 0.95, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.hitLock).toBe(b.id);
    for (let i = 0; i < 60 && s.hits[0] === 0; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(s.hits[0]).toBe(1);
    expect(b.downTimer + b.stumbleTimer).toBeGreaterThan(0.4);
  });
  it('nobody is steered into a hit they did not throw', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 9, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 3, z: 1.4, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    s.puck.owner = b.id;
    for (let i = 0; i < 60; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(a.hitLock).toBe(-1);
    expect(Math.abs(a.z)).toBeLessThan(0.15);
    expect(s.hits[0]).toBe(0);
  });
  it('two committed checks head-on: the heavier momentum wins', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, {
      x: 1,
      z: 0,
      vx: -5,
      vz: 0,
      angle: -Math.PI / 2,
      checkTimer: PHYSICS.checkWindow,
      checkLanded: false,
    });
    Object.assign(s.puck, { owner: null, x: -12, z: -8 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.downTimer).toBe(0);
    expect(b.downTimer + b.stumbleTimer).toBeGreaterThan(0.4);
    expect(s.hits[0]).toBe(1);
    expect(s.hits[1]).toBe(0);
  });
  it('a carrier who skates into a set defender loses the puck', () => {
    const s = openIce(),
      d = s.skaters[0],
      c = s.skaters[6];
    Object.assign(d, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 10 });
    Object.assign(c, { x: 1, z: 0, vx: -9, vz: 0, angle: -Math.PI / 2 });
    s.puck.owner = c.id;
    stepMatch(s);
    expect(c.stumbleTimer).toBeGreaterThan(0);
    expect(c.downTimer).toBe(0);
    expect(s.puck.owner).not.toBe(c.id);
    expect(d.stumbleTimer).toBe(0);
    expect(s.hits[0]).toBe(1);
    expect(s.notice).toBe('STOOD UP');
  });
  it('a check can dump any opponent, not only the carrier, and a goalie only gets rocked', () => {
    const open = collision(10, { check: true, hasPuck: false });
    expect(open.b.downTimer).toBeGreaterThan(1);
    expect(open.s.hits[0]).toBe(1);
    const g = openIce(),
      hitter = g.skaters[0],
      goalie = g.skaters.find((p) => p.team === 1 && p.role === 'G')!;
    Object.assign(hitter, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(goalie, { x: 1, z: 0, vx: 0, vz: 0, angle: 0, cooldown: 0 });
    stepMatch(g, seat(g, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(goalie.downTimer).toBe(0);
    expect(goalie.stumbleTimer).toBeGreaterThan(0.4);
    expect(g.hits[0]).toBe(1);
  });
  it('the poke button does not turn a nearby bump into a hit', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 3, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 1, z: 0, vx: 0, vz: 0, angle: 0 });
    s.puck.owner = b.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, poke: true }));
    expect(s.hits[0]).toBe(0);
    expect(b.downTimer).toBe(0);
    expect(s.puck.owner).toBe(b.id);
  });
  it('tapping a poke without skating speed does not take the puck', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 1.05, z: 0, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    const puck = stickTip(b);
    Object.assign(s.puck, { owner: 6, x: puck.x, z: puck.z });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, poke: true }));
    expect(s.hits[0]).toBe(0);
    expect(b.downTimer).toBe(0);
    expect(b.stumbleTimer).toBe(0);
    expect(s.puck.owner).toBe(6);
  });
  it('harder checks send the victim farther and keep them down longer', () => {
    const slow = collision(5, { check: true }),
      fast = collision(9, { check: true });
    expect(fast.b.downTimer).toBeGreaterThan(slow.b.downTimer);
    expect(fast.b.vx).toBeGreaterThan(slow.b.vx);
    // Observe a quarter second of the actual slide, while the victim cannot skate.
    for (let i = 0; i < 40; i++) {
      stepMatch(slow.s);
      stepMatch(fast.s);
    }
    expect(fast.b.x).toBeGreaterThan(slow.b.x + 0.25);
  });
  it('gentle contact and teammates do not cause knockdowns', () => {
    expect(collision(1).b.downTimer).toBe(0);
    expect(collision(10, { teammate: true, check: true }).b.downTimer).toBe(0);
  });
  it('downed players cannot shoot or collect the puck, then recover', () => {
    const { s, b } = collision(10, { check: true });
    drive(s, b.id);
    s.puck.owner = b.id;
    shootPuck(s, b, 1);
    expect(s.shots[b.team]).toBe(0);
    s.puck.owner = null;
    s.puck.lockout = 10;
    s.hitstop = 0;
    const timer = b.downTimer;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: -1, shoot: true, pass: true }));
    expect(b.downTimer).toBeLessThan(timer);
    tick(s, 4);
    expect(b.downTimer).toBe(0);
  });
  it('high and low wrist shots reach different heights at the goal line', () => {
    const heights = [0, 1].map((height) => {
      const s = openIce(),
        p = s.skaters[0];
      Object.assign(p, { x: 16, z: 0, vx: 0, vz: 0 });
      s.puck.owner = p.id;
      shootPuck(s, p, 0, 0.8, height);
      while (s.phase === 'playing' && s.puck.x < RINK.goalX) stepMatch(s);
      expect(s.score[0]).toBe(1);
      return s.puck.y;
    });
    expect(heights[0]).toBeLessThan(0.35);
    expect(heights[1]).toBeGreaterThan(0.9);
    expect(heights[1]).toBeLessThan(RINK.goalHeight);
  });
  it('places shots in opposite corners of the net', () => {
    const s = openIce(),
      p = s.skaters[0];
    const topLeft = netShotTarget(s, p, -1, 1),
      bottomRight = netShotTarget(s, p, 1, 0);
    expect(topLeft.y).toBeGreaterThan(1);
    expect(bottomRight.y).toBeLessThan(0.3);
    expect(topLeft.z).toBeLessThan(bottomRight.z);
  });
  it('releases a backhand from the blade instead of the forehand pocket', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 12, z: 0, angle: Math.PI / 2, vx: 0, vz: 0, cooldown: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    for (let i = 0; i < 50; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: 1 }));
    expect(p.stickSide).toBeLessThan(0);
    const bladeZ = s.puck.z;
    expect(bladeZ).toBeGreaterThan(p.z + 0.3);
    shootPuck(s, p, 0.4, 0, 0.3);
    expect(s.notice).toBe('BACKHAND');
    expect(s.puck.z).toBeGreaterThan(p.z);
    expect(Math.abs(s.puck.z - bladeZ)).toBeLessThan(0.5);
  });
  it('aims across the net from left-stick aim and ignores skating when aim is centered', () => {
    const vz = [-1, 1].map((aim) => {
      const s = openIce(),
        p = s.skaters[0];
      Object.assign(p, { x: 16, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
      s.puck.owner = p.id;
      shootPuck(s, p, 0.2, aim, 0.2);
      return s.puck.vz;
    });
    expect(vz[0]).toBeLessThan(0);
    expect(vz[1]).toBeGreaterThan(0);
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 16, z: 0, angle: Math.PI / 2, cooldown: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, moveZ: 1, shoot: true, shotPower: 0.5, aimZ: 0 }));
    expect(Math.abs(s.puck.vz)).toBeLessThan(Math.abs(s.puck.vx) * 0.25);
  });
  it('tracks left-stick shot aim on the net while carrying', () => {
    const s = openIce(),
      p = s.skaters[0];
    drive(s, p.id);
    s.puck.owner = p.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, aimZ: 0.75, shotHeight: 0.6 }));
    expect(s.sides[played(s)].shotAim).toBeCloseTo(0.75);
    expect(s.sides[played(s)].shotLift).toBeCloseTo(0.6);
  });
  it('sends two identical skill-stick shots on the same tick to the same place', () => {
    const shots = [0, 1].map(() => {
      const s = openIce(),
        p = s.skaters[0];
      Object.assign(p, { x: 16, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
      s.tick = 90;
      s.puck.owner = p.id;
      shootPuck(s, p, 0.35, 0.55, 0.8);
      return [s.puck.vx, s.puck.vz, s.puck.vy];
    });
    expect(shots[0][0]).toBeCloseTo(shots[1][0], 8);
    expect(shots[0][1]).toBeCloseTo(shots[1][1], 8);
    expect(shots[0][2]).toBeCloseTo(shots[1][2], 8);
  });
  it('moves the puck with the skill stick instead of mirroring it', () => {
    const rest = stickCarryTarget(0, 0);
    expect(rest.side).toBeCloseTo(STICK.restSide);
    expect(rest.reach).toBeCloseTo(STICK.restReach);
    expect(stickCarryTarget(1, 0).side).toBeLessThan(-0.35);
    expect(stickCarryTarget(1, 0).reach).toBeGreaterThan(0.9);
    expect(stickCarryTarget(-1, 0).side).toBeGreaterThan(STICK.restSide);
    expect(stickCarryTarget(-1, 0).reach).toBeGreaterThan(0.9);
    const drag = stickCarryTarget(0, 1);
    expect(drag.reach).toBeLessThan(0.35);
    expect(drag.side).toBeGreaterThan(0.4);
  });
  it("dekes the puck to the player's right when the skill stick is pushed right", () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    for (let i = 0; i < 40; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: 1 }));
    expect(p.stickSide).toBeLessThan(0);
    expect(s.puck.z).toBeGreaterThan(p.z + 0.3);
    expect(s.puck.x).toBeCloseTo(p.x + p.stickReach, 2);
    expect(s.puck.z).toBeCloseTo(p.z - p.stickSide, 2);
  });
  it('carries deke momentum instead of snapping to a pose', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    const target = stickCarryTarget(-1, 0);
    for (let i = 0; i < 8; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: -1 }));
    expect(Math.abs(p.stickSide - target.side)).toBeGreaterThan(0.2);
    expect(p.stickSideVel).toBeGreaterThan(1);
    const released = p.stickSide;
    for (let i = 0; i < 6; i++) stepMatch(s);
    expect(p.stickSide).toBeGreaterThan(released);
  });
  it('cuts the skater slightly with a deke', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 4, vz: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    for (let i = 0; i < 30; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: -1 }));
    expect(p.vz).toBeLessThan(-0.15);
    expect(p.vx).toBeGreaterThan(2);
  });
  it('toe drags pull the puck back smoothly without charging a slap shot', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2 });
    s.puck.owner = 0;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: 1 }));
    const reach = p.stickReach;
    for (let i = 0; i < 50; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, stickX: 1, stickY: 1, toeDrag: true }));
    expect(p.stickReach).toBeLessThan(reach - 0.8);
    expect(s.puck.x - p.x).toBeLessThan(0.2);
    expect(s.sides[played(s)].shotCharge).toBe(0);
    expect(s.puck.owner).toBe(0);
    expect(s.puck.x).toBeCloseTo(p.x + p.stickReach, 2);
    expect(s.puck.z).toBeCloseTo(p.z - p.stickSide, 2);
    for (let i = 0; i < 50; i++) stepMatch(s);
    expect(p.stickReach).toBeGreaterThan(0.9);
  });
  it('one-touch dekes cut with the left stick instead of snapping the blade', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 4, vz: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, deke: true, moveZ: 1 }));
    expect(p.dekeKind).toBe('stride');
    expect(p.dekeDir).toBe(1);
    const started = p.stickSide;
    for (let i = 0; i < 8; i++) stepMatch(s);
    expect(p.stickSide).toBeLessThan(started);
    expect(p.stickSideVel).toBeLessThan(-0.4);
    for (let i = 0; i < 36; i++) stepMatch(s);
    expect(s.puck.owner).toBe(p.id);
    expect(p.vz).toBeGreaterThan(0.12);
    expect(s.puck.z).toBeGreaterThan(p.z);
  });
  it('punches the puck ahead or pulls it in from the left-stick one-touch', () => {
    const burst = openIce(),
      b = burst.skaters[0];
    Object.assign(b, { x: 0, z: 0, angle: Math.PI / 2, vx: 4, vz: 0 });
    drive(burst, b.id);
    burst.puck.owner = b.id;
    stepMatch(burst, seat(burst, { ...EMPTY_INPUT, deke: true, moveX: 1 }));
    expect(b.dekeKind).toBe('burst');
    const protect = openIce(),
      q = protect.skaters[0];
    Object.assign(q, { x: 0, z: 0, angle: Math.PI / 2, vx: 3, vz: 0 });
    drive(protect, q.id);
    protect.puck.owner = q.id;
    stepMatch(protect, seat(protect, { ...EMPTY_INPUT, deke: true, moveX: -1 }));
    expect(q.dekeKind).toBe('protect');
  });
  it('drops the puck through the legs then kicks it ahead', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 3, vz: 0 });
    drive(s, p.id);
    s.puck.owner = p.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, dekeSpecial: 'throughLegs' }));
    expect(p.dekeKind).toBe('throughLegs');
    let minReach = p.stickReach;
    for (let i = 0; i < 90; i++) {
      stepMatch(s);
      minReach = Math.min(minReach, p.stickReach);
    }
    expect(minReach).toBeLessThan(0.05);
    expect(s.puck.owner).toBe(p.id);
    expect(p.stickReach).toBeGreaterThan(0.7);
    expect(p.dekeKind).toBeNull();
  });
  it('jumps the puck off the ice and spins without losing it', () => {
    const s = openIce(),
      jumper = s.skaters[0];
    Object.assign(jumper, { x: 0, z: 0, angle: Math.PI / 2, vx: 5, vz: 0 });
    drive(s, jumper.id);
    s.puck.owner = jumper.id;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, dekeSpecial: 'jump' }));
    let peak = s.puck.y;
    for (let i = 0; i < 40; i++) {
      stepMatch(s);
      peak = Math.max(peak, s.puck.y);
    }
    expect(peak).toBeGreaterThan(PUCK.restY + 0.12);
    expect(s.puck.owner).toBe(jumper.id);

    const spin = openIce(),
      p = spin.skaters[0];
    const facing = Math.PI / 2;
    Object.assign(p, { x: 0, z: 0, angle: facing, vx: 4, vz: 0 });
    drive(spin, p.id);
    spin.puck.owner = p.id;
    stepMatch(spin, seat(spin, { ...EMPTY_INPUT, dekeSpecial: 'spin' }));
    expect(p.dekeKind).toBe('spin');
    tick(spin, dekeDuration('spin') + RULES.fixedStep);
    expect(p.dekeKind).toBeNull();
    expect(spin.puck.owner).toBe(p.id);
    expect(Math.sin(p.angle)).toBeGreaterThan(0.95);
    expect(
      Math.abs(Math.atan2(Math.sin(p.angle - facing), Math.cos(p.angle - facing))),
    ).toBeLessThan(0.2);
  });
});

it('AI pursues the puck when the nearest teammate is down, and passes skip downed receivers', () => {
  const s = openIce();
  Object.assign(s.puck, { x: 0, z: 0, owner: null });
  Object.assign(s.skaters[0], { x: 0, z: 0, downTimer: 2 });
  Object.assign(s.skaters[1], { x: -4, z: 0 });
  expect(decideAI(s, s.skaters[0]).move).toEqual({ x: 0, z: 0 });
  const pursuit = decideAI(s, s.skaters[1]).move;
  expect(pursuit.x).toBeGreaterThan(0);
  expect(pursuit.z).toBe(0);
  s.puck.owner = 1;
  s.skaters.filter((p) => p.team === 0 && p.id !== 1).forEach((p) => (p.downTimer = 2));
  expect(() => passPuck(s, s.skaters[1], 1, 0)).not.toThrow();
  expect(s.puck.owner).toBeNull();
  expect(s.puck.vx).toBeGreaterThan(0);
});
describe('aimed passing', () => {
  it('holds a pass until the trigger is released', () => {
    const s = openIce();
    const p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(s.skaters[1], { x: 0, z: -8, vx: 0, vz: 0, cooldown: 0 });
    drive(s, 0);
    s.puck.owner = 0;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, pass: true, passHeld: true, moveZ: -1 }));
    expect(s.puck.owner).toBe(0);
    expect(s.sides[played(s)].passHeld).toBe(true);
    expect(s.sides[played(s)].passTarget).toBe(1);
    expect(s.sides[played(s)].passAim.z).toBeLessThan(0);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, passRelease: true, moveZ: -1 }));
    expect(s.puck.owner).toBeNull();
    expect(s.sides[played(s)].controlled).toBe(1);
    expect(s.puck.vz).toBeLessThan(0);
  });
  it('passes to the aimed teammate instead of the closest one', () => {
    const s = openIce();
    const p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(s.skaters[1], { x: 0, z: -3, vx: 0, vz: 0, cooldown: 0 });
    Object.assign(s.skaters[2], { x: 0, z: 10, vx: 0, vz: 0, cooldown: 0 });
    s.skaters
      .filter((q) => q.team === 0 && q.role !== 'G' && q.id > 2)
      .forEach((q) => Object.assign(q, { x: -12, z: 0 }));
    drive(s, 0);
    s.puck.owner = 0;
    passPuck(s, p, 0, 1);
    expect(s.sides[played(s)].controlled).toBe(2);
    expect(s.puck.vz).toBeGreaterThan(0);
  });
  it('dumps the puck into space when no teammate is in the aim cone', () => {
    const s = openIce();
    const p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    s.skaters
      .filter((q) => q.team === 0 && q.id !== 0 && q.role !== 'G')
      .forEach((q) => Object.assign(q, { x: -10, z: 0, vx: 0, vz: 0 }));
    drive(s, 0);
    s.puck.owner = 0;
    passPuck(s, p, 1, 0);
    expect(s.puck.owner).toBeNull();
    expect(s.sides[played(s)].controlled).toBe(0);
    expect(s.puck.vx).toBeGreaterThan(0);
  });
  it('hops a defender in the lane so the aimed teammate still takes the pass', () => {
    const s = openIce();
    const passer = s.skaters[0],
      receiver = s.skaters[1],
      thief = s.skaters[6];
    Object.assign(passer, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(receiver, { x: 0, z: -10, vx: 0, vz: 0, cooldown: 0 });
    Object.assign(thief, { x: 0, z: -4, vx: 0, vz: 0, cooldown: 0, angle: 0 });
    s.skaters
      .filter((q) => q.id !== passer.id && q.id !== receiver.id && q.id !== thief.id)
      .forEach((q) => Object.assign(q, { x: -18, z: 10, cooldown: 10 }));
    drive(s, passer.id);
    s.puck.owner = passer.id;
    passPuck(s, passer, 0, -1);
    expect(s.puck.passTo).toBe(receiver.id);
    expect(s.puck.vy).toBeGreaterThan(2.5);
    expect(s.notice).toBe('PASS');
    for (let i = 0; i < 160 && s.puck.owner === null; i++) stepMatch(s);
    expect(s.puck.owner).toBe(receiver.id);
  });
  it('does not let a stick in the lane vacuum a tape-to-tape pass', () => {
    const s = openIce();
    const receiver = s.skaters[1],
      thief = s.skaters[6];
    Object.assign(receiver, { x: 0, z: -8, vx: 0, vz: 0, cooldown: 0, angle: Math.PI / 2 });
    Object.assign(thief, { x: 0.7, z: 0, vx: 0, vz: 0, cooldown: 0, angle: Math.PI });
    s.skaters
      .filter((q) => q.id !== receiver.id && q.id !== thief.id)
      .forEach((q) => Object.assign(q, { x: -18, z: 10, cooldown: 10 }));
    drive(s, receiver.id);
    Object.assign(s.puck, {
      owner: null,
      x: 0,
      z: 0,
      y: 0.13,
      vx: 0,
      vz: -18,
      vy: 0,
      shot: false,
      lockout: 0,
      lastTouch: 0,
      passTo: receiver.id,
    });
    stepMatch(s);
    expect(s.puck.owner).not.toBe(thief.id);
  });
});
describe('tighter gameplay', () => {
  it('wins a timed faceoff draw and loses an early strike', () => {
    const won = createMatch();
    startMatch(won);
    tick(won, 2.7);
    stepMatch(won, seat(won, { ...EMPTY_INPUT, pass: true }));
    tick(won, 0.5);
    expect(won.phase).toBe('playing');
    expect(won.puck.owner).toBe(played(won) * 6);
    const lost = createMatch();
    startMatch(lost);
    stepMatch(lost, seat(lost, { ...EMPTY_INPUT, poke: true }));
    tick(lost, 3.2);
    expect(lost.phase).toBe('playing');
    expect(lost.puck.owner).toBe((1 - played(lost)) * 6);
  });
  it('hockey-stops faster than it coasts', () => {
    const coast = openIce(),
      stop = openIce();
    for (const s of [coast, stop]) {
      Object.assign(s.skaters[s.sides[played(s)].controlled], { x: 0, z: 0, vx: 0, vz: 0 });
      for (let i = 0; i < 90; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    }
    const launched = coast.skaters[coast.sides[played(coast)].controlled].vx;
    expect(launched).toBeGreaterThan(4);
    for (let i = 0; i < 40; i++) {
      stepMatch(coast);
      stepMatch(stop, seat(stop, { ...EMPTY_INPUT, moveX: -1 }));
    }
    expect(stop.skaters[stop.sides[played(stop)].controlled].vx).toBeLessThan(
      coast.skaters[coast.sides[played(coast)].controlled].vx - 1.5,
    );
    expect(coast.skaters[coast.sides[played(coast)].controlled].vx).toBeGreaterThan(2);
  });
  it('does not dump shots from the defensive zone, and prefers a slot look', () => {
    const s = openIce();
    const p = s.skaters[0];
    Object.assign(p, { x: -16, z: 0, cooldown: 0, angle: Math.PI / 2 });
    s.puck.owner = 0;
    expect(decideAI(s, p).shoot).toBe(false);
    Object.assign(p, { x: 20, z: 0 });
    Object.assign(s.skaters[11], { x: 25.2, z: 1.1 });
    s.skaters
      .filter((q) => q.team === 1 && q.role !== 'G')
      .forEach((q) => {
        q.x = -8;
        q.z = 10;
      });
    expect(decideAI(s, p).shoot).toBe(true);
  });
  it('lets the controlled skater win a 50/50 loose puck over a teammate', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 0.4, z: 0, cooldown: 0, angle: Math.PI / 2 });
    Object.assign(s.skaters[1], { x: -0.2, z: 0, cooldown: 0, angle: Math.PI / 2 });
    drive(s, 0);
    Object.assign(s.puck, { x: 0, z: 0, owner: null, shot: false, lockout: 0, vx: 0, vz: 0 });
    stepMatch(s);
    expect(s.puck.owner).toBe(0);
  });
  it('does not save a far-side shot when the goalie is cheating', () => {
    const s = openIce();
    Object.assign(s.skaters[11], { x: 25, z: 1.25 });
    Object.assign(s.puck, { x: 24.6, z: -1.45, y: 0.35, vx: 32, vz: 0, shot: true, lockout: 0 });
    while (s.phase === 'playing' && s.puck.x < RINK.goalX && s.score[0] === 0) stepMatch(s);
    expect(s.events.some((e) => e.type === 'save')).toBe(false);
    expect(s.score[0]).toBe(1);
  });
  it('opens a one-timer window off a tape-to-tape pass', () => {
    const s = openIce();
    const passer = s.skaters[0],
      receiver = s.skaters[1];
    Object.assign(passer, { x: 0, z: 0, vx: 0, vz: 0, cooldown: 0 });
    Object.assign(receiver, { x: 0, z: -8, vx: 0, vz: 0, cooldown: 0 });
    s.puck.owner = passer.id;
    passPuck(s, passer, 0, -1);
    expect(s.puck.owner).toBeNull();
    Object.assign(s.puck, { x: receiver.x + 0.2, z: receiver.z, y: 0.13, lockout: 0 });
    receiver.cooldown = 0;
    stepMatch(s);
    expect(s.puck.owner).toBe(receiver.id);
    expect(receiver.passTimer).toBeGreaterThan(0.2);
    const before = Math.hypot(s.puck.vx, s.puck.vz);
    s.puck.owner = receiver.id;
    shootPuck(s, receiver, 0.2);
    expect(Math.hypot(s.puck.vx, s.puck.vz)).toBeGreaterThan(before);
    expect(s.events.some((e) => e.type === 'shot')).toBe(true);
  });
});

describe('free skate', () => {
  function skate(homeTeam: 0 | 1 = 0) {
    const s = createMatch(homeTeam, 'freeSkate');
    startMatch(s);
    return s;
  }
  it('starts at center ice with the puck against the opposing goalie', () => {
    const s = skate();
    expect(s.phase).toBe('playing');
    expect(s.puck.owner).toBe(s.sides[played(s)].controlled);
    expect(s.skaters[s.sides[played(s)].controlled].x).toBe(0);
    expect(s.skaters[s.sides[played(s)].controlled].z).toBe(0);
    const onIce = s.skaters.filter((p) => isOnIce(s, p));
    expect(onIce).toHaveLength(2);
    expect(onIce.some((p) => p.id === s.sides[played(s)].controlled)).toBe(true);
    expect(onIce.some((p) => p.role === 'G' && p.team !== played(s))).toBe(true);
  });
  it('does not run the period clock or end the session', () => {
    const s = skate();
    tick(s, 2);
    expect(s.clock).toBe(300);
    expect(s.phase).toBe('playing');
    s.clock = 0.01;
    tick(s, 0.05);
    expect(s.phase).toBe('playing');
  });
  it('resets to center ice after a goal', () => {
    const s = skate();
    Object.assign(s.puck, { owner: null, x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1 });
    s.skaters
      .filter((p) => p.role === 'G')
      .forEach((p) => {
        p.z = 8;
      });
    stepMatch(s);
    expect(s.phase).toBe('goal');
    expect(s.score).toEqual([0, 0]);
    tick(s, 1.7);
    expect(s.phase).toBe('playing');
    expect(s.puck.owner).toBe(s.sides[played(s)].controlled);
    expect(s.skaters[s.sides[played(s)].controlled].x).toBe(0);
    expect(s.skaters[s.sides[played(s)].controlled].z).toBe(0);
  });
  it('lets a save rebound without stopping play', () => {
    const s = skate();
    const goalie = s.skaters.find((p) => p.role === 'G' && p.team !== played(s))!;
    Object.assign(goalie, { x: 25, z: 0 });
    Object.assign(s.puck, { owner: null, x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    tick(s, 0.05);
    expect(s.events.some((e) => e.type === 'save')).toBe(true);
    expect(s.phase).toBe('playing');
    expect(s.puck.vx).toBeLessThan(0);
    expect(s.score).toEqual([0, 0]);
    expect(s.puck.owner).toBeNull();
  });
  it('does not count an empty-net own goal', () => {
    const s = skate();
    Object.assign(s.puck, { owner: null, x: -25.8, z: 0.8, y: 0.4, vx: -44, lockout: 1 });
    stepMatch(s);
    expect(s.score).toEqual([0, 0]);
    expect(s.phase).toBe('playing');
  });
});

describe('small-ice modes', () => {
  it('puts three skaters and a goalie per side on the ice for 3-on-3', () => {
    const s = createMatch(0, 'threeOnThree');
    const onIce = s.skaters.filter((p) => isOnIce(s, p));
    expect(onIce).toHaveLength(8);
    expect(onIce.filter((p) => p.role === 'G')).toHaveLength(2);
    expect(s.clock).toBe(180);
    expect(onIce.every((p) => Math.abs(p.z) < 20)).toBe(true);
  });
  it('plays three three-minute periods in 3-on-3', () => {
    const s = createMatch(0, 'threeOnThree');
    startMatch(s);
    for (let period = 1; period <= 3; period++) {
      expect(s.period).toBe(period);
      expect(s.clock).toBe(180);
      s.phase = 'playing';
      s.clock = 0.01;
      tick(s, 0.02);
      expect(s.phase).toBe(period < 3 ? 'intermission' : 'final');
      if (period < 3) nextPeriod(s);
    }
  });
  it('puts one skater and a goalie per side on the ice for 1-on-1', () => {
    const s = createMatch(1, 'oneOnOne');
    startMatch(s);
    const onIce = s.skaters.filter((p) => isOnIce(s, p));
    expect(onIce).toHaveLength(4);
    expect(onIce.filter((p) => p.role === 'C')).toHaveLength(2);
    expect(s.sides[played(s)].controlled).toBe(6);
    expect(s.clock).toBe(180);
  });
});

describe('shootout', () => {
  function so() {
    const s = createMatch(0, 'shootout');
    startMatch(s);
    return s;
  }
  it('starts a breakaway with the puck against the opposing goalie', () => {
    const s = so();
    expect(s.phase).toBe('playing');
    expect(s.clock).toBe(15);
    const onIce = s.skaters.filter((p) => isOnIce(s, p));
    expect(onIce).toHaveLength(2);
    expect(onIce.some((p) => p.id === s.sides[played(s)].controlled && p.role === 'C')).toBe(true);
    expect(onIce.some((p) => p.role === 'G' && p.team !== played(s))).toBe(true);
    expect(s.puck.owner).toBe(s.sides[played(s)].controlled);
  });
  it('counts a goal and hands the puck to the other team', () => {
    const s = so();
    Object.assign(s.puck, { owner: null, x: 25.8, z: 0.8, y: 0.4, vx: 44, lockout: 1 });
    s.skaters
      .filter((p) => p.role === 'G')
      .forEach((p) => {
        p.z = 8;
      });
    stepMatch(s);
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('goal');
    tick(s, 2.3);
    expect(s.phase).toBe('playing');
    expect(s.shootoutShooter).toBe(1);
    expect(s.shootoutTaken).toEqual([1, 0]);
    expect(s.skaters[s.sides[played(s)].controlled].role).toBe('G');
    expect(s.puck.owner).not.toBeNull();
    expect(s.skaters[s.puck.owner!].team).toBe(1);
  });
  it('ends a save as a miss and continues the shootout', () => {
    const s = so();
    const goalie = s.skaters.find((p) => p.role === 'G' && p.team !== played(s))!;
    Object.assign(goalie, { x: 25, z: 0 });
    Object.assign(s.puck, { owner: null, x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    tick(s, 0.05);
    expect(s.events.some((e) => e.type === 'save')).toBe(true);
    expect(s.phase).toBe('goal');
    expect(s.scoringTeam).toBeNull();
    expect(s.score).toEqual([0, 0]);
    tick(s, 1.8);
    expect(s.shootoutShooter).toBe(1);
    expect(s.phase).toBe('playing');
  });
  it('ends after three attempts each when the score is not tied', () => {
    const s = so();
    s.score = [1, 0];
    s.shootoutTaken = [2, 3];
    s.shootoutShooter = 0;
    s.shootoutRound = 3;
    s.phase = 'playing';
    s.clock = 0.01;
    tick(s, 0.02);
    expect(s.phase).toBe('goal');
    tick(s, 1.8);
    expect(s.phase).toBe('final');
    expect(s.score).toEqual([1, 0]);
    expect(s.shootoutTaken).toEqual([3, 3]);
  });
  it('keeps going when the first three rounds are tied', () => {
    const s = so();
    s.score = [1, 1];
    s.shootoutTaken = [3, 2];
    s.shootoutShooter = 1;
    s.shootoutRound = 3;
    s.phase = 'playing';
    s.clock = 0.01;
    tick(s, 0.02);
    tick(s, 1.8);
    expect(s.phase).toBe('playing');
    expect(s.shootoutRound).toBe(4);
    expect(s.shootoutShooter).toBe(0);
  });
  it('holds the shot and dekes instead of ripping it from distance', () => {
    const s = so();
    s.shootoutShooter = 1;
    resetFormation(s);
    startMatch(s);
    const shooter = s.skaters.find((p) => p.team === 1 && p.role === 'C')!;
    const dir = attackDirection(1, s.period);
    Object.assign(shooter, { x: dir * 8, z: 0, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
    expect(decideAI(s, shooter).shoot).toBe(false);
    Object.assign(shooter, { x: dir * 20, z: 1.4 });
    const deke = decideAI(s, shooter);
    expect(deke.shoot).toBe(false);
    expect(deke.toeDrag || Math.abs(deke.stickX) > 0.3).toBe(true);
    Object.assign(shooter, { x: dir * 23.2, z: 0.4 });
    expect(decideAI(s, shooter).shoot).toBe(true);
  });
  it('handles the puck on the way in before shooting', () => {
    const s = so();
    s.shootoutShooter = 1;
    resetFormation(s);
    startMatch(s);
    const shooter = s.skaters.find((p) => p.team === 1 && p.role === 'C')!;
    let deked = false,
      shotAt = -1;
    for (let t = 0; t < Math.ceil(8 / RULES.fixedStep); t++) {
      if (s.phase !== 'playing') break;
      stepMatch(s);
      if (
        Math.abs(shooter.stickSide - STICK.restSide) > 0.18 ||
        shooter.stickReach < STICK.restReach - 0.12
      )
        deked = true;
      if (shotAt < 0 && s.events.some((e) => e.type === 'shot')) shotAt = t * RULES.fixedStep;
    }
    expect(deked).toBe(true);
    if (shotAt >= 0) expect(shotAt).toBeGreaterThan(2);
  });
});

describe('goalies', () => {
  /** Open ice with the away goalie set in their crease and the puck loose in front of them. */
  function crease() {
    const s = openIce();
    const g = s.skaters[11];
    Object.assign(g, { x: 24.4, z: 0, cooldown: 0 });
    return { s, g };
  }
  /** A shot that will cross the goalie's plane at `side` (metres toward the glove) and `height`. */
  function shotAt(s: MatchState, from: number, side: number, height: number, speed = 32) {
    const g = s.skaters[11];
    const range = from - 0.3;
    const travel = range / speed;
    // The away goalie faces −x, so their glove (left) is toward +z.
    Object.assign(s.puck, {
      owner: null,
      x: g.x - from,
      z: g.z + side,
      y: height,
      vx: speed,
      vz: 0,
      vy: 4.9 * travel,
      shot: true,
      lockout: 0,
    });
  }
  const saved = (s: MatchState) => s.events.some((e) => e.type === 'save');

  it('reads a shot from distance and throws the glove at it', () => {
    const { s, g } = crease();
    shotAt(s, 14, 1.1, 1.15, 30);
    tick(s, 0.2);
    expect(g.saveKind).toBe('glove');
    expect(g.saveTimer).toBeGreaterThan(0);
    tick(s, 0.4);
    expect(saved(s)).toBe(true);
    expect(s.notice).toBe('GLOVE SAVE');
    expect(s.puck.owner).toBe(g.id);
    expect(g.coverTimer).toBeGreaterThan(0);
    expect(s.score).toEqual([0, 0]);
  });

  it('is beaten by the same snipe from in close, before it can react', () => {
    const { s } = crease();
    shotAt(s, 3.2, 1.2, 1.15, 34);
    while (s.phase === 'playing' && s.score[0] === 0 && s.puck.x < RINK.goalX + 1) stepMatch(s);
    expect(saved(s)).toBe(false);
    expect(s.score[0]).toBe(1);
  });

  it('steers a blocker-side shot to the corner and kicks a low one wide', () => {
    const { s, g } = crease();
    shotAt(s, 12, -0.95, 1.05, 30);
    tick(s, 0.55);
    expect(s.notice).toBe('BLOCKER SAVE');
    expect(s.puck.owner).toBeNull();
    expect(s.puck.vx).toBeLessThan(0);
    // Off the blocker the puck goes away from the glove side, toward that corner.
    expect(s.puck.z).toBeLessThan(g.z - 0.3);
    const low = crease();
    shotAt(low.s, 8, 1.3, 0.2, 30);
    tick(low.s, 0.55);
    expect(low.g.saveKind).toBe('pad');
    expect(low.s.notice).toBe('PAD SAVE');
    expect(low.s.puck.owner).toBeNull();
  });

  it('gets beaten over the pads once committed to a butterfly', () => {
    const { s, g } = crease();
    drive(s, g.id);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, block: true }));
    expect(g.saveKind).toBe('butterfly');
    shotAt(s, 5, 1.05, 1.2, 34);
    while (s.phase === 'playing' && s.score[0] === 0 && s.puck.x < RINK.goalX + 1) stepMatch(s);
    expect(s.score[0]).toBe(1);
  });

  it('lets a human goalie throw a save with a stick flick, the wrong way included', () => {
    const { s, g } = crease();
    drive(s, g.id);
    // The away goalie faces −x; a flick toward +z is toward their glove.
    stepMatch(s, seat(s, { ...EMPTY_INPUT, reach: true, stickIceX: -0.4, stickIceZ: 0.9 }));
    expect(g.saveKind).toBe('glove');
    expect(g.saveSide).toBeGreaterThan(0.5);
    expect(g.saveHeight).toBeGreaterThan(0.7);
    shotAt(s, 6, -1.15, 1.1, 34);
    while (s.phase === 'playing' && s.score[0] === 0 && s.puck.x < RINK.goalX + 1) stepMatch(s);
    expect(s.score[0]).toBe(1);
  });

  it('pushes across on a pad commit and keeps the reach on the same spot', () => {
    const { s, g } = crease();
    drive(s, g.id);
    stepMatch(s, seat(s, { ...EMPTY_INPUT, reach: true, stickIceX: 0, stickIceZ: -1 }));
    expect(g.saveKind).toBe('pad');
    const before = g.saveSide!;
    tick(s, 0.2);
    expect(g.z).toBeLessThan(-0.15);
    expect(g.saveSide!).toBeGreaterThan(before + 0.1);
  });

  it('covers a slow puck in the crease, freezes it, and hands control to that side', () => {
    const { s, g } = crease();
    drive(s, 6);
    Object.assign(s.puck, {
      owner: null,
      x: g.x - 0.7,
      z: 0.2,
      y: PUCK.restY,
      vx: -1.5,
      vz: 0,
      shot: false,
      lockout: 0,
    });
    tick(s, 0.3);
    expect(s.puck.owner).toBe(g.id);
    expect(s.notice).toBe('COVERED');
    expect(s.sides[played(s)].controlled).toBe(g.id);
    const poker = s.skaters[0];
    Object.assign(poker, { x: g.x - 1.2, z: 0.2, angle: Math.PI / 2, cooldown: 0 });
    drive(s, poker.id);
    g.cooldown = 1;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, poke: true }));
    expect(s.puck.owner).toBe(g.id);
    expect(s.notice).not.toBe('POKE CHECK');
  });

  it('lets a CPU goalie hold a covered puck, then move it to a defender', () => {
    const { s, g } = crease();
    Object.assign(s.puck, {
      owner: null,
      x: g.x - 0.7,
      z: 0,
      y: PUCK.restY,
      vx: -1,
      vz: 0,
      shot: false,
      lockout: 0,
    });
    tick(s, 0.3);
    expect(s.puck.owner).toBe(g.id);
    const mate = s.skaters.find((p) => p.team === 1 && p.role === 'LD')!;
    Object.assign(mate, { x: 16, z: -6, cooldown: 0 });
    tick(s, 1.4);
    expect(s.puck.owner).not.toBe(g.id);
    expect(s.puck.lastTouch).toBe(1);
    expect(s.events.some((e) => e.type === 'pass')).toBe(true);
  });

  it('lets a human goalie pass the puck out after a catch', () => {
    const { s, g } = crease();
    drive(s, g.id);
    shotAt(s, 14, 1.1, 1.15, 30);
    tick(s, 0.6);
    expect(s.puck.owner).toBe(g.id);
    const mate = s.skaters.find((p) => p.team === 1 && p.role === 'LD')!;
    Object.assign(mate, { x: 14, z: -4, cooldown: 0 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, passRelease: true, moveX: -1, moveZ: -0.35 }));
    expect(s.puck.owner).toBeNull();
    expect(s.puck.passTo).toBe(mate.id);
    expect(s.sides[played(s)].controlled).toBe(mate.id);
  });

  it('positions on the shooter, comes out for distance, and hugs the post behind the net', () => {
    const { s, g } = crease();
    const shooter = s.skaters[0];
    const carry = (x: number, z: number) => {
      Object.assign(shooter, { x, z, angle: Math.PI / 2, vx: 0, vz: 0 });
      Object.assign(s.puck, { owner: shooter.id, x, z, vx: 0, vz: 0 });
    };
    carry(8, 6);
    const out = decideAI(s, g);
    tick(s, 1.5);
    const outDepth = RINK.goalX - g.x;
    expect(out.move.x).toBeLessThanOrEqual(0.01);
    expect(g.z).toBeGreaterThan(0.3);
    expect(g.z).toBeLessThan(s.puck.z);
    carry(22.5, 1);
    tick(s, 1.5);
    expect(RINK.goalX - g.x).toBeLessThan(outDepth);
    carry(27.5, 1.5);
    tick(s, 1.5);
    expect(g.z).toBeGreaterThan(1);
    expect(RINK.goalX - g.x).toBeLessThan(PHYSICS.playerRadius + 0.05);
  });

  it('ends a shootout attempt on a catch', () => {
    const s = createMatch(0, 'shootout');
    startMatch(s);
    const g = s.skaters.find((p) => p.role === 'G' && p.team === 1)!;
    Object.assign(g, { x: 24.4, z: 0 });
    shotAt(s, 14, 1.1, 1.15, 30);
    tick(s, 0.6);
    expect(s.puck.owner).toBe(g.id);
    expect(s.phase).toBe('goal');
    expect(s.scoringTeam).toBeNull();
  });
});
