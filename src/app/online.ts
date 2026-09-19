import {
  clubByKey,
  DEFAULT_MATCHUP,
  jerseysFor,
  LEAGUES,
  openingMatchup,
  type Club,
} from '../game/clubs';
import { createMatch, startMatch } from '../game/engine';
import type { GameMode, Team } from '../game/types';
import type { DirectorySession } from '../net/directory';
import {
  FOUND_CONFIRM_MS,
  GAME_STYLES,
  JOIN_WAIT_MS,
  RINK_SIZES,
  type MatchSetup,
  type QuickMode,
} from '../net/protocol';
import { NetSession, ROOM_HOST } from '../net/session';
import { beginGame, publish, returnToMenu, runtime } from './store';

/**
 * The online session's lifecycle, in one place. Every way into a room — a typed code, an invite
 * link, a room picked off the list, quick play — goes through `connectToRoom`, and every way out
 * goes through `disconnect`, so the runtime is wired up and torn down the same way whichever
 * door was used.
 *
 * Quick play is the odd one. Nobody waits in a lobby for a stranger, so whoever has to wait
 * hosts a public room and plays the AI in the meantime. That session lives in `runtime.queue`,
 * not `runtime.net`: the match on the ice is a local one, and the loop treats it as such. When
 * somebody walks in the host is asked, and only their yes turns the warm-up into the match.
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
  runtime.quickJoin = false;
  publish();
  return session;
}

/** Hang up and forget the room. The screen on top decides where to go next. */
export function disconnect() {
  runtime.net?.close();
  runtime.net = null;
  runtime.leaving = false;
  runtime.quickJoin = false;
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
  runtime.seatTwo = null;
  runtime.leaving = false;
  const clubs: [Club, Club] = [
    clubByKey(setup.clubs[0]) ?? DEFAULT_MATCHUP[0],
    clubByKey(setup.clubs[1]) ?? DEFAULT_MATCHUP[1],
  ];
  // The host's style and rink, never this client's own: both ends have to be on the same ice.
  // A value this build does not know (a newer host) falls back rather than indexing nothing.
  runtime.match = createMatch([0, 1], setup.mode, clubs, setup.jerseys, {
    style: GAME_STYLES.includes(setup.style!) ? setup.style : 'fast',
    rink: RINK_SIZES.includes(setup.rink!) ? setup.rink : 'barn',
  });
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

/**
 * What the host will have both ends build. The host keeps the side and club they are holding;
 * the other person gets the club they picked, or the one across the ice if they picked nothing
 * or the same one.
 */
export function setupFor(net: NetSession, mine: Club, across: Club): MatchSetup {
  const me = net.me;
  const them = net.opponent;
  const myTeam = me?.team ?? 0;
  const picked = them?.club ? clubByKey(them.club) : undefined;
  const theirs = picked && picked.key !== mine.key ? picked : across;
  const clubs: [string, string] = myTeam === 0 ? [mine.key, theirs.key] : [theirs.key, mine.key];
  return {
    mode: net.mode,
    clubs,
    jerseys: jerseysFor(myTeam, 'home'),
    hostTeam: myTeam,
    style: runtime.settings.style,
    rink: runtime.settings.rink,
  };
}

/**
 * Quick play. Ask the directory where to go: into the room whose host has waited longest, or a
 * fresh one to host and wait in ourselves. With a `code` it is a room picked off the list, and
 * we walk into its lobby the way an invite link does. False when that room is no longer open.
 */
export async function quickPlay(
  directory: DirectorySession,
  mode: QuickMode,
  code?: string,
): Promise<boolean> {
  const to = await directory.quick(mode, code);
  if (!to) return false;
  if (code) connectToRoom(to.code);
  else if (to.host) hostQueue(to.code, mode);
  else joinQueue(to.code, mode, directory);
  return true;
}

/** The queued room, and what can be done about it, while a warm-up is on. */
let queued: { confirm: () => void; lookAgain: () => void; leave: () => void } | null = null;

/**
 * Nobody was waiting, so we will be: open a public room, and play the AI until somebody comes.
 * The room is asked to put us on the side and the mode we are warming up in, so the match that
 * follows is the one being practised for.
 */
function hostQueue(code: string, mode: QuickMode) {
  leaveQueue();
  runtime.net?.close();
  runtime.net = null;
  const warm: GameMode = mode === 'any' ? 'exhibition' : mode;
  const session = new NetSession(code, ROOM_HOST, 'Player');
  session.setPublic(true);
  runtime.queue = session;
  runtime.found = null;
  runtime.quickJoin = false;
  runtime.leaving = false;
  beginGame(runtime.myTeam, warm);
  const mine = runtime.match.teams[runtime.myTeam];
  const across = runtime.match.teams[1 - runtime.myTeam];

  let seated = false;
  let confirmed = false;
  let startedFor = '';
  const unwatch = session.watch(() => {
    if (session.status === 'lobby' && !seated) {
      seated = true;
      if (session.team !== runtime.myTeam) session.pickTeam(runtime.myTeam);
      if (session.mode !== warm) session.setMode(warm);
      session.setClub(mine.key);
    }
    const other = session.opponent;
    if (other && !runtime.found) runtime.found = { since: performance.now(), missed: false };
    if (!other && runtime.found && !runtime.found.missed) {
      // They did not wait for us. Back to warming up, still listed.
      runtime.found = null;
      confirmed = false;
    }
    // Both said yes: the puck drops once, for this person.
    if (confirmed && other && session.everyoneReady && startedFor !== other.id) {
      startedFor = other.id;
      session.start(setupFor(session, mine, across));
    }
    publish();
  });
  // A host who does not answer is taken off the list, so nobody else is sent to wait on them.
  const timer = setInterval(() => {
    const found = runtime.found;
    if (session.status === 'closed') return done();
    if (!found || found.missed || confirmed) return;
    if (performance.now() - found.since < FOUND_CONFIRM_MS) return;
    session.setPublic(false);
    found.missed = true;
    publish();
  }, 500);
  const done = () => {
    clearInterval(timer);
    unwatch();
    if (queued?.leave === leave) queued = null;
  };
  const leave = () => {
    done();
    session.close();
    if (runtime.queue === session) runtime.queue = null;
    runtime.found = null;
    publish();
  };
  queued = {
    confirm: () => {
      if (confirmed) return;
      confirmed = true;
      session.setReady(true);
      publish();
    },
    lookAgain: () => {
      confirmed = false;
      runtime.found = null;
      session.setPublic(true);
      publish();
    },
    leave,
  };
  session.onStart = (setup) => {
    // The warm-up is over: this is the match, and from here the session is an ordinary one.
    done();
    runtime.queue = null;
    runtime.found = null;
    runtime.net = session;
    session.onChange = publish;
    beginOnlineMatch(setup, session.team);
  };
}

/** The host saying yes to who walked in. The puck drops once the room sees both ready. */
export function confirmFound() {
  queued?.confirm();
}
/** After a missed game: back on the list, still warming up. */
export function lookAgain() {
  queued?.lookAgain();
}
/** Out of the queue. The warm-up on the ice carries on as a plain game against the AI. */
export function leaveQueue() {
  queued?.leave();
}

/**
 * Somebody is waiting, so walk in: the club we last skated for, ready straight away, and wait for
 * their puck drop. If it does not come — they stepped away from their warm-up, or the room filled
 * before we got there — ask the directory again rather than sit there.
 */
function joinQueue(code: string, mode: QuickMode, directory: DirectorySession) {
  const session = connectToRoom(code);
  runtime.quickJoin = true;
  const since = performance.now();
  let seated = false;
  const unwatch = session.watch(() => {
    if (session.status === 'lobby' && !seated) {
      seated = true;
      // The club we last skated for, unless the host holds it; then the featured one for our
      // side, or the other featured one if that is theirs too.
      const featured = openingMatchup(LEAGUES[0]);
      const held = session.opponent?.club;
      const last = runtime.match.teams[session.team];
      const pick =
        last.key !== held
          ? last
          : featured[session.team].key !== held
            ? featured[session.team]
            : featured[1 - session.team];
      session.setClub(pick.key);
      session.setReady(true);
    }
    publish();
  });
  const timer = setInterval(() => {
    if (runtime.net !== session) return done();
    const waited = performance.now() - since > JOIN_WAIT_MS;
    if (session.status !== 'closed' && !waited) return;
    done();
    disconnect();
    // Somewhere else, then. The screen is still up, so the directory is still on the line.
    if (directory.open) void quickPlay(directory, mode);
  }, 500);
  const done = () => {
    clearInterval(timer);
    unwatch();
  };
  const inner = session.onStart;
  session.onStart = (setup) => {
    done();
    runtime.quickJoin = false;
    inner?.(setup);
  };
}
