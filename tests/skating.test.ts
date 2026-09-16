import { describe, expect, it } from 'vitest';
import { createMatch, launchCheck, stepMatch } from '../src/game/engine';
import { skateVelocity, backcheckScales, isBackcheckingRush } from '../src/game/skating';
import { decideAI } from '../src/game/ai';
import { startDeke, stepDeke } from '../src/game/dekes';
import { EMPTY_INPUT, PHYSICS, RULES } from '../src/game/config';
import type { Difficulty, Skater } from '../src/game/types';
import { drive, played, seat } from './support';

const dt = RULES.fixedStep;
const speed = (p: Skater) => Math.hypot(p.vx, p.vz);
function skater(v = 0) {
  const p = createMatch().skaters[0];
  Object.assign(p, { x: 0, z: 0, vx: v, vz: 0, angle: Math.PI / 2 });
  return p;
}
function skate(
  p: Skater,
  seconds: number,
  x: number,
  z: number,
  hustle = false,
  back = false,
  carry = false,
) {
  for (let i = 0; i < Math.round(seconds / dt); i++)
    skateVelocity(p, x, z, hustle, back, dt, carry);
}
function contactRink() {
  const s = createMatch(0, 'oneOnOne');
  s.phase = 'playing';
  // The carrier coasts through a scripted contact while the human check runs through the real engine.
  Object.assign(s.skaters[0], { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, cooldown: 0 });
  Object.assign(s.skaters[6], {
    x: 2.8,
    z: 0,
    vx: 0,
    vz: 0,
    angle: 0,
    cooldown: 10,
    stumbleTimer: 1,
  });
  Object.assign(s.puck, { owner: 6, x: 2.8, z: 0 });
  return s;
}

describe('momentum skating', () => {
  it('earns speed through bounded first strides and cannot sprint-launch faster', () => {
    const normal = skater(),
      hustle = skater();
    for (let i = 0; i < 30; i++) {
      const before = speed(normal);
      skateVelocity(normal, 1, 0, false, false, dt);
      skateVelocity(hustle, 1, 0, true, false, dt);
      expect(speed(normal) - before).toBeLessThanOrEqual(PHYSICS.skateAcceleration * dt + 1e-8);
      expect(speed(hustle)).toBeCloseTo(speed(normal), 6);
    }
    expect(speed(normal)).toBeCloseTo(3, 5);
    skate(hustle, 1.75, 1, 0, true);
    skate(normal, 1.75, 1, 0);
    expect(speed(hustle)).toBeGreaterThan(speed(normal) + 1);
    expect(speed(hustle) - speed(normal)).toBeLessThan(1.7);
  });
  it('has a wider carve at speed, keeps moving, and spends speed to cut', () => {
    const fast = skater(9.6),
      slow = skater(3);
    skate(fast, 0.25, 0, 1);
    skate(slow, 0.25, 0, 1);
    expect(Math.atan2(fast.vz, fast.vx)).toBeLessThan(Math.atan2(slow.vz, slow.vx));
    expect(speed(fast)).toBeGreaterThan(7);
    expect(speed(fast)).toBeLessThan(9.6);
    expect(fast.edgeLean).toBeLessThan(-0.4);
  });
  it('plants a stop before reversing and cannot erase momentum in a frame', () => {
    const p = skater(9);
    skateVelocity(p, -1, 0, true, false, dt);
    expect(p.vx).toBeGreaterThan(8.8);
    skate(p, 0.25, -1, 0, true);
    expect(p.vx).toBeGreaterThan(3);
    skate(p, 0.5, -1, 0, true);
    expect(p.vx).toBeLessThan(-1);
  });
  it('pivots out of backskating without stopping or skating the wrong way', () => {
    const p = skater();
    Object.assign(p, { vx: -6, angle: Math.PI / 2 });
    skateVelocity(p, -1, 0, false, true, dt);
    const before = p.vx;
    skateVelocity(p, -1, 0, true, false, dt);
    expect(p.vx).toBeLessThan(before);
    expect(Math.abs(p.vz)).toBeLessThan(0.01);
    skate(p, 0.5, -1, 0, true);
    expect(p.vx).toBeLessThan(-8);
    expect(Math.sin(p.angle)).toBeLessThan(-0.9);
  });
  it('lets a chaser close on an equally hustling carrier without a catch-up boost', () => {
    // Traffic stride: the carry-hustle tax is the only close. A beaten defender on a rush is
    // capped separately so this does not become a breakaway turbo.
    const defender = skater(8),
      carrier = skater(8);
    let gap = 3;
    for (let i = 0; i < 240; i++) {
      skateVelocity(defender, 1, 0, true, false, dt);
      skateVelocity(carrier, 1, 0, true, false, dt, true);
      gap += (carrier.vx - defender.vx) * dt;
    }
    expect(gap).toBeLessThan(1.8);
    expect(gap).toBeGreaterThan(0.5);
  });
  it('coasts with quiet legs and cannot get stacked turbo speed from repeated dekes', () => {
    const p = skater(9);
    p.skateDrive = 1;
    skate(p, 0.4, 0, 0);
    expect(p.skateDrive).toBeLessThan(0.03);
    expect(speed(p)).toBeGreaterThan(8);
    for (let i = 0; i < 720; i++) {
      if (i % 30 === 0) startDeke(p, 'burst', 0);
      stepDeke(p, dt);
      skateVelocity(p, 1, 0, false, false, dt, true);
      expect(speed(p)).toBeLessThan(PHYSICS.maxSpeed);
    }
  });
  it('gives equivalent skating arcs at 60 and 120 Hz', () => {
    const a = skater(8),
      b = skater(8);
    for (let i = 0; i < 60; i++) skateVelocity(a, 0, 1, false, false, 1 / 120);
    for (let i = 0; i < 30; i++) skateVelocity(b, 0, 1, false, false, 1 / 60);
    expect(Math.abs(a.vx - b.vx)).toBeLessThan(0.15);
    expect(Math.abs(a.vz - b.vz)).toBeLessThan(0.15);
  });
});

describe('readable committed contact', () => {
  it('commits to the same shoulder path even if the left stick points away after the flick', () => {
    const a = skater(8),
      b = skater(8);
    const s = createMatch();
    launchCheck(s, a, 1, 0);
    launchCheck(s, b, 1, 0);
    skate(a, 0.2, 1, 0);
    skate(b, 0.2, -1, 0, true);
    expect(a.vx).toBeCloseTo(b.vx, 8);
    expect(a.vz).toBeCloseTo(b.vz, 8);
  });
  it('allows a late lateral dodge instead of steering the check after its target', () => {
    const s = contactRink(),
      a = s.skaters[0],
      b = s.skaters[6];
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    Object.assign(b, { vz: 10, vx: 0 });
    for (let i = 0; i < 60; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(s.hits[0]).toBe(0);
    expect(a.checkLanded).toBe(false);
    expect(Math.abs(a.z)).toBeLessThan(0.1);
    expect(a.stumbleTimer).toBeGreaterThan(0);
  });
  it('does not spend a forward check on a shoulder brush from behind', () => {
    const s = contactRink(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(b, { x: -1.2, z: 0.5, vx: 8 });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1 }));
    expect(a.checkLanded).toBe(false);
    expect(s.hits[0]).toBe(0);
  });
  it('lands a matching-speed shoulder check from the side and dumps the carrier', () => {
    const s = contactRink(),
      a = s.skaters[0],
      b = s.skaters[6];
    Object.assign(a, { x: 0, z: 0, vx: 8, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(b, {
      x: 0.15,
      z: 1.0,
      vx: 8,
      vz: 0,
      angle: Math.PI / 2,
      cooldown: 10,
      stumbleTimer: 0,
    });
    Object.assign(s.puck, { owner: 6, x: b.x, z: b.z });
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, moveX: 1, checkPower: 1 }));
    for (let i = 0; i < 8 && s.hits[0] === 0; i++)
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1 }));
    expect(a.checkLanded).toBe(true);
    expect(s.hits[0]).toBe(1);
    expect(b.downTimer).toBeGreaterThan(0);
    expect(s.puck.owner).toBeNull();
    expect(s.notice).toBe('BIG HIT');
  });
  it.each([350, 1000])(
    'sweeps a fast contact at %s m/s instead of tunneling through bodies',
    (velocity) => {
      const s = contactRink(),
        a = s.skaters[0],
        b = s.skaters[6];
      Object.assign(b, { x: 2, z: 0 });
      launchCheck(s, a, 1, 0);
      a.vx = velocity;
      stepMatch(s);
      expect(s.hits[0]).toBe(1);
      expect(b.downTimer).toBeGreaterThan(0);
      expect(a.x).toBeLessThan(b.x);
    },
  );
  it('leaves the loose puck carrying its own momentum, not the knockdown impulse', () => {
    const s = contactRink();
    s.skaters[6].x = 1.2;
    stepMatch(s, seat(s, { ...EMPTY_INPUT, check: true, stickIceX: 1, checkPower: 1 }));
    expect(s.hits[0]).toBe(1);
    expect(s.puck.owner).toBeNull();
    expect(Math.hypot(s.puck.vx, s.puck.vz)).toBeLessThan(0.5);
    expect(speed(s.skaters[6])).toBeGreaterThan(4);
  });
});

describe('defending a breakout', () => {
  it.each([1, 2])('turns a beaten defenseman into pursuit in period %s', (period) => {
    const s = createMatch();
    s.period = period;
    const dir = period === 2 ? -1 : 1;
    const c = s.skaters[6],
      d = s.skaters[3];
    Object.assign(c, { x: -5 * dir, z: 5, vx: -9 * dir, vz: 0 });
    Object.assign(d, { x: -1 * dir, z: 5, vx: -6 * dir, vz: 0 });
    Object.assign(s.puck, { owner: c.id, x: c.x, z: c.z, vx: c.vx });
    const ai = decideAI(s, d);
    expect(ai.backskate).toBe(false);
    expect(ai.hustle).toBe(true);
    expect(ai.move.x * dir).toBeLessThan(-0.5);
  });
  it('holds a gap while facing a slower carrier who has not beaten the defender', () => {
    const s = createMatch(),
      c = s.skaters[6],
      d = s.skaters[3];
    Object.assign(c, { x: 0, z: 4, vx: -4, vz: 0 });
    Object.assign(d, { x: -8, z: 4, vx: -3, vz: 0 });
    Object.assign(s.puck, { owner: c.id, x: c.x, z: c.z, vx: c.vx });
    // An approaching defensive target may close the gap skating forward. With the gap already
    // at the cushion it must face play while retreating.
    d.x = -3;
    s.skaters[0].x = -0.5;
    s.skaters[0].z = 4;
    const ai = decideAI(s, d);
    expect(ai.backskate).toBe(true);
  });
  it('makes a CPU carrier release hustle and handle the puck around a defended lane', () => {
    const s = createMatch(),
      c = s.skaters[6],
      d = s.skaters[0];
    Object.assign(c, { x: 0, z: 6, vx: -8, vz: 0, angle: -Math.PI / 2 });
    Object.assign(d, { x: -3, z: 6, vx: 0, vz: 0 });
    Object.assign(s.puck, { owner: c.id, x: c.x, z: c.z, vx: c.vx });
    const ai = decideAI(s, c);
    expect(ai.hustle).toBe(false);
    expect(Math.abs(ai.stickX)).toBeGreaterThan(0.5);
    expect(Math.abs(ai.move.z)).toBeGreaterThan(0.2);
  });
});

describe('CPU chase feel', () => {
  function rush() {
    const s = createMatch(0, 'oneOnOne');
    s.phase = 'playing';
    const you = s.skaters[0],
      cpu = s.skaters[6];
    return { s, you, cpu };
  }

  it('wraps beside a stopped carrier instead of parking on their back', () => {
    const { s, you, cpu } = rush();
    Object.assign(you, { x: 4, z: 5, vx: 0, vz: 0, angle: Math.PI / 2 });
    Object.assign(cpu, { x: 2.1, z: 5, vx: 0, vz: 0, angle: Math.PI / 2 });
    Object.assign(s.puck, { owner: you.id, x: you.x + 0.8, z: you.z, vx: 0, vz: 0 });
    const ai = decideAI(s, cpu);
    expect(Math.hypot(ai.move.x, ai.move.z)).toBeGreaterThan(0.45);
    expect(Math.abs(ai.move.z)).toBeGreaterThan(0.25);
    expect(ai.hustle).toBe(false);
  });

  it('shades inside a wide cut instead of mirroring it from behind', () => {
    const { s, you, cpu } = rush();
    Object.assign(you, { x: 5, z: 6.5, vx: 8, vz: 5.5, angle: Math.PI / 2 });
    Object.assign(cpu, { x: 0.8, z: 6.5, vx: 6, vz: 0, angle: Math.PI / 2 });
    Object.assign(s.puck, { owner: you.id, x: you.x, z: you.z, vx: you.vx, vz: you.vz });
    const ai = decideAI(s, cpu);
    expect(ai.move.x).toBeGreaterThan(0.35);
    expect(ai.move.z).toBeLessThan(0);
  });

  it('holds the slot instead of matching a wide carrier when still in front', () => {
    const { s, you, cpu } = rush();
    Object.assign(you, { x: 0, z: 7, vx: 5, vz: 0, angle: Math.PI / 2 });
    Object.assign(cpu, { x: 6, z: 7, vx: 0, vz: 0, angle: -Math.PI / 2 });
    Object.assign(s.puck, { owner: you.id, x: you.x, z: you.z, vx: you.vx });
    const ai = decideAI(s, cpu);
    expect(ai.move.z).toBeLessThan(-0.2);
  });

  it('pokes when it has a hip on a slow carrier, not a shielded stab from behind', () => {
    const { s, you, cpu } = rush();
    Object.assign(you, { x: 4, z: 0, vx: 0, vz: 0, angle: Math.PI / 2 });
    Object.assign(cpu, { x: 4.55, z: 1.15, vx: 1, vz: 0, angle: Math.PI / 2, cooldown: 0 });
    Object.assign(s.puck, { owner: you.id, x: 4.9, z: 0, vx: 0, vz: 0 });
    const ai = decideAI(s, cpu);
    expect(ai.poke).toBe(true);
    expect(ai.pokeSweep).toBe(true);
    expect(ai.check).toBe(false);
  });
});

describe('CPU difficulty', () => {
  function rush(difficulty: Difficulty = 'allStar') {
    const s = createMatch(0, 'oneOnOne');
    s.phase = 'playing';
    s.difficulty = difficulty;
    const you = s.skaters[0],
      cpu = s.skaters[6];
    return { s, you, cpu };
  }

  it('starts matches on All-Star', () => {
    expect(createMatch().difficulty).toBe('allStar');
  });

  it('lets a Rookie chaser sit off a gap All-Star would hustle to close', () => {
    const chase = (difficulty: Difficulty) => {
      const { s, you, cpu } = rush(difficulty);
      Object.assign(you, { x: -8, z: 8, vx: 0, vz: 0 });
      Object.assign(cpu, { x: 0, z: 0, vx: 0, vz: 0, stamina: 1 });
      Object.assign(s.puck, { owner: null, x: 5, z: 0, vx: 0, vz: 0 });
      return decideAI(s, cpu);
    };
    expect(chase('allStar').hustle).toBe(true);
    expect(chase('rookie').hustle).toBe(false);
    expect(chase('legend').hustle).toBe(true);
  });

  it('holds a bigger gap on Rookie than Legend when still in front of the carrier', () => {
    const step = (difficulty: Difficulty) => {
      const { s, you, cpu } = rush(difficulty);
      Object.assign(you, { x: 0, z: 0, vx: 5, vz: 0, angle: Math.PI / 2 });
      Object.assign(cpu, { x: 2.8, z: 0, vx: 0, vz: 0, angle: -Math.PI / 2 });
      Object.assign(s.puck, { owner: you.id, x: you.x, z: you.z, vx: you.vx });
      return decideAI(s, cpu).move.x;
    };
    expect(step('legend')).toBeLessThan(0);
    expect(step('rookie')).toBeGreaterThan(0);
  });

  it('makes a Legend CPU shoot a look a Rookie would hold', () => {
    const look = (difficulty: Difficulty, team: 0 | 1) => {
      const s = createMatch();
      s.difficulty = difficulty;
      const p = s.skaters[team * 6];
      const dir = team === 0 ? 1 : -1;
      Object.assign(p, {
        x: dir * 20,
        z: 5.4,
        cooldown: 0,
        angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      });
      s.puck.owner = p.id;
      s.skaters
        .filter((q) => q.team !== team && q.role !== 'G')
        .forEach((q) => {
          q.x = -dir * 12;
          q.z = 10;
        });
      Object.assign(
        s.skaters.find((q) => q.team !== team && q.role === 'G')!,
        { x: dir * 25.2, z: 5.4 },
      );
      return decideAI(s, p).shoot;
    };
    expect(look('allStar', 1)).toBe(true);
    expect(look('legend', 1)).toBe(true);
    expect(look('rookie', 1)).toBe(false);
    expect(look('rookie', 0)).toBe(true);
  });
});

describe('breakaway backcheck', () => {
  function rush(difficulty: Difficulty = 'allStar') {
    const s = createMatch();
    s.phase = 'playing';
    s.difficulty = difficulty;
    const carrier = s.skaters[0],
      chaser = s.skaters[6];
    Object.assign(carrier, { x: 3, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, stamina: 1 });
    Object.assign(chaser, { x: 0, z: 0, vx: 10, vz: 0, angle: Math.PI / 2, stamina: 1 });
    Object.assign(s.puck, { owner: carrier.id, x: carrier.x, z: carrier.z, vx: carrier.vx });
    for (const p of s.skaters) {
      if (p.id === carrier.id || p.id === chaser.id) continue;
      Object.assign(p, {
        x: p.role === 'G' ? (p.team === 0 ? -26 : 26) : 22,
        z: p.team === 0 ? 11 : -11,
        vx: 0,
        vz: 0,
      });
    }
    return { s, carrier, chaser };
  }

  it('treats an empty-handed skater behind a rushing carrier as a backcheck', () => {
    const { s, carrier, chaser } = rush();
    expect(isBackcheckingRush(s, chaser)).toBe(true);
    expect(isBackcheckingRush(s, carrier)).toBe(false);
    chaser.x = 6;
    expect(isBackcheckingRush(s, chaser)).toBe(false);
  });

  it('does not let a backchecker outrun a hustling carrier from behind', () => {
    const { s, carrier, chaser } = rush();
    let gap = carrier.x - chaser.x;
    for (let i = 0; i < 240; i++) {
      const cap = backcheckScales(s, chaser, 1.14, 1.14);
      skateVelocity(chaser, 1, 0, true, false, dt, false, PHYSICS.edgeGrip, cap.push, cap.speed);
      skateVelocity(carrier, 1, 0, true, false, dt, false);
      carrier.x += carrier.vx * dt;
      chaser.x += chaser.vx * dt;
      s.puck.x = carrier.x;
      gap = carrier.x - chaser.x;
    }
    expect(gap).toBeGreaterThan(2.7);
    expect(speed(chaser)).toBeLessThanOrEqual(speed(carrier) + 0.08);
  });

  it('does not let a Legend CPU run down a rushing carrier', () => {
    const { s, carrier, chaser } = rush('legend');
    const start = carrier.x - chaser.x;
    for (let i = 0; i < 240; i++) stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1, hustle: true }));
    expect(carrier.x - chaser.x).toBeGreaterThan(start - 0.45);
    expect(speed(chaser)).toBeLessThanOrEqual(PHYSICS.hustleSpeed + 0.12);
  });

  it('still lets a backchecker close if the carrier is not rushing', () => {
    const { s, carrier, chaser } = rush();
    Object.assign(carrier, { vx: 1, vz: 0 });
    Object.assign(chaser, { vx: 1, vz: 0 });
    expect(isBackcheckingRush(s, chaser)).toBe(false);
    const start = carrier.x - chaser.x;
    for (let i = 0; i < 180; i++) stepMatch(s, seat(s, EMPTY_INPUT));
    expect(carrier.x - chaser.x).toBeLessThan(start - 0.6);
  });
});
