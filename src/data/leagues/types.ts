/** Shape of a league snapshot in src/data/leagues, written by scripts/fetch-*.ts. */
export type Position = 'C' | 'LW' | 'RW' | 'D' | 'G';

/** Attribute names follow EA's NHL ratings so EA and derived ratings share one 0–99 scale. */
export const SKATER_RATINGS = [
  'speed',
  'acceleration',
  'agility',
  'balance',
  'strength',
  'endurance',
  'puckControl',
  'deking',
  'handeye',
  'passing',
  'wristshotPower',
  'wristshotAccuracy',
  'slapshotPower',
  'slapshotAccuracy',
  'bodyChecking',
  'stickChecking',
  'shotBlocking',
  'faceoffs',
  'offensiveAwareness',
  'defensiveAwareness',
  'aggression',
  'poise',
] as const;
export const GOALIE_RATINGS = [
  'glovesideHigh',
  'glovesideLow',
  'sticksideHigh',
  'sticksideLow',
  'fiveHole',
  'angles',
  'reboundControl',
  'pokeCheck',
  'breakaway',
  'speed',
  'agility',
  'shotRecover',
  'vision',
  'passing',
  'poise',
  'endurance',
] as const;
export type SkaterRatings = Record<(typeof SKATER_RATINGS)[number], number>;
export type GoalieRatings = Record<(typeof GOALIE_RATINGS)[number], number>;

interface PlayerBase {
  /** NHL player id. */
  id: number;
  firstName: string;
  lastName: string;
  number: number;
  shoots: 'L' | 'R';
  heightIn: number;
  weightLb: number;
  birthDate: string;
  country: string;
  headshot: string;
  overall: number;
  /** 'ea' when EA publishes this player, otherwise derived from stats and tracking data. */
  ratingSource: 'ea' | 'derived';
}
export type LeagueSkater = PlayerBase & {
  position: Exclude<Position, 'G'>;
  ratings: SkaterRatings;
};
export type LeagueGoalie = PlayerBase & { position: 'G'; ratings: GoalieRatings };
export type LeaguePlayer = LeagueSkater | LeagueGoalie;

export interface LeagueTeam {
  abbr: string;
  /** Full name, e.g. "Toronto Maple Leafs". */
  name: string;
  city: string;
  nickname: string;
  conference: string;
  division: string;
  colors: { primary: string; secondary: string };
  /** Paths under public/, for light and dark backgrounds. */
  logos: { light: string; dark: string };
  players: LeaguePlayer[];
}

export interface League {
  id: string;
  name: string;
  abbr: string;
  /** Season the rosters belong to, e.g. "20262027". */
  rosterSeason: string;
  /** Season whose stats drove the derived ratings. */
  statsSeason: string;
  fetchedAt: string;
  teams: LeagueTeam[];
}
