/**
 * The soundtrack's drops. A goal starts a song a couple of seconds before its drop, so the iron
 * and the lamp have room to speak before the beat lands. `drop` is where the section hits in
 * seconds, and `bpm` is the felt tempo, which the lamp, the call and the pad rumble follow. Times
 * were measured from the sub-band energy step; nudge them here if a drop lands early or late.
 */
import { clamp } from '../game/math';

export interface GoalSong {
  /** File name under audio/music, without the extension. */
  name: string;
  drop: number;
  bpm: number;
}
export const GOAL_SONGS: GoalSong[] = [
  { name: 'leakssped', drop: 29.88, bpm: 94 },
  { name: 'yo1vox', drop: 61.96, bpm: 77 },
  { name: 'chopmyfingersoff', drop: 120.04, bpm: 107 },
  { name: 'swagdemo2', drop: 12.86, bpm: 82.25 },
  { name: 'blindluckvox', drop: 32.12, bpm: 114 },
];
/** Seconds of build before the drop, enough to hear a bar-down without waiting on the beat. */
export const GOAL_LEAD_IN = 1.8;
const LEAD_FLOOR = 0.28;
/** A song that is not the one that just played, so two goals in a row don't repeat. */
export function pickGoalSong(avoid?: string) {
  const pool = GOAL_SONGS.filter((song) => song.name !== avoid);
  return pool[Math.floor(Math.random() * pool.length)] ?? GOAL_SONGS[0];
}
/** Where the playhead sits so a goal can start without seeking, still short of the drop. */
export function songCueTime(drop: number, leadIn = GOAL_LEAD_IN) {
  return Math.max(0, drop - leadIn);
}
/**
 * Music gain on the way into a drop: quiet at the cue so the goal sound reads, then a swell
 * that hits full as the section lands. A pause ducks the same way the old mix did.
 */
export function celebrationLevel(
  currentTime: number,
  drop: number,
  paused: boolean,
  leadIn = GOAL_LEAD_IN,
) {
  if (paused) return 0.22;
  const untilDrop = drop - currentTime;
  if (untilDrop <= 0 || leadIn <= 0) return 1;
  const t = clamp(1 - untilDrop / leadIn, 0, 1);
  return LEAD_FLOOR + (1 - LEAD_FLOOR) * t * t;
}
