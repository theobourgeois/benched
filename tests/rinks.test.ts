import { afterEach, describe, expect, it } from 'vitest';
import {
  applyStyle,
  DEFAULT_PHYSICS,
  NET,
  EMPTY_INPUT,
  PHYSICS,
  RINK,
  RINKS,
  STICK,
  STYLES,
} from '../src/game/config';
import { createMatch, startMatch, stepMatch } from '../src/game/engine';
import { constrainToRink } from '../src/game/math';
import { GAME_STYLES, RINK_SIZES } from '../src/net/protocol';
import { cameraFraming } from '../src/scene/camera';
import type { RinkSize } from '../src/game/types';
import { drive, playing, seat } from './support';

const FT = 0.3048;
const SIZES = Object.keys(RINKS) as RinkSize[];
const fast = { ...PHYSICS };

// The tables are shared by every test file in the worker: leave them as they were found.
afterEach(() => void createMatch());

describe('rink sizes', () => {
  it('builds the pro sheet to NHL Rule 1', () => {
    const r = { ...RINKS.pro, ...RINKS.pro.hockey! };
    expect(r.halfLength * 2).toBeCloseTo(200 * FT, 6);
    expect(r.halfWidth * 2).toBeCloseTo(85 * FT, 6);
    expect(r.corner).toBeCloseTo(28 * FT, 6);
    expect(r.halfLength - r.goalX).toBeCloseTo(11 * FT, 6);
    // Fifty feet of neutral zone between the blue lines' inner edges; 64 ft from each goal line
    // to the far edge of its blue line.
    expect((r.blueLine - r.blueWidth / 2) * 2).toBeCloseTo(50 * FT, 6);
    expect(r.goalX - (r.blueLine - r.blueWidth / 2)).toBeCloseTo(64 * FT, 6);
    expect(r.goalX - r.spotX).toBeCloseTo(20 * FT, 6);
    expect(r.spotZ * 2).toBeCloseTo(44 * FT, 6);
    expect(r.blueLine - r.blueWidth / 2 - r.neutralSpotX).toBeCloseTo(5 * FT, 6);
    expect(r.circle).toBeCloseTo(15 * FT, 6);
    expect(r.centreCircle).toBeCloseTo(15 * FT, 6);
    expect(r.trapezoid).toEqual({ goalLine: 11 * FT, boards: 14 * FT });
  });
  it('builds the olympic sheet to the IIHF rule book', () => {
    const r = { ...RINKS.olympic, ...RINKS.olympic.hockey! };
    expect([r.halfLength * 2, r.halfWidth * 2, r.corner]).toEqual([60, 30, 8.5]);
    expect(r.halfLength - r.goalX).toBe(4);
    expect(r.halfLength - (r.blueLine - r.blueWidth / 2)).toBeCloseTo(22.86, 6);
    expect(r.goalX - r.spotX).toBe(6);
    expect(r.spotZ).toBe(7);
    expect(r.blueLine - r.blueWidth / 2 - r.neutralSpotX).toBeCloseTo(1.5, 6);
    expect([r.circle, r.centreCircle]).toEqual([4.5, 4.5]);
  });
  it('lays out the bandy sheet at the international size, with the net on the end boards', () => {
    const r = RINKS.bandy;
    expect([r.halfLength * 2, r.halfWidth * 2]).toEqual([100, 60]);
    expect(r.bandy).toEqual({ penaltyArea: 17, penaltySpot: 12, freeStroke: 5 });
    expect(r.centreCircle).toBe(5);
    // Room for the net and nothing else: nobody skates behind a bandy goal.
    expect(r.halfLength - r.goalX - 1.5).toBeLessThan(PHYSICS.playerRadius);
    expect(r.bandy!.penaltyArea).toBeLessThan(r.halfWidth);
  });
  it('keeps every mark on the ice and the same net on every sheet', () => {
    for (const size of SIZES) {
      const r = RINKS[size];
      expect(r.corner, size).toBeLessThan(r.halfWidth);
      expect(r.goalX + 1.5, size).toBeLessThan(r.halfLength);
      expect([r.goalHalfWidth, r.goalHeight], size).toEqual([NET.goalHalfWidth, NET.goalHeight]);
      // One kind of paint per sheet.
      expect(!!r.hockey, size).toBe(!r.bandy);
      const paint = r.hockey;
      if (!paint) continue;
      expect(paint.spotZ + paint.circle, size).toBeLessThan(r.halfWidth);
      expect(paint.neutralSpotX, size).toBeLessThan(paint.blueLine);
      expect(paint.blueLine, size).toBeLessThan(paint.spotX);
    }
  });
  it('points the live table at the rink of the newest match', () => {
    for (const size of SIZES) {
      const s = createMatch(0, 'exhibition', undefined, undefined, { rink: size });
      expect(s.rink).toBe(size);
      expect(RINK).toEqual(RINKS[size]);
      // Both goalies start a metre out from their own goal line, wherever that is.
      for (const g of s.skaters.filter((p) => p.role === 'G'))
        expect(Math.abs(g.x)).toBeCloseTo(RINKS[size].goalX - 1, 6);
    }
    createMatch();
    expect(RINK).toEqual(RINKS.barn);
  });
  it('holds a body inside the boards of each sheet, corners included', () => {
    for (const size of SIZES) {
      createMatch(0, 'exhibition', undefined, undefined, { rink: size });
      const r = RINKS[size];
      const body = { x: r.halfLength + 3, z: r.halfWidth + 3 };
      expect(constrainToRink(body, 0.5)).not.toBeNull();
      const cx = r.halfLength - r.corner,
        cz = r.halfWidth - r.corner;
      expect(Math.hypot(body.x - cx, body.z - cz)).toBeCloseTo(r.corner - 0.5, 6);
      // A spot that is open ice on the wide sheet and in the seats on the narrow ones.
      const wing = { x: 0, z: 14 };
      expect(constrainToRink(wing, 0.5) === null, size).toBe(RINKS[size].halfWidth > 14.5);
    }
  });
  it('plays a CPU game on each sheet without anybody leaving it', () => {
    for (const size of SIZES) {
      const s = createMatch([], 'exhibition', undefined, undefined, { rink: size });
      startMatch(s);
      for (let i = 0; i < 120 * 40; i++) stepMatch(s);
      for (const p of s.skaters) {
        expect(Math.abs(p.x), size).toBeLessThan(RINK.halfLength);
        expect(Math.abs(p.z), size).toBeLessThan(RINK.halfWidth);
      }
      expect(s.shots[0] + s.shots[1], size).toBeGreaterThan(0);
    }
  });
  it('frames a rush on net the same on every sheet, however far the net is from centre', () => {
    const lead = (size: RinkSize, out: number, z = 0) => {
      const s = createMatch(0, 'exhibition', undefined, undefined, { rink: size });
      s.phase = 'playing';
      const me = playing(s);
      Object.assign(me, { x: RINK.goalX - out, z });
      Object.assign(s.puck, { x: me.x + 1, z, owner: me.id });
      const view = cameraFraming(s, 'broadcast', 16 / 9, 0);
      return { ahead: view.target[0] - me.x, side: Math.abs(view.target[2] - z) };
    };
    for (const out of [4, 12, 20])
      for (const size of SIZES) {
        expect(lead(size, out).ahead, `${size} ${out} m out`).toBeCloseTo(
          lead('barn', out).ahead,
          // To within half a metre: how far ahead the camera looks still eases in from centre ice.
          0,
        );
        expect(lead(size, out).ahead).toBeLessThan(12);
      }
    // Hard on the side boards of the widest sheet, the skater is still well inside the frame.
    expect(lead('bandy', 20, RINKS.bandy.halfWidth - 1).side).toBeLessThan(12);
  });
  it('lists the same sizes and styles for the room to check', () => {
    expect([...RINK_SIZES].sort()).toEqual([...SIZES].sort());
    expect([...GAME_STYLES].sort()).toEqual(Object.keys(STYLES).sort());
  });
});

describe('game styles', () => {
  /** Skate flat out up the middle for a while and report the speed reached at two moments. */
  function sprint(style: 'fast' | 'classic') {
    const s = createMatch(0, 'freeSkate', undefined, undefined, { style });
    startMatch(s);
    drive(s, 0);
    const me = playing(s);
    me.x = -20;
    me.z = 0;
    me.vx = me.vz = 0;
    const speeds: number[] = [];
    for (let i = 0; i < 120 * 3; i++) {
      stepMatch(s, seat(s, { ...EMPTY_INPUT, moveX: 1, moveZ: 0 }));
      if (i === 59 || i === 120 * 3 - 1) speeds.push(Math.hypot(me.vx, me.vz));
    }
    return speeds;
  }
  it('is fast by default, and a default match puts fast back', () => {
    expect(createMatch().style).toBe('fast');
    createMatch(0, 'exhibition', undefined, undefined, { style: 'classic' });
    expect(PHYSICS.maxSpeed).toBe(STYLES.classic.physics.maxSpeed);
    expect(DEFAULT_PHYSICS).toEqual(PHYSICS);
    createMatch();
    expect(PHYSICS).toEqual(fast);
    expect(DEFAULT_PHYSICS).toEqual(fast);
  });
  it('makes classic slower off the mark and at full stride', () => {
    const [fastStart, fastTop] = sprint('fast');
    const [classicStart, classicTop] = sprint('classic');
    expect(classicStart).toBeLessThan(fastStart * 0.8);
    expect(classicTop).toBeLessThan(fastTop * 0.9);
    expect(classicTop).toBeGreaterThan(7);
  });
  it('slows the puck and weighs down the stick in classic', () => {
    const c = STYLES.classic;
    expect(c.physics.shotSpeed!).toBeLessThan(fast.shotSpeed);
    expect(c.physics.passSpeed!).toBeLessThan(fast.passSpeed);
    expect(c.stick.omega!).toBeLessThan(STICK.omega);
    // A pass still outruns a sprinting skater by the margin it has in fast.
    const ratio = (passSpeed: number, hustle: number) => passSpeed / hustle;
    expect(ratio(c.physics.passSpeed!, c.physics.hustleSpeed!)).toBeCloseTo(
      ratio(fast.passSpeed, fast.hustleSpeed),
      1,
    );
  });
  it('leaves a hand-tuned number alone when the style changes', () => {
    PHYSICS.maxSpeed = 7.77;
    applyStyle('classic');
    expect(PHYSICS.maxSpeed).toBe(7.77);
    expect(PHYSICS.passSpeed).toBe(STYLES.classic.physics.passSpeed);
    applyStyle('fast');
    expect(PHYSICS.maxSpeed).toBe(7.77);
    PHYSICS.maxSpeed = fast.maxSpeed;
  });
});
