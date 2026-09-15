import { describe, expect, it } from 'vitest';
import { createMatch, emit, startMatch } from '../src/game/engine';
import { attackDirection, RINK } from '../src/game/config';
import {
  advanceReplay,
  createView,
  cycleReplayCamera,
  eventsBetween,
  findGoal,
  GOAL_REPLAY,
  goalReplayRate,
  ReplayBuffer,
  REPLAY_HZ,
  sampleReplay,
  seekReplay,
  setReplayCamera,
  startReplay,
  stepReplay,
  toggleReplayPlayback,
} from '../src/game/replay';
import { orbitPosition, panFocus, replayFraming, seedOrbit } from '../src/scene/replayCamera';
import type { GameEvent, MatchState } from '../src/game/types';

/** Records one snapshot per call, after `change` sets up that moment. */
function film(count: number, change: (s: MatchState, i: number) => void = () => {}) {
  const s = createMatch();
  startMatch(s);
  const buffer = new ReplayBuffer();
  for (let i = 0; i < count; i++) {
    change(s, i);
    buffer.record(s);
  }
  return { s, buffer, frames: buffer.snapshot() };
}

/** Eight seconds of play: a defender has it, the scorer carries it, then a goal at 6 s. */
const GOAL_AT = 6 * REPLAY_HZ;
function filmGoal() {
  const probe = createMatch();
  const scorer = probe.skaters.find((p) => p.team === 0 && p.role !== 'G')!.id;
  const defender = probe.skaters.find((p) => p.team === 1 && p.role !== 'G')!.id;
  const film_ = film(8 * REPLAY_HZ, (s, i) => {
    s.puck.owner = i < GOAL_AT - 100 ? defender : i < GOAL_AT - 20 ? scorer : null;
    s.puck.x = i * 0.01;
    if (i === GOAL_AT) {
      s.phase = 'goal';
      s.scoringTeam = 0;
      emit(s, 'goal');
    }
  });
  return { ...film_, scorer };
}

const current = {
  position: [0, 20, 25] as const,
  target: [0, 0.6, 0] as const,
};

describe('replay buffer', () => {
  it('keeps the most recent window, oldest first', () => {
    const s = createMatch();
    const buffer = new ReplayBuffer(10);
    for (let i = 0; i < 25; i++) {
      s.puck.x = i;
      buffer.record(s);
    }
    expect(buffer.length).toBe(10);
    expect(buffer.snapshot().map((f) => f.puck.x)).toEqual([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it('stores copies, not the live skaters', () => {
    const { s, frames } = film(1, (s) => {
      s.skaters[0].x = 3;
      s.skaters[0].queuedCheck = { x: 1, z: 0, load: 0.5, timer: 0.1 };
    });
    s.skaters[0].x = 99;
    s.skaters[0].queuedCheck!.load = 1;
    s.puck.x = 99;
    expect(frames[0].skaters[0].x).toBe(3);
    expect(frames[0].skaters[0].queuedCheck!.load).toBe(0.5);
    expect(frames[0].puck.x).not.toBe(99);
  });

  it('records each event once, on the snapshot after it happened', () => {
    const { frames } = film(3, (s, i) => {
      if (i === 1) emit(s, 'shot', 0.8);
    });
    expect(frames.map((f) => f.events.map((e) => e.type))).toEqual([[], ['shot'], []]);
  });

  it('starts over when the period or the match changes', () => {
    const { s, buffer } = film(5);
    s.period = 2;
    buffer.record(s);
    expect(buffer.length).toBe(1);
    buffer.record(createMatch());
    expect(buffer.length).toBe(1);
  });
});

describe('replay sampling', () => {
  it('blends positions and turns the short way round', () => {
    const { s, frames } = film(2, (s, i) => {
      s.skaters[0].x = i * 2;
      s.skaters[0].angle = i ? -Math.PI + 0.1 : Math.PI - 0.1;
      s.puck.owner = i ? 3 : null;
    });
    const view = createView(s);
    sampleReplay(view, frames, 0.25 / REPLAY_HZ);
    expect(view.skaters[0].x).toBeCloseTo(0.5);
    expect(Math.abs(view.skaters[0].angle)).toBeGreaterThan(Math.PI - 0.1);
    expect(view.puck.owner).toBeNull();
    sampleReplay(view, frames, 0.75 / REPLAY_HZ);
    expect(view.puck.owner).toBe(3);
  });

  it('cuts across a reset instead of sliding skaters over the ice', () => {
    const { s, frames } = film(2, (s, i) => (s.skaters[0].x = i * 20));
    const view = createView(s);
    sampleReplay(view, frames, 0.4 / REPLAY_HZ);
    expect(view.skaters[0].x).toBe(0);
    sampleReplay(view, frames, 0.6 / REPLAY_HZ);
    expect(view.skaters[0].x).toBe(20);
  });

  it('poses a copy and leaves the live match alone', () => {
    const { s, frames } = film(2, (s, i) => (s.skaters[0].x = i));
    const view = createView(s);
    s.skaters[0].x = 7;
    sampleReplay(view, frames, 0);
    expect(view.skaters[0]).not.toBe(s.skaters[0]);
    expect(view.skaters[0].x).toBe(0);
    expect(s.skaters[0].x).toBe(7);
  });
});

describe('replay timeline', () => {
  it('passes on events only for snapshots crossed going forward', () => {
    const { frames } = film(6, (s, i) => {
      if (i === 3) emit(s, 'hit', 0.6);
    });
    const at = (f: number) => f / REPLAY_HZ;
    expect(eventsBetween(frames, at(2), at(3)).map((e) => e.type)).toEqual(['hit']);
    expect(eventsBetween(frames, at(3), at(5))).toEqual([]);
    expect(eventsBetween(frames, at(0), at(2.5))).toEqual([]);
  });

  it('finds the goal and the skater who carried it in', () => {
    const { frames, scorer } = filmGoal();
    expect(findGoal(frames)).toEqual({ time: GOAL_AT / REPLAY_HZ, team: 0, scorer });
  });

  it('frames a goal replay around the finish', () => {
    const { s, frames } = filmGoal();
    const r = startReplay(s, frames, 'goal')!;
    const goal = GOAL_AT / REPLAY_HZ;
    expect(r.start).toBeCloseTo(goal - GOAL_REPLAY.before);
    expect(r.end).toBeCloseTo(goal + GOAL_REPLAY.after);
    expect(r.time).toBe(r.start);
    expect(r.camera.mode).toBe('cinematic');
  });

  it('only offers a goal replay when a goal was recorded', () => {
    const { s, frames } = film(3 * REPLAY_HZ);
    expect(startReplay(s, frames, 'goal')).toBeNull();
    const r = startReplay(s, frames, 'instant')!;
    expect(r.start).toBe(0);
    expect(r.end).toBeCloseTo((frames.length - 1) / REPLAY_HZ);
    expect(r.camera.mode).toBe('puck');
  });

  it('runs the build-up at full speed and the finish in slow motion', () => {
    const { s, frames } = filmGoal();
    const r = startReplay(s, frames, 'goal')!;
    expect(goalReplayRate(r)).toBe(1);
    seekReplay(r, r.goal!.time);
    expect(goalReplayRate(r)).toBeCloseTo(GOAL_REPLAY.slowRate);
  });

  it('plays a goal replay through once, replaying its goal to the view', () => {
    const { s, frames } = filmGoal();
    const r = startReplay(s, frames, 'goal')!;
    const heard: GameEvent[] = [];
    let finished = false,
      ticks = 0;
    while (!finished && ticks++ < 20 * 60) {
      const step = advanceReplay(r, 1 / 60);
      heard.push(...step.events);
      finished = step.finished;
    }
    expect(finished).toBe(true);
    expect(r.time).toBe(r.end);
    expect(heard.filter((e) => e.type === 'goal')).toHaveLength(1);
    expect(r.view.events.some((e) => e.type === 'goal' && e.id > 0)).toBe(true);
    // Slow motion stretches the finish, but the whole thing stays a short break.
    expect(ticks / 60).toBeGreaterThan(r.end - r.start);
    expect(ticks / 60).toBeLessThan(9);
  });

  it('opens an instant replay held until you press play', () => {
    const { s, frames } = film(3 * REPLAY_HZ);
    const r = startReplay(s, frames, 'instant')!;
    const time = r.time;
    advanceReplay(r, 1);
    expect(r.playing).toBe(false);
    expect(r.time).toBe(time);
    toggleReplayPlayback(r);
    advanceReplay(r, 0.5);
    expect(r.time).toBeCloseTo(time + 0.5);
  });

  it('holds an instant replay at the end and restarts from the top', () => {
    const { s, frames } = film(3 * REPLAY_HZ);
    const r = startReplay(s, frames, 'instant')!;
    r.playing = true;
    for (let i = 0; i < 10 * 60; i++) advanceReplay(r, 1 / 60);
    expect(r.playing).toBe(false);
    expect(r.time).toBe(r.end);
    toggleReplayPlayback(r);
    expect(r.time).toBe(r.start);
    expect(r.playing).toBe(true);
  });

  it('rewinds on the trigger without replaying sounds', () => {
    const { s, frames } = filmGoal();
    const r = startReplay(s, frames, 'instant')!;
    seekReplay(r, r.end);
    const step = advanceReplay(r, 0.5, -1);
    expect(r.time).toBeCloseTo(r.end - 1);
    expect(r.rate).toBeCloseTo(-2);
    expect(step.events).toEqual([]);
  });

  it('frame steps pause and move one snapshot', () => {
    const { s, frames } = film(3 * REPLAY_HZ);
    const r = startReplay(s, frames, 'instant')!;
    seekReplay(r, 1.5);
    const before = r.time;
    stepReplay(r, -1);
    expect(r.playing).toBe(false);
    expect(r.time).toBeCloseTo(before - 1 / REPLAY_HZ);
  });
});

describe('replay camera', () => {
  it('takes over from the current shot without a jump', () => {
    const { s, frames } = film(REPLAY_HZ);
    const cam = startReplay(s, frames, 'instant')!.camera;
    seedOrbit(cam, [3, 20, 25], [1, 0.6, -2]);
    orbitPosition(cam).forEach((v, i) => expect(v).toBeCloseTo([3, 20, 25][i]));
  });

  it('moves the free camera the way it faces', () => {
    const { s, frames } = film(REPLAY_HZ);
    const cam = startReplay(s, frames, 'instant')!.camera;
    cam.focus = { x: 0, y: 0.5, z: 0 };
    cam.yaw = 0; // behind +z, looking toward −z
    panFocus(cam, 0, -1);
    expect(cam.focus.z).toBeCloseTo(-1);
    panFocus(cam, 1, 0);
    expect(cam.focus.x).toBeCloseTo(1);
    cam.yaw = Math.PI / 2; // behind +x, looking toward −x
    panFocus(cam, 0, -1);
    expect(cam.focus.x).toBeCloseTo(0);
  });

  it('cuts from the chase to behind the net for the slow-motion finish', () => {
    const { s, frames } = filmGoal();
    const r = startReplay(s, frames, 'goal')!;
    expect(replayFraming(r, 1 / 60, 1.6, 'broadcast', current).cut).toBe(true);
    expect(replayFraming(r, 1 / 60, 1.6, 'broadcast', current).cut).toBe(false);
    seekReplay(r, r.goal!.time);
    const net = replayFraming(r, 1 / 60, 1.6, 'broadcast', current);
    expect(net.cut).toBe(true);
    const sign = attackDirection(r.goal!.team, r.view.period);
    expect(net.position[0] * sign).toBeGreaterThan(RINK.goalX);
  });

  it('hands the broadcast angle to the orbit once you steer', () => {
    const { s, frames } = film(REPLAY_HZ);
    const r = startReplay(s, frames, 'instant')!;
    setReplayCamera(r, 'broadcast');
    expect(replayFraming(r, 1 / 60, 1.6, 'broadcast', current).cut).toBe(false);
    r.camera.drag.x = 40;
    const yaw = r.camera.yaw;
    replayFraming(r, 1 / 60, 1.6, 'broadcast', current);
    expect(r.camera.mode).toBe('puck');
    expect(r.camera.yaw).not.toBe(yaw);
    expect(r.camera.drag.x).toBe(0);
  });

  it('switches to free cam when you move the focus off the puck', () => {
    const { s, frames } = film(REPLAY_HZ);
    const r = startReplay(s, frames, 'instant')!;
    r.camera.input.moveZ = -1;
    replayFraming(r, 1 / 60, 1.6, 'broadcast', current);
    expect(r.camera.mode).toBe('free');
    cycleReplayCamera(r);
    expect(r.camera.mode).toBe('broadcast');
  });
});
