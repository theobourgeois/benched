import { clubByKey, DEFAULT_MATCHUP, type Club } from '../game/clubs';
import { createMatch, startMatch } from '../game/engine';
import type { Team } from '../game/types';
import type { MatchSetup } from '../net/protocol';
import { NetSession, ROOM_HOST } from '../net/session';
import { publish, returnToMenu, runtime } from './store';

/**
 * The online session's lifecycle, in one place. Every way into a room — a typed code, an invite
 * link, and in time a public list — goes through `connectToRoom`, and every way out goes through
 * `disconnect`, so the runtime is wired up and torn down the same way whichever door was used.
 *
 * The session itself (`NetSession`) knows nothing about the runtime; this is the only file that
 * joins the two.
 */

/** Open a room, or join one, and put the session in the runtime. Any earlier session is hung up. */
export function connectToRoom(code: string, name = 'Player'): NetSession {
  runtime.net?.close();
  const session = new NetSession(code, ROOM_HOST, name);
  session.onStart = (setup) => beginOnlineMatch(setup, session.team);
  runtime.net = session;
  runtime.leaving = false;
  publish();
  return session;
}

/** Hang up and forget the room. The screen on top decides where to go next. */
export function disconnect() {
  runtime.net?.close();
  runtime.net = null;
  runtime.leaving = false;
  publish();
}

/**
 * Off the ice and back to the room's lobby, still connected, after a match was called off. The
 * menu opens on the lobby for a session with no match on, so whoever left can rejoin with the
 * same code and the two of you go again.
 */
export function returnToLobby() {
  runtime.leaving = false;
  returnToMenu();
}

/** Hang up mid-match or from the lobby, and put the menu back. */
export function leaveOnline() {
  disconnect();
  returnToMenu();
}

/**
 * A match agreed with somebody else. Both ends build the same one from the same setup, and both
 * benches are human, so neither side gets the easier opponent.
 */
export function beginOnlineMatch(setup: MatchSetup, myTeam: Team) {
  runtime.audio.unlock();
  runtime.replay = null;
  runtime.myTeam = myTeam;
  runtime.leaving = false;
  const clubs: [Club, Club] = [
    clubByKey(setup.clubs[0]) ?? DEFAULT_MATCHUP[0],
    clubByKey(setup.clubs[1]) ?? DEFAULT_MATCHUP[1],
  ];
  runtime.match = createMatch([0, 1], setup.mode, clubs, setup.jerseys);
  startMatch(runtime.match);
  publish();
}

/**
 * Online play has no pause: the other person is still playing. The pause button asks whether you
 * mean to leave instead. This raises, or lowers, that question.
 */
export function askToLeave(asking: boolean) {
  runtime.leaving = asking;
  publish();
}
