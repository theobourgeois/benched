import { isOnIce } from './modes';
import type { Human, MatchState, Skater, Team } from './types';

/** The most people one side can seat: a stick for every skater on the roster. */
export const MAX_HUMANS = 6;

export function createHuman(controlled: number): Human {
  return {
    controlled,
    autoSkate: false,
    shotCharge: 0,
    shotAim: 0,
    shotLift: 0,
    passHeld: false,
    passAim: { x: 0, z: 0 },
    passTarget: null,
    passRange: 0,
  };
}

/** The person holding this skater, if anybody is. */
export const humanOn = (s: MatchState, p: Skater): Human | undefined =>
  s.sides[p.team].humans.find((h) => h.controlled === p.id);

/**
 * The person on a side whose point of view counts right now: whoever has the puck, then the first
 * seat that is on the ice, then the first seat. With one person on a bench that is simply them;
 * with two it keeps the camera and the skate sound on the play rather than on whoever sat down
 * first, and off a seat that is sitting out a shootout attempt.
 */
export function leadHuman(s: MatchState, team: Team): Human | undefined {
  const humans = s.sides[team].humans;
  return (
    humans.find((h) => h.controlled === s.puck.owner) ??
    humans.find((h) => isOnIce(s, s.skaters[h.controlled])) ??
    humans[0]
  );
}
