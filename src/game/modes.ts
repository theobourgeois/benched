import { RULES } from './config';
import type { GameMode, MatchState, Skater } from './types';

export interface ModeInfo {
  id: GameMode;
  tab: string;
  title: string;
  eyebrow: string;
  format: string;
  duration: string;
  tag: string;
  prompt: string;
  play: string;
  live: string;
  resume: string;
  endMatch: string;
  practice: boolean;
  scored: boolean;
  timed: boolean;
  faceoff: boolean;
  periods: number;
  periodSeconds: number;
}

export const SHOOTOUT_ROUNDS = 3;

export const MODES: ModeInfo[] = [
  {
    id: 'exhibition',
    tab: '5v5',
    title: 'SELECT TEAMS',
    eyebrow: 'EXHIBITION',
    format: '5 ON 5',
    duration: '3 PERIODS · 5 MINUTES',
    tag: 'LOCAL MATCH',
    prompt: 'SELECT YOUR SIDE',
    play: 'PLAY GAME',
    live: 'EXHIBITION / 5V5',
    resume: 'RESUME GAME',
    endMatch: 'End match & return to menu',
    practice: false,
    scored: true,
    timed: true,
    faceoff: true,
    periods: RULES.periods,
    periodSeconds: RULES.periodSeconds,
  },
  {
    id: 'threeOnThree',
    tab: '3v3',
    title: 'SELECT TEAMS',
    eyebrow: '3 ON 3',
    format: '3 ON 3',
    duration: '3 PERIODS · 3 MINUTES',
    tag: 'OPEN ICE',
    prompt: 'SELECT YOUR SIDE',
    play: 'PLAY GAME',
    live: '3 ON 3',
    resume: 'RESUME GAME',
    endMatch: 'End match & return to menu',
    practice: false,
    scored: true,
    timed: true,
    faceoff: true,
    periods: 3,
    periodSeconds: 180,
  },
  {
    id: 'oneOnOne',
    tab: '1v1',
    title: 'SELECT TEAMS',
    eyebrow: '1 ON 1',
    format: '1 ON 1',
    duration: '3 PERIODS · 3 MINUTES',
    tag: 'POND HOCKEY',
    prompt: 'SELECT YOUR SIDE',
    play: 'PLAY GAME',
    live: '1 ON 1',
    resume: 'RESUME GAME',
    endMatch: 'End match & return to menu',
    practice: false,
    scored: true,
    timed: true,
    faceoff: true,
    periods: 3,
    periodSeconds: 180,
  },
  {
    id: 'shootout',
    tab: 'SHOOTOUT',
    title: 'SELECT TEAMS',
    eyebrow: 'SHOOTOUT',
    format: 'BREAKAWAYS',
    duration: 'BEST OF 3 · THEN SUDDEN DEATH',
    tag: 'YOU SHOOT FIRST',
    prompt: 'SELECT YOUR SIDE',
    play: 'PLAY GAME',
    live: 'SHOOTOUT',
    resume: 'RESUME SHOOTOUT',
    endMatch: 'End shootout & return to menu',
    practice: false,
    scored: true,
    timed: true,
    faceoff: false,
    periods: 0,
    periodSeconds: 15,
  },
  {
    id: 'freeSkate',
    tab: 'SKATE',
    title: 'FREE SKATE',
    eyebrow: 'FREE SKATE',
    format: 'OPEN ICE',
    duration: 'YOU VS GOALIE',
    tag: 'PRACTICE',
    prompt: 'PRACTICE YOUR MOVES',
    play: 'START SKATE',
    live: 'FREE SKATE / 1V0',
    resume: 'RESUME SKATE',
    endMatch: 'End skate & return to menu',
    practice: true,
    scored: false,
    timed: false,
    faceoff: false,
    periods: 0,
    periodSeconds: RULES.periodSeconds,
  },
];

export function modeInfo(mode: GameMode): ModeInfo {
  switch (mode) {
    case 'exhibition':
      return MODES[0];
    case 'threeOnThree':
      return MODES[1];
    case 'oneOnOne':
      return MODES[2];
    case 'shootout':
      return MODES[3];
    case 'freeSkate':
      return MODES[4];
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** Who is actually on the ice for this mode. Everyone else is parked off the rink. */
export function isOnIce(s: MatchState, p: Skater) {
  switch (s.mode) {
    case 'exhibition':
      return true;
    case 'threeOnThree':
      return p.role === 'C' || p.role === 'LW' || p.role === 'RW' || p.role === 'G';
    case 'oneOnOne':
      return p.role === 'C' || p.role === 'G';
    case 'freeSkate':
      return p.id === s.homeTeam * 6 || (p.team !== s.homeTeam && p.role === 'G');
    case 'shootout': {
      const shooting = p.team === s.shootoutShooter && p.role === 'C';
      const keeping = p.team !== s.shootoutShooter && p.role === 'G';
      return shooting || keeping;
    }
    default: {
      const _exhaustive: never = s.mode;
      return _exhaustive;
    }
  }
}
