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
} from '../src/game/engine';
import {
  attackDirection,
  EMPTY_INPUT,
  PHYSICS,
  PUCK,
  RINK,
  RULES,
  STICK,
} from '../src/game/config';
import { decideAI } from '../src/game/ai';
import { constrainToRink } from '../src/game/math';
import type { MatchState } from '../src/game/types';
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
    tick(s, 3);
    expect(s.score).toEqual([1, 0]);
    tick(s, 1.1);
    expect(s.phase).toBe('faceoff');
    expect(s.puck.x).toBe(0);
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
  it('lets the goalie make a save and rebound the puck', () => {
    const s = openIce();
    Object.assign(s.skaters[11], { x: 25, z: 0 });
    Object.assign(s.puck, { x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    stepMatch(s);
    expect(s.events.some((e) => e.type === 'save')).toBe(true);
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
    expect(s.controlled).toBe(1);
    expect(s.puck.vz).toBeLessThan(0);
    expect(s.puck.owner).toBeNull();
  });
});
describe('skating and defense', () => {
  it('accelerates smoothly, glides, drains hustle stamina, and recovers it', () => {
    const s = openIce();
    const p = s.skaters[s.controlled];
    p.x = 0;
    p.z = 0;
    stepMatch(s, { ...EMPTY_INPUT, moveX: 1, hustle: true });
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(PHYSICS.hustleSpeed);
    expect(p.stamina).toBeLessThan(1);
    const speed = p.vx;
    stepMatch(s);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(speed);
    expect(p.stamina).toBeGreaterThan(0.998);
  });
  it('switches to a nearby teammate on defensive trigger input', () => {
    const s = openIce();
    Object.assign(s.skaters[2], { x: 0, z: 1 });
    stepMatch(s, { ...EMPTY_INPUT, pass: true });
    expect(s.controlled).toBe(2);
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
    s.controlled = 0;
    stepMatch(s, { ...EMPTY_INPUT, switchPlayer: true });
    expect(s.controlled).toBe(3);
  });
  it('a poke check dislodges enemy possession', () => {
    const s = openIce();
    const a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(b, { x: 0, z: 0, angle: 0, cooldown: 10 });
    Object.assign(a, {
      x: 1.16,
      z: 2.1,
      angle: Math.PI,
      cooldown: 0,
      stickSide: STICK.restSide,
      stickReach: STICK.restReach,
    });
    const puck = stickTip(b);
    Object.assign(s.puck, { owner: 6, x: puck.x, z: puck.z });
    stepMatch(s, { ...EMPTY_INPUT, poke: true });
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
    stepMatch(s, { ...EMPTY_INPUT, poke: true });
    expect(s.puck.owner).toBe(6);
  });
  it('chips the puck into space and chips it on net from the slot', () => {
    const dump = openIce();
    const carrier = dump.skaters[0];
    Object.assign(carrier, { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    dump.puck.owner = 0;
    stepMatch(dump, { ...EMPTY_INPUT, chip: true, stickIceX: 1 });
    expect(dump.puck.owner).toBeNull();
    expect(dump.puck.vx).toBeGreaterThan(10);
    expect(dump.puck.vy).toBeGreaterThan(2);
    expect(dump.puck.shot).toBe(false);
    expect(dump.notice).toBe('CHIP');
    const slot = openIce();
    Object.assign(slot.skaters[0], { x: 20, z: 0, angle: Math.PI / 2, cooldown: 0 });
    slot.puck.owner = 0;
    stepMatch(slot, { ...EMPTY_INPUT, chip: true, stickIceX: 1 });
    expect(slot.puck.shot).toBe(true);
    expect(slot.shots[0]).toBe(1);
    expect(slot.notice).toBe('CHIP IN');
  });
  it('lifts a saucer pass off the ice', () => {
    const s = openIce();
    Object.assign(s.skaters[0], { x: 0, z: 0, angle: Math.PI / 2, cooldown: 0 });
    s.puck.owner = 0;
    stepMatch(s, { ...EMPTY_INPUT, saucer: true, moveX: 1 });
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
    stepMatch(block, { ...EMPTY_INPUT, dive: true, stickIceX: 1 });
    expect(diver.diveTimer).toBeGreaterThan(0.5);
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
    stepMatch(lift, { ...EMPTY_INPUT, switchPlayer: true });
    expect(lift.puck.owner).toBe(0);
    expect(lift.notice).toBe('STICK LIFT');
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
    stepMatch(hit, { ...EMPTY_INPUT, check: true, stickIceX: 1 });
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
    stepMatch(chop, { ...EMPTY_INPUT, chip: true, stickIceX: 1 });
    expect(chop.puck.vx).toBeGreaterThan(6);
    expect(chop.notice).toBe('CHOP');
  });
  it('remains finite and on the rink through an extended AI match', () => {
    const s = createMatch();
    startMatch(s);
    for (let t = 0; t < 180 / RULES.fixedStep; t++) {
      const ai = decideAI(s, s.skaters[s.controlled]);
      stepMatch(s, {
        ...EMPTY_INPUT,
        moveX: ai.move.x,
        moveZ: ai.move.z,
        shoot: ai.shoot,
        shotPower: 0.7,
        stickX: 0.8,
        pass: ai.pass,
        passRelease: ai.pass,
        poke: ai.poke,
      });
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
  /** Skater 0 runs into a puck carrier. `rush` is the open-ice speed they carried in. */
  function collision(speed: number, { teammate = false, rush = 0, braced = false } = {}) {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[teammate ? 1 : 6];
    Object.assign(a, { x: 0, z: 0, vx: speed, vz: 0, angle: Math.PI / 2, rush });
    Object.assign(b, { x: 1, z: 0, vx: 0, vz: 0, angle: braced ? -Math.PI / 2 : 0 });
    s.puck.owner = b.id;
    stepMatch(s);
    return { s, a, b };
  }
  it('skating through a carrier at full rush knocks them down and counts one hit', () => {
    const { s, b } = collision(10, { rush: 10 });
    expect(b.downTimer).toBeGreaterThan(1);
    expect(b.vx).toBeGreaterThan(5);
    expect(s.puck.owner).not.toBe(b.id);
    expect(s.hits[0]).toBe(1);
    stepMatch(s);
    expect(s.hits[0]).toBe(1);
  });
  it('rubbing a carrier at matching speed only jostles', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, rush: 8 });
    Object.assign(b, { x: 0, z: 0.9, vx: 8, vz: 0, angle: Math.PI / 2, rush: 8 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(b.downTimer).toBe(0);
    expect(b.stumbleTimer).toBe(0);
    expect(s.puck.owner).toBe(b.id);
    expect(a.vx).toBeGreaterThan(5);
    expect(s.hits[0]).toBe(0);
  });
  it('a skating rush staggers the carrier and knocks the puck loose', () => {
    const { s, b } = collision(7, { rush: 7 });
    expect(b.downTimer).toBe(0);
    expect(b.stumbleTimer).toBeGreaterThan(0.4);
    expect(s.puck.owner).not.toBe(b.id);
    expect(s.hits[0]).toBe(1);
  });
  it('a short run-up only shoves; a real skating check dumps them', () => {
    const shove = collision(5, { rush: 5 });
    expect(shove.b.stumbleTimer).toBe(0);
    expect(shove.b.downTimer).toBe(0);
    expect(shove.s.hits[0]).toBe(0);
    expect(shove.s.puck.owner).toBe(shove.b.id);
    expect(shove.b.vx).toBeGreaterThan(0.5);
    expect(collision(7.5, { rush: 7.5 }).b.downTimer).toBeGreaterThan(1);
    const open = collision(10, { rush: 10 });
    const braced = collision(10, { rush: 10, braced: true });
    expect(open.b.downTimer).toBeGreaterThan(0);
    expect(braced.b.downTimer).toBeGreaterThan(0);
  });
  it('a check lands from the front, side, or behind', () => {
    const side = collision(8, { rush: 8 });
    const front = collision(8, { rush: 8, braced: true });
    const back = openIce();
    const hitter = back.skaters[0],
      victim = back.skaters[6];
    Object.assign(hitter, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, rush: 8 });
    Object.assign(victim, { x: 1, z: 0, vx: 0, vz: 0, angle: Math.PI / 2 });
    back.puck.owner = victim.id;
    stepMatch(back);
    expect(side.s.hits[0]).toBe(1);
    expect(front.s.hits[0]).toBe(1);
    expect(back.hits[0]).toBe(1);
    expect(side.b.downTimer + side.b.stumbleTimer).toBeGreaterThan(0.4);
    expect(front.b.downTimer + front.b.stumbleTimer).toBeGreaterThan(0.4);
    expect(victim.downTimer + victim.stumbleTimer).toBeGreaterThan(0.4);
  });
  it('rushing someone skating at you still lands your hit', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, {
      x: 0,
      z: 0,
      vx: 8,
      vz: 0,
      angle: Math.PI / 2,
      rush: 8,
      hitLock: b.id,
    });
    Object.assign(b, { x: 1, z: 0, vx: -9, vz: 0, angle: -Math.PI / 2, rush: 10 });
    s.puck.owner = null;
    Object.assign(s.puck, { x: -12, z: -8 });
    stepMatch(s);
    expect(a.downTimer).toBe(0);
    expect(b.downTimer + b.stumbleTimer).toBeGreaterThan(0.4);
    expect(s.hits[0]).toBe(1);
  });
  it('checking a rushing puck carrier dumps them instead of getting run over', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, rush: 8 });
    Object.assign(b, { x: 1, z: 0, vx: -9, vz: 0, angle: -Math.PI / 2, rush: 10 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(a.downTimer).toBe(0);
    expect(a.vx).toBeGreaterThan(0);
    expect(b.downTimer).toBeGreaterThan(1);
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).not.toBe(b.id);
  });
  it('skating into a rushing carrier still lands your hit without pre-built rush', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, rush: 0 });
    Object.assign(b, { x: 1, z: 0, vx: -9, vz: 0, angle: -Math.PI / 2, rush: 10 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(a.downTimer).toBe(0);
    expect(a.vx).toBeGreaterThan(0);
    expect(b.downTimer + b.stumbleTimer).toBeGreaterThan(0.4);
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).not.toBe(b.id);
  });
  it('a committed check on a faster carrier still lands', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, {
      x: 0,
      z: 0,
      vx: 6,
      vz: 0,
      angle: Math.PI / 2,
      rush: 4,
      cooldown: 0,
      checkTimer: 0.4,
      hitLock: 6,
    });
    Object.assign(b, { x: 1, z: 0, vx: -10, vz: 0, angle: -Math.PI / 2, rush: 10 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(a.downTimer).toBe(0);
    expect(a.vx).toBeGreaterThan(-1);
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).not.toBe(b.id);
  });
  it('a glancing clip does not reverse the skater who ran into them', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 9, vz: 0, angle: Math.PI / 2, rush: 9 });
    Object.assign(b, { x: 0.3, z: 0.95, vx: 0, vz: 0, angle: 0 });
    s.puck.owner = null;
    Object.assign(s.puck, { x: -12, z: -8 });
    stepMatch(s);
    expect(a.downTimer).toBe(0);
    expect(a.vx).toBeGreaterThan(5);
    expect(s.hits[0]).toBe(0);
  });
  it('a check with no skating speed only shoves', () => {
    const standing = collision(0, { rush: 10 });
    expect(standing.b.downTimer).toBe(0);
    expect(standing.b.stumbleTimer).toBe(0);
    expect(standing.s.puck.owner).toBe(standing.b.id);
    expect(standing.s.hits[0]).toBe(0);
    const creeping = collision(3, { rush: 3 });
    expect(creeping.b.stumbleTimer).toBe(0);
    expect(creeping.s.puck.owner).toBe(creeping.b.id);
    expect(creeping.s.hits[0]).toBe(0);
  });
  it('a chase or side check still knocks the puck loose', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, {
      x: 0,
      z: 0,
      vx: 9,
      vz: 2,
      angle: Math.PI / 2,
      rush: 9,
    });
    Object.assign(b, { x: 0.95, z: 0.2, vx: 7, vz: 0, angle: Math.PI / 2 });
    s.puck.owner = b.id;
    stepMatch(s);
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).not.toBe(b.id);
  });
  it('a committed check locks onto a near miss and still connects', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, rush: 10, cooldown: 0 });
    Object.assign(b, { x: 4.2, z: 1.32, vx: 0, vz: 0, angle: 0, cooldown: 10 });
    s.puck.owner = null;
    Object.assign(s.puck, { x: -12, z: -8 });
    for (let i = 0; i < 80 && s.hits[0] === 0; i++)
      stepMatch(s, { ...EMPTY_INPUT, moveX: 1, hustle: true });
    expect(s.hits[0]).toBe(1);
    expect(b.downTimer + b.stumbleTimer).toBeGreaterThan(0.4);
  });
  it('a check can dump any opponent, including a goalie, not only the puck carrier', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, rush: 10 });
    Object.assign(b, { x: 1, z: 0, vx: 0, vz: 0, angle: 0 });
    s.puck.owner = 8;
    stepMatch(s);
    expect(b.downTimer).toBeGreaterThan(1);
    expect(s.hits[0]).toBe(1);
    const g = openIce(),
      hitter = g.skaters[0],
      goalie = g.skaters.find((p) => p.team === 1 && p.role === 'G')!;
    Object.assign(hitter, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, rush: 10 });
    Object.assign(goalie, { x: 1, z: 0, vx: 0, vz: 0, angle: 0, cooldown: 0 });
    stepMatch(g);
    expect(goalie.downTimer + goalie.stumbleTimer).toBeGreaterThan(0.5);
    expect(g.hits[0]).toBe(1);
  });
  it('the poke button does not turn a nearby bump into a hit', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 3, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 1, z: 0, vx: 0, vz: 0, angle: 0 });
    s.puck.owner = b.id;
    stepMatch(s, { ...EMPTY_INPUT, poke: true });
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
    stepMatch(s, { ...EMPTY_INPUT, poke: true });
    expect(s.hits[0]).toBe(0);
    expect(b.downTimer).toBe(0);
    expect(b.stumbleTimer).toBe(0);
    expect(s.puck.owner).toBe(6);
  });
  it('skating in from open ice lands a hit without a button', () => {
    const s = openIce(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, { x: 6, z: 0, vx: 0, vz: 0, angle: 0 });
    s.puck.owner = b.id;
    for (let i = 0; i < 90 && s.hits[0] === 0; i++)
      stepMatch(s, { ...EMPTY_INPUT, moveX: 1, hustle: true });
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).not.toBe(b.id);
  });
  it('harder checks send the victim farther and keep them down longer', () => {
    const slow = collision(10, { rush: 10 }),
      fast = collision(12, { rush: 12 });
    expect(fast.b.downTimer).toBeGreaterThan(slow.b.downTimer);
    expect(fast.b.vx).toBeGreaterThan(slow.b.vx);
    // Observe a quarter second of the actual slide, while the victim cannot skate.
    for (let i = 0; i < 30; i++) {
      stepMatch(slow.s);
      stepMatch(fast.s);
    }
    expect(fast.b.x).toBeGreaterThan(slow.b.x + 0.4);
  });
  it('gentle contact and teammates do not cause knockdowns', () => {
    expect(collision(1).b.downTimer).toBe(0);
    expect(collision(10, { teammate: true, rush: 10 }).b.downTimer).toBe(0);
  });
  it('downed players cannot shoot or collect the puck, then recover', () => {
    const { s, b } = collision(10, { rush: 10 });
    s.controlled = b.id;
    s.homeTeam = b.team;
    s.puck.owner = b.id;
    shootPuck(s, b, 1);
    expect(s.shots[b.team]).toBe(0);
    s.puck.owner = null;
    s.puck.lockout = 10;
    const timer = b.downTimer;
    stepMatch(s, { ...EMPTY_INPUT, moveX: -1, shoot: true, pass: true });
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
    s.controlled = p.id;
    s.puck.owner = p.id;
    for (let i = 0; i < 50; i++) stepMatch(s, { ...EMPTY_INPUT, stickX: 1 });
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
    s.controlled = p.id;
    s.puck.owner = p.id;
    stepMatch(s, { ...EMPTY_INPUT, moveZ: 1, shoot: true, shotPower: 0.5, aimZ: 0 });
    expect(Math.abs(s.puck.vz)).toBeLessThan(Math.abs(s.puck.vx) * 0.25);
  });
  it('tracks left-stick shot aim on the net while carrying', () => {
    const s = openIce(),
      p = s.skaters[0];
    s.controlled = p.id;
    s.puck.owner = p.id;
    stepMatch(s, { ...EMPTY_INPUT, aimZ: 0.75, shotHeight: 0.6 });
    expect(s.shotAim).toBeCloseTo(0.75);
    expect(s.shotLift).toBeCloseTo(0.6);
  });
  it('sends two identical skill-stick shots to the same place', () => {
    const shots = [3, 90].map((tick) => {
      const s = openIce(),
        p = s.skaters[0];
      Object.assign(p, { x: 16, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
      s.tick = tick;
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
    s.controlled = p.id;
    s.puck.owner = p.id;
    for (let i = 0; i < 40; i++) stepMatch(s, { ...EMPTY_INPUT, stickX: 1 });
    expect(p.stickSide).toBeLessThan(0);
    expect(s.puck.z).toBeGreaterThan(p.z + 0.3);
    expect(s.puck.x).toBeCloseTo(p.x + p.stickReach, 2);
    expect(s.puck.z).toBeCloseTo(p.z - p.stickSide, 2);
  });
  it('carries deke momentum instead of snapping to a pose', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 0, vz: 0 });
    s.controlled = p.id;
    s.puck.owner = p.id;
    const target = stickCarryTarget(-1, 0);
    for (let i = 0; i < 8; i++) stepMatch(s, { ...EMPTY_INPUT, stickX: -1 });
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
    s.controlled = p.id;
    s.puck.owner = p.id;
    for (let i = 0; i < 30; i++) stepMatch(s, { ...EMPTY_INPUT, stickX: -1 });
    expect(p.vz).toBeLessThan(-0.15);
    expect(p.vx).toBeGreaterThan(2);
  });
  it('toe drags pull the puck back smoothly without charging a slap shot', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2 });
    s.puck.owner = 0;
    stepMatch(s, { ...EMPTY_INPUT, stickX: 1 });
    const reach = p.stickReach;
    for (let i = 0; i < 50; i++)
      stepMatch(s, { ...EMPTY_INPUT, stickX: 1, stickY: 1, toeDrag: true });
    expect(p.stickReach).toBeLessThan(reach - 0.8);
    expect(s.puck.x - p.x).toBeLessThan(0.2);
    expect(s.shotCharge).toBe(0);
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
    s.controlled = p.id;
    s.puck.owner = p.id;
    stepMatch(s, { ...EMPTY_INPUT, deke: true, moveZ: 1 });
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
    burst.controlled = b.id;
    burst.puck.owner = b.id;
    stepMatch(burst, { ...EMPTY_INPUT, deke: true, moveX: 1 });
    expect(b.dekeKind).toBe('burst');
    const protect = openIce(),
      q = protect.skaters[0];
    Object.assign(q, { x: 0, z: 0, angle: Math.PI / 2, vx: 3, vz: 0 });
    protect.controlled = q.id;
    protect.puck.owner = q.id;
    stepMatch(protect, { ...EMPTY_INPUT, deke: true, moveX: -1 });
    expect(q.dekeKind).toBe('protect');
  });
  it('drops the puck through the legs then kicks it ahead', () => {
    const s = openIce(),
      p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, angle: Math.PI / 2, vx: 3, vz: 0 });
    s.controlled = p.id;
    s.puck.owner = p.id;
    stepMatch(s, { ...EMPTY_INPUT, dekeSpecial: 'throughLegs' });
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
    s.controlled = jumper.id;
    s.puck.owner = jumper.id;
    stepMatch(s, { ...EMPTY_INPUT, dekeSpecial: 'jump' });
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
    spin.controlled = p.id;
    spin.puck.owner = p.id;
    stepMatch(spin, { ...EMPTY_INPUT, dekeSpecial: 'spin' });
    expect(p.dekeKind).toBe('spin');
    for (let i = 0; i < 90; i++) stepMatch(spin);
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
    s.controlled = 0;
    s.puck.owner = 0;
    stepMatch(s, { ...EMPTY_INPUT, pass: true, passHeld: true, moveZ: -1 });
    expect(s.puck.owner).toBe(0);
    expect(s.passHeld).toBe(true);
    expect(s.passTarget).toBe(1);
    expect(s.passAim.z).toBeLessThan(0);
    stepMatch(s, { ...EMPTY_INPUT, passRelease: true, moveZ: -1 });
    expect(s.puck.owner).toBeNull();
    expect(s.controlled).toBe(1);
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
    s.controlled = 0;
    s.puck.owner = 0;
    passPuck(s, p, 0, 1);
    expect(s.controlled).toBe(2);
    expect(s.puck.vz).toBeGreaterThan(0);
  });
  it('dumps the puck into space when no teammate is in the aim cone', () => {
    const s = openIce();
    const p = s.skaters[0];
    Object.assign(p, { x: 0, z: 0, vx: 0, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    s.skaters
      .filter((q) => q.team === 0 && q.id !== 0 && q.role !== 'G')
      .forEach((q) => Object.assign(q, { x: -10, z: 0, vx: 0, vz: 0 }));
    s.controlled = 0;
    s.puck.owner = 0;
    passPuck(s, p, 1, 0);
    expect(s.puck.owner).toBeNull();
    expect(s.controlled).toBe(0);
    expect(s.puck.vx).toBeGreaterThan(0);
  });
});
describe('tighter gameplay', () => {
  it('wins a timed faceoff draw and loses an early strike', () => {
    const won = createMatch();
    startMatch(won);
    tick(won, 2.7);
    stepMatch(won, { ...EMPTY_INPUT, pass: true });
    tick(won, 0.5);
    expect(won.phase).toBe('playing');
    expect(won.puck.owner).toBe(won.homeTeam * 6);
    const lost = createMatch();
    startMatch(lost);
    stepMatch(lost, { ...EMPTY_INPUT, poke: true });
    tick(lost, 3.2);
    expect(lost.phase).toBe('playing');
    expect(lost.puck.owner).toBe((1 - lost.homeTeam) * 6);
  });
  it('hockey-stops faster than it coasts', () => {
    const coast = openIce(),
      stop = openIce();
    for (const s of [coast, stop]) {
      Object.assign(s.skaters[s.controlled], { x: 0, z: 0, vx: 0, vz: 0 });
      for (let i = 0; i < 90; i++) stepMatch(s, { ...EMPTY_INPUT, moveX: 1 });
    }
    const launched = coast.skaters[coast.controlled].vx;
    expect(launched).toBeGreaterThan(4);
    for (let i = 0; i < 40; i++) {
      stepMatch(coast);
      stepMatch(stop, { ...EMPTY_INPUT, moveX: -1 });
    }
    expect(stop.skaters[stop.controlled].vx).toBeLessThan(coast.skaters[coast.controlled].vx - 1.5);
    expect(coast.skaters[coast.controlled].vx).toBeGreaterThan(2);
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
    s.controlled = 0;
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
    expect(s.puck.owner).toBe(s.controlled);
    expect(s.skaters[s.controlled].x).toBe(0);
    expect(s.skaters[s.controlled].z).toBe(0);
    const onIce = s.skaters.filter((p) => isOnIce(s, p));
    expect(onIce).toHaveLength(2);
    expect(onIce.some((p) => p.id === s.controlled)).toBe(true);
    expect(onIce.some((p) => p.role === 'G' && p.team !== s.homeTeam)).toBe(true);
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
    expect(s.puck.owner).toBe(s.controlled);
    expect(s.skaters[s.controlled].x).toBe(0);
    expect(s.skaters[s.controlled].z).toBe(0);
  });
  it('lets a save rebound without stopping play', () => {
    const s = skate();
    const goalie = s.skaters.find((p) => p.role === 'G' && p.team !== s.homeTeam)!;
    Object.assign(goalie, { x: 25, z: 0 });
    Object.assign(s.puck, { owner: null, x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    stepMatch(s);
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
    expect(s.controlled).toBe(6);
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
    expect(onIce.some((p) => p.id === s.controlled && p.role === 'C')).toBe(true);
    expect(onIce.some((p) => p.role === 'G' && p.team !== s.homeTeam)).toBe(true);
    expect(s.puck.owner).toBe(s.controlled);
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
    expect(s.skaters[s.controlled].role).toBe('G');
    expect(s.puck.owner).not.toBeNull();
    expect(s.skaters[s.puck.owner!].team).toBe(1);
  });
  it('ends a save as a miss and continues the shootout', () => {
    const s = so();
    const goalie = s.skaters.find((p) => p.role === 'G' && p.team !== s.homeTeam)!;
    Object.assign(goalie, { x: 25, z: 0 });
    Object.assign(s.puck, { owner: null, x: 24.1, z: 0.1, y: 0.4, vx: 30, shot: true });
    stepMatch(s);
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
