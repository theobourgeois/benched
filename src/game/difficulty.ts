import type { Difficulty, MatchState, Skater } from './types';

export interface DifficultyInfo {
  id: Difficulty;
  label: string;
  hint: string;
}

export const DEFAULT_DIFFICULTY: Difficulty = 'allStar';

export const DIFFICULTIES: DifficultyInfo[] = [
  {
    id: 'rookie',
    label: 'Rookie',
    hint: 'Slower skaters, softer gaps, and a goalie you can beat.',
  },
  {
    id: 'pro',
    label: 'Pro',
    hint: 'A step down from All-Star. Room to make plays.',
  },
  {
    id: 'allStar',
    label: 'All-Star',
    hint: 'The standard CPU. Sharp, but beatable.',
  },
  {
    id: 'legend',
    label: 'Legend',
    hint: 'Faster, tighter, and they finish their chances.',
  },
];

export function difficultyInfo(id: Difficulty): DifficultyInfo {
  switch (id) {
    case 'rookie':
      return DIFFICULTIES[0];
    case 'pro':
      return DIFFICULTIES[1];
    case 'allStar':
      return DIFFICULTIES[2];
    case 'legend':
      return DIFFICULTIES[3];
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/** How an opposing CPU plays. All-Star is a 1× copy of the original AI. */
export interface CpuTune {
  /** Top speed and first-stride push vs All-Star. */
  speed: number;
  /** Lead on a moving puck or carrier. */
  lead: number;
  /** Extra gap they hold when still in front. */
  gap: number;
  /** Stick ease when chasing; lower closes harder. All-Star chase is 1.05. */
  chaseEase: number;
  /** Goalie lateral tracking of the puck. Under 1 lags inside the angle; over 1 is capped at square. */
  track: number;
  /** How far the goalie comes out. */
  depth: number;
  /** CPU goalie reach: hands and pads scale by this. */
  save: number;
  /** Seconds between a shot's release and the goalie committing to it. */
  reaction: number;
  /** How readily they hustle. */
  hustle: number;
  /** How readily they poke and hit. */
  bite: number;
  /** Scoring look required to shoot. All-Star is 0.42. */
  shootLook: number;
  /** Pressed look that still rips it. All-Star is 0.2. */
  shootPress: number;
  /** Extra shot-aim wobble. All-Star is 0.32. */
  wobble: number;
  /** How readily they pass to a better look. */
  pass: number;
  /** How often they handle around a defender. */
  handle: number;
}

const ALL_STAR: CpuTune = {
  speed: 1,
  lead: 1,
  gap: 1,
  chaseEase: 1.05,
  track: 1,
  depth: 1,
  save: 1,
  reaction: 0.11,
  hustle: 1,
  bite: 1,
  shootLook: 0.42,
  shootPress: 0.2,
  wobble: 0.32,
  pass: 1,
  handle: 1,
};

const ROOKIE: CpuTune = {
  speed: 0.76,
  lead: 0.5,
  gap: 1.65,
  chaseEase: 1.55,
  track: 0.52,
  depth: 0.72,
  save: 0.68,
  reaction: 0.22,
  hustle: 0.5,
  bite: 0.38,
  shootLook: 0.64,
  shootPress: 0.38,
  wobble: 0.58,
  pass: 0.55,
  handle: 0.35,
};

const PRO: CpuTune = {
  speed: 0.88,
  lead: 0.8,
  gap: 1.22,
  chaseEase: 1.22,
  track: 0.8,
  depth: 0.88,
  save: 0.86,
  reaction: 0.16,
  hustle: 0.78,
  bite: 0.72,
  shootLook: 0.5,
  shootPress: 0.28,
  wobble: 0.42,
  pass: 0.8,
  handle: 0.7,
};

const LEGEND: CpuTune = {
  speed: 1.14,
  lead: 1.42,
  gap: 0.68,
  chaseEase: 0.78,
  track: 1.38,
  depth: 1.22,
  save: 1.28,
  reaction: 0.075,
  hustle: 1.45,
  bite: 1.65,
  shootLook: 0.28,
  shootPress: 0.12,
  wobble: 0.1,
  pass: 1.28,
  handle: 1.2,
};

export function tuneFor(difficulty: Difficulty): CpuTune {
  switch (difficulty) {
    case 'rookie':
      return ROOKIE;
    case 'pro':
      return PRO;
    case 'allStar':
      return ALL_STAR;
    case 'legend':
      return LEGEND;
    default: {
      const _exhaustive: never = difficulty;
      return _exhaustive;
    }
  }
}

/**
 * A human's own bench skates All-Star; a side with nobody on it uses the match difficulty. With
 * two people playing, both benches are All-Star and neither side is handed an easier opponent.
 */
export function cpuTune(s: MatchState, p: Skater): CpuTune {
  return s.sides[p.team].human ? ALL_STAR : tuneFor(s.difficulty);
}
