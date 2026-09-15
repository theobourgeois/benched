import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone, limitWrist } from '../src/scene/animationMath';
import {
  createHockeyAction,
  sampleHockeyAction,
  sampleForwardStride,
} from '../src/scene/hockeyMotion';
import { placeStick, SKATER_BLADE } from '../src/scene/stick';
import { createMatch, shootPuck, passPuck } from '../src/game/engine';
import { PHYSICS } from '../src/game/config';

describe('anatomical animation constraints', () => {
  it('keeps both bone lengths for reachable, unreachable, coincident and collinear targets', () => {
    const origin = new THREE.Vector3(0.2, 1.2, -0.3);
    for (const offset of [
      [0.2, -0.4, 0.15],
      [10, 3, 4],
      [0, 0, 0],
      [0, -0.5, 0],
    ]) {
      const target = origin.clone().add(new THREE.Vector3(...offset));
      for (const pole of [target, origin.clone().add(new THREE.Vector3(1, 0, 1))]) {
        const joint = new THREE.Vector3(),
          end = new THREE.Vector3(),
          normal = new THREE.Vector3();
        solveTwoBone(origin, target, pole, 0.31, 0.27, 0.18, 2.55, joint, end, normal);
        expect(origin.distanceTo(joint)).toBeCloseTo(0.31, 8);
        expect(joint.distanceTo(end)).toBeCloseTo(0.27, 8);
        expect(normal.length()).toBeCloseTo(1, 8);
        expect(end.toArray().every(Number.isFinite)).toBe(true);
        const bend = Math.PI - origin.clone().sub(joint).angleTo(end.clone().sub(joint));
        expect(bend).toBeGreaterThanOrEqual(0.18 - 1e-8);
        expect(bend).toBeLessThanOrEqual(2.55 + 1e-8);
      }
    }
  });

  it('bounds wrist swing and forearm-axis twist, including a 180-degree swing', () => {
    for (const angles of [
      [2, 2, 1],
      [Math.PI, 0, 0],
      [0, -3, 0],
      [0.1, 0.1, 0],
    ]) {
      const q = limitWrist(new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles)));
      expect(q.length()).toBeCloseTo(1, 8);
      const twist = new THREE.Quaternion(0, q.y, 0, q.w).normalize();
      const swing = q.clone().multiply(twist.clone().invert());
      expect(new THREE.Quaternion().angleTo(swing)).toBeLessThanOrEqual(0.85 + 1e-8);
      expect(new THREE.Quaternion().angleTo(twist)).toBeLessThanOrEqual(0.65 + 1e-8);
    }
  });

  it('preserves shaft length and the top hand socket through wide reaches and windups', () => {
    const parts = {
      root: new THREE.Group(),
      shaft: new THREE.Mesh(),
      knob: new THREE.Mesh(),
      paddle: null,
    };
    const hosel = new THREE.Vector3(),
      heading = new THREE.Vector3(0, 0, 1);
    for (const target of [
      [0.58, 0, 1.05],
      [-0.8, 0, 0.5],
      [0, 0.8, -0.3],
      [0, 0, 0],
    ]) {
      const grip = new THREE.Vector3(-0.2, 0.95, 0.35);
      placeStick(parts, SKATER_BLADE, grip, new THREE.Vector3(...target), heading, hosel);
      expect(parts.shaft.scale.y).toBe(SKATER_BLADE.shaft);
      expect(grip.distanceTo(hosel)).toBeCloseTo(SKATER_BLADE.shaft - 0.1, 8);
      expect(parts.root.quaternion.length()).toBeCloseTo(1, 8);
    }
  });

  it('keeps the top socket within the shoulder reach without folding it against the shoulder', () => {
    const parts = {
      root: new THREE.Group(),
      shaft: new THREE.Mesh(),
      knob: new THREE.Mesh(),
      paddle: null,
    };
    const shoulder = new THREE.Vector3(0, 1.25, 0.2);
    for (const height of [0, 0.15, 0.35]) {
      const grip = new THREE.Vector3(0, 1.4, 0.2);
      placeStick(
        parts,
        SKATER_BLADE,
        grip,
        new THREE.Vector3(0, height, 1),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(),
        { shoulder, armReach: 0.48 },
      );
      expect(grip.distanceTo(shoulder)).toBeLessThanOrEqual(0.48 + 1e-8);
      expect(grip.distanceTo(shoulder)).toBeGreaterThanOrEqual(0.25 - 1e-8);
    }
  });

  const rigidParts = () => ({
    root: new THREE.Group(),
    shaft: new THREE.Mesh(),
    knob: new THREE.Mesh(),
    paddle: null,
  });
  const bladeY = (parts: ReturnType<typeof rigidParts>, x: number) => {
    parts.root.updateMatrixWorld();
    return parts.root.localToWorld(new THREE.Vector3(x, 0, 0)).y;
  };

  it('lays the rigid stick flat and rocks it onto one end only to keep the top hand in reach', () => {
    const parts = rigidParts(),
      hosel = new THREE.Vector3(),
      heading = new THREE.Vector3(0, 0, 1);
    const tip = new THREE.Vector3(0.58, -0.028, 1.05);
    const heel = 0.015 + (SKATER_BLADE.height * 0.6) / Math.tan(SKATER_BLADE.lie!);
    placeStick(parts, SKATER_BLADE, new THREE.Vector3(-0.2, 1, 0.35), tip, heading, hosel);
    expect(bladeY(parts, heel)).toBeCloseTo(tip.y, 8);
    expect(bladeY(parts, SKATER_BLADE.length)).toBeCloseTo(tip.y, 8);
    // Puck pulled in close: a flat blade would put the top hand out of reach.
    const shoulder = new THREE.Vector3(-0.21, 1.38, 0.18);
    const close = new THREE.Vector3(0.3, -0.028, 0.6);
    const grip = new THREE.Vector3(-0.2, 1, 0.35);
    placeStick(parts, SKATER_BLADE, grip, close, heading, hosel, { shoulder, armReach: 0.54 });
    expect(grip.distanceTo(shoulder)).toBeLessThanOrEqual(0.54 + 1e-6);
    const ends = [bladeY(parts, heel), bladeY(parts, SKATER_BLADE.length)];
    expect(Math.min(...ends)).toBeCloseTo(close.y, 8);
    expect(Math.max(...ends)).toBeGreaterThan(close.y + 0.01);
    expect(grip.distanceTo(hosel)).toBeCloseTo(SKATER_BLADE.shaft - 0.1, 8);
  });

  it('moves the top hand continuously as the blade sweeps across the body', () => {
    const parts = rigidParts(),
      hosel = new THREE.Vector3(),
      heading = new THREE.Vector3(0, 0, 1);
    const shoulder = new THREE.Vector3(-0.22, 1.35, 0.18);
    let last: THREE.Vector3 | null = null,
      worst = 0;
    for (let i = 0; i <= 400; i++) {
      const u = i / 400;
      const tip = new THREE.Vector3(1 - 1.8 * u, -0.028, 0.5 + 0.6 * Math.sin(Math.PI * u));
      const grip = new THREE.Vector3(-0.2, 1, 0.35);
      placeStick(parts, SKATER_BLADE, grip, tip, heading, hosel, {
        shoulder,
        armReach: 0.54,
        torso: { at: new THREE.Vector3(0, 0.9, -0.02), front: new THREE.Vector3(0, 0, 1) },
      });
      expect(grip.z).toBeGreaterThanOrEqual(-0.02 + 0.14 - 1e-6);
      if (last) worst = Math.max(worst, grip.distanceTo(last));
      last = grip.clone();
    }
    expect(worst).toBeLessThan(0.03);
  });
});

describe('hockey motion timing', () => {
  const step = () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weight: 0, push: 0 });
  it('plants a gliding skate, lifts only for recovery, and joins the stride loop continuously', () => {
    for (let phase = 0; phase < 1; phase += 0.01) {
      const glide = step();
      sampleForwardStride(1, phase, 0, 0.19, glide);
      expect(glide).toMatchObject({ x: 0.19, y: 0, z: 0.015, weight: 1, push: 0 });
      const a = step();
      sampleForwardStride(1, phase, 1, 0.19, a);
      expect(a.y).toBeGreaterThanOrEqual(0);
      if (phase < 0.58) expect(a.y).toBeLessThan(0.001);
    }
    const a = step(),
      b = step();
    sampleForwardStride(1, 0.999999, 1, 0.19, a);
    sampleForwardStride(1, 0.000001, 1, 0.19, b);
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const)
      expect(a[key]).toBeCloseTo(b[key], 4);
    sampleForwardStride(1, 0.8, 0, 0.19, a);
    expect(a).toMatchObject({ x: 0.19, y: 0, weight: 1, push: 0 });
  });

  it('records the release pose and distinguishes passes, backhands and slap shots', () => {
    const s = createMatch(),
      p = s.skaters[0];
    s.puck.owner = p.id;
    p.stickSide = -0.6;
    p.stickReach = 0.7;
    shootPuck(s, p, 0.8);
    expect(p).toMatchObject({
      shotStyle: 'backhand',
      shotSide: -0.6,
      shotReach: 0.7,
      shotDuration: 0.34,
    });
    s.puck.owner = p.id;
    p.stickSide = 0.6;
    shootPuck(s, p, 0.8);
    expect(p.shotStyle).toBe('slap');
    s.puck.owner = p.id;
    passPuck(s, p, 1, 0);
    expect(p.shotStyle).toBe('pass');
    expect(p.shotDuration).toBe(p.shotTimer);
  });

  it('starts at puck contact, follows through, and finishes at the carrying pose', () => {
    const p = createMatch().skaters[0],
      out = createHockeyAction();
    p.shotDuration = p.shotTimer = 0.34;
    sampleHockeyAction(p, 0, out);
    expect(out.bladeLift).toBe(0);
    expect(out.bladeReach).toBe(0);
    p.shotTimer = 0.24;
    sampleHockeyAction(p, 0, out);
    expect(out.bladeLift).toBeGreaterThan(0.1);
    p.shotTimer = 0;
    sampleHockeyAction(p, 0, out);
    for (const [key, value] of Object.entries(createHockeyAction()))
      expect(out[key as keyof typeof out]).toBeCloseTo(value, 8);
  });

  it('loads a check before shoulder commitment and returns smoothly after recovery', () => {
    const p = createMatch().skaters[0],
      out = createHockeyAction();
    p.checkTimer = PHYSICS.checkWindow;
    expect(sampleHockeyAction(p, 0, out).check).toBe(0);
    p.checkTimer *= 0.62;
    expect(sampleHockeyAction(p, 0, out).check).toBeCloseTo(1);
    p.checkTimer = 0;
    expect(sampleHockeyAction(p, 0, out).check).toBe(0);
  });
});
