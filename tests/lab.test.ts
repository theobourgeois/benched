import { describe, expect, it } from 'vitest';
import { CLIPS, takeClip, travelAt, type TakeFrame } from '../src/dev/labClips';
import { analyze, JOINTS, segmentDistance, type LabSample, type V3 } from '../src/dev/labMetrics';

describe('animation lab clips', () => {
  it('have unique ids and finite values across their whole length', () => {
    expect(new Set(CLIPS.map((c) => c.id)).size).toBe(CLIPS.length);
    for (const clip of CLIPS)
      for (let t = 0; t <= clip.duration + 1e-9; t += 1 / 60) {
        const f = clip.frame(t);
        for (const [key, v] of Object.entries(f.skater))
          if (typeof v === 'number')
            expect(Number.isFinite(v), `${clip.id}.${key} @${t}`).toBe(true);
        expect(Number.isFinite(f.charge)).toBe(true);
      }
  });

  it('join up where they loop, so looping playback does not pop', () => {
    for (const clip of CLIPS.filter((c) => c.loop)) {
      const a = clip.frame(0).skater,
        b = clip.frame(clip.duration).skater;
      for (const key of ['skateDrive', 'edgeLean', 'stickSide', 'stickReach'] as const)
        expect(b[key] ?? 0, `${clip.id}.${key}`).toBeCloseTo(a[key] ?? 0, 3);
      // The pose reads velocity in the skater's frame; a turning clip's heading may wrap.
      const own = (s: typeof a) => {
        const h = s.angle ?? 0,
          vx = s.vx ?? 0,
          vz = s.vz ?? 0;
        return [vx * Math.sin(h) + vz * Math.cos(h), vx * Math.cos(h) - vz * Math.sin(h)];
      };
      own(b).forEach((v, i) => expect(v, `${clip.id} velocity`).toBeCloseTo(own(a)[i], 3));
      const phase = (s: number | undefined) => ((s ?? 0) / (2 * Math.PI)) % 1;
      const gap = Math.abs(phase(b.stride) - phase(a.stride));
      expect(Math.min(gap, 1 - gap), `${clip.id} stride phase`).toBeLessThan(1e-6);
    }
  });

  it('integrates travel from the clip velocity', () => {
    const stride = CLIPS.find((c) => c.id === 'stride')!;
    expect(travelAt(stride, 0.5).z).toBeCloseTo(3.5, 1);
    expect(travelAt(stride, 0.5).x).toBeCloseTo(0, 6);
  });

  it('plays back a live take with interpolation and short-way headings', () => {
    const frame = (t: number, angle: number, owned: boolean): TakeFrame => ({
      t,
      skater: { x: 10 + t, z: 5, angle, stickSide: t, dekeKind: t < 0.5 ? null : 'spin' },
      puck: { x: 12, y: 0.03, z: 5, owned },
      charge: t,
    });
    const take = takeClip('take-1', [frame(1, 3.1, true), frame(2, -3.1, false)]);
    expect(take.duration).toBeCloseTo(1);
    const mid = take.frame(0.5);
    expect(mid.skater.x).toBeCloseTo(0.5);
    expect(mid.skater.stickSide).toBeCloseTo(1.5);
    expect(Math.abs(Math.cos(mid.skater.angle!) + 1)).toBeLessThan(1e-3);
    expect(mid.skater.downTimer).toBe(0);
  });
});

describe('animation lab metrics', () => {
  it('measures the closest distance between segments', () => {
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [0.5, 1, -1], [0.5, 1, 1])).toBeCloseTo(1);
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0])).toBeCloseTo(1);
  });

  it('flags a one-frame jump in a smooth path, and not the smooth path', () => {
    const track = (jumpAt: number | null) =>
      Array.from({ length: 60 }, (_, frame) => {
        const joints = Object.fromEntries(
          JOINTS.map((j) => [j, [Math.sin(frame / 10) * 0.3, 1, 0] as V3]),
        ) as LabSample['joints'];
        if (frame === jumpAt) joints.palmL = [joints.palmL[0] + 0.06, 1, 0];
        return {
          t: frame / 60,
          frame,
          joints,
          issues: [],
          pose: { ragdoll: false, crouch: 0.5, freeHand: 0 },
          angles: {},
          grip: { L: 0, R: 0 },
          lift: { L: 0, R: 0 },
          stick: { blade: 0, tilt: 0, torso: 20 },
        } as unknown as LabSample;
      });
    expect(analyze(track(null)).pops).toEqual([]);
    const pops = analyze(track(30)).pops;
    expect(pops.map((p) => p.joint)).toEqual(['palmL']);
    // The second difference peaks the frame after the jump.
    expect(Math.abs(pops[0].at * 60 - 30)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
