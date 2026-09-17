import { driveSkater } from '../src/game/engine';
import type { InputFrame, MatchState, SideInputs, Team } from '../src/game/types';

/**
 * Route one person's input to whichever side they are sitting on, so a test can keep speaking in
 * single frames while the simulation takes one per side.
 */
export function seat(s: MatchState, input: InputFrame): SideInputs {
  return [s.sides[0].humans.length ? [input] : [], s.sides[1].humans.length ? [input] : []];
}

/** Put the person on the skater's side, driving that skater, and leave the other side to the CPU. */
export function drive(s: MatchState, id: number) {
  const other = (1 - s.skaters[id].team) as Team;
  driveSkater(s, id);
  s.sides[other].humans = [];
}

/** The side a test is playing from. */
export const played = (s: MatchState): Team =>
  s.sides[1].humans.length && !s.sides[0].humans.length ? 1 : 0;

/** The skater that side is holding. */
export const playing = (s: MatchState) => s.skaters[s.sides[played(s)].humans[0].controlled];
