import { useSyncExternalStore } from 'react';
import { createMatch, nextPeriod, startMatch, togglePause } from './engine';
import { ArenaAudio } from '../audio/sound';
import { Controller, type ReplayInput } from '../input/controller';
import type { Club } from './clubs';
import { DEFAULT_DIFFICULTY } from './difficulty';
import { modeInfo } from './modes';
import {
  advanceReplay,
  cycleReplayCamera,
  ReplayBuffer,
  REPLAY_HZ,
  seekReplay,
  shiftReplaySpeed,
  startReplay,
  stepReplay,
  toggleReplayPlayback,
  type ReplaySession,
} from './replay';
import type { GameMode, MatchState, Settings, Team } from './types';
export const runtime = {
  match: createMatch(),
  controller: new Controller(),
  audio: new ArenaAudio(),
  /** Recent play, recorded by the simulation loop. */
  recorder: new ReplayBuffer(),
  /** The replay on screen, if any. The live match holds still underneath it. */
  replay: null as ReplaySession | null,
  settings: {
    sound: true,
    camera: 'broadcast',
    quality: 'high',
    beginner: true,
    difficulty: DEFAULT_DIFFICULTY,
    goalReplays: true,
  } as Settings,
};
let revision = 0;
const listeners = new Set<() => void>();
export const publish = () => {
  revision++;
  listeners.forEach((fn) => fn());
};
export function useGame() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => revision,
  );
  return runtime;
}
/** The state the scene draws: the replay while one is rolling, otherwise the live match. */
export const viewMatch = () => runtime.replay?.view ?? runtime.match;
/** How fast the drawn state moves against real time: replays run slow, held or reversed. */
export const viewTimeScale = () => (runtime.replay ? Math.abs(runtime.replay.rate) : 1);
export function beginGame(
  team: Team,
  mode: GameMode = 'exhibition',
  teams: [Club, Club] = runtime.match.teams,
) {
  runtime.audio.unlock();
  runtime.replay = null;
  runtime.match = createMatch(team, mode, teams);
  runtime.match.difficulty = runtime.settings.difficulty;
  startMatch(runtime.match);
  publish();
}
export function pauseGame() {
  togglePause(runtime.match);
  publish();
}
export function continueGame() {
  nextPeriod(runtime.match);
  publish();
}
export function returnToMenu() {
  runtime.replay = null;
  runtime.match = createMatch(runtime.match.homeTeam, 'exhibition', runtime.match.teams);
  publish();
}
export function updateSettings(settings: Partial<Settings>) {
  Object.assign(runtime.settings, settings);
  runtime.audio.enabled = runtime.settings.sound;
  if (settings.difficulty) runtime.match.difficulty = settings.difficulty;
  publish();
}
export const canInstantReplay = () => runtime.recorder.length >= REPLAY_HZ;
export function openInstantReplay() {
  const session = startReplay(runtime.match, runtime.recorder.snapshot(), 'instant');
  if (!session) return;
  runtime.replay = session;
  publish();
}
/** Scored games replay their goals; shootouts and practice keep moving. */
export function goalReplayWanted(s: MatchState = runtime.match) {
  return (
    runtime.settings.goalReplays &&
    s.scoringTeam !== null &&
    s.mode !== 'shootout' &&
    !modeInfo(s.mode).practice
  );
}
export function startGoalReplay() {
  if (!goalReplayWanted()) return false;
  const session = startReplay(runtime.match, runtime.recorder.snapshot(), 'goal');
  if (!session) return false;
  runtime.replay = session;
  publish();
  return true;
}
/** Leaves the replay. A goal replay hands straight back to the faceoff. */
export function closeReplay() {
  const r = runtime.replay,
    s = runtime.match;
  if (!r) return;
  runtime.replay = null;
  const celebrating = s.phase === 'goal' || (s.phase === 'paused' && s.previousPhase === 'goal');
  if (r.kind === 'goal' && celebrating) s.countdown = 0;
  publish();
}
/** One frame of replay: transport buttons, then camera sticks, then the playhead. */
export function driveReplay(r: ReplaySession, input: ReplayInput, dt: number) {
  if (r.kind === 'goal') {
    if (input.play || input.exit || input.camera || input.restart) return closeReplay();
  } else {
    if (input.exit) return closeReplay();
    if (input.play) toggleReplayPlayback(r);
    if (input.restart) {
      seekReplay(r, r.start);
      r.playing = true;
    }
    if (input.stepBack) stepReplay(r, -1);
    if (input.stepForward) stepReplay(r, 1);
    if (input.slower) shiftReplaySpeed(r, -1);
    if (input.faster) shiftReplaySpeed(r, 1);
    if (input.camera) cycleReplayCamera(r);
    Object.assign(r.camera.input, {
      orbitX: input.orbitX,
      orbitY: input.orbitY,
      moveX: input.moveX,
      moveZ: input.moveZ,
      zoom: input.zoom,
    });
  }
  const { events, finished } = advanceReplay(r, dt, r.kind === 'instant' ? input.scrub : 0);
  for (const event of events) runtime.audio.play(event);
  if (finished) closeReplay();
}
