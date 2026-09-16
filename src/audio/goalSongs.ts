/**
 * The soundtrack's drops. A goal starts a song right at its drop, so the beat lands with the
 * puck. `drop` is where the section hits in seconds, and `bpm` is the felt tempo, which the lamp,
 * the call and the pad rumble follow. Times were measured from the sub-band energy step; nudge
 * them here if a drop lands early or late.
 */
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
/** A song that is not the one that just played, so two goals in a row don't repeat. */
export function pickGoalSong(avoid?: string) {
  const pool = GOAL_SONGS.filter((song) => song.name !== avoid);
  return pool[Math.floor(Math.random() * pool.length)] ?? GOAL_SONGS[0];
}
