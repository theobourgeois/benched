import { useSyncExternalStore } from 'react';
import { createMatch, nextPeriod, startMatch, togglePause } from './engine';
import { ArenaAudio } from '../audio/sound';
import { Controller } from '../input/controller';
import type { Club } from './clubs';
import type { GameMode, Settings, Team } from './types';
export const runtime = {
  match: createMatch(),
  controller: new Controller(),
  audio: new ArenaAudio(),
  settings: { sound: true, camera: 'broadcast', quality: 'high', beginner: true } as Settings,
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
export function beginGame(
  team: Team,
  mode: GameMode = 'exhibition',
  teams: [Club, Club] = runtime.match.teams,
) {
  runtime.audio.unlock();
  runtime.match = createMatch(team, mode, teams);
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
  runtime.match = createMatch(runtime.match.homeTeam, 'exhibition', runtime.match.teams);
  publish();
}
export function updateSettings(settings: Partial<Settings>) {
  Object.assign(runtime.settings, settings);
  runtime.audio.enabled = runtime.settings.sound;
  publish();
}
