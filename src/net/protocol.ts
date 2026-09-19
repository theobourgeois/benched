import type { GameMode, GameStyle, Jersey, RinkSize, Team } from '../game/types';

/**
 * What the two browsers say to each other. The room is a relay: it keeps track of who is in it
 * and passes messages along. It never simulates hockey, and it never decides anything about a
 * match beyond who is allowed to start one.
 *
 * Lobby talk is JSON, because it is rare and worth reading in a network tab. Play is binary,
 * because it is sixty frames a second.
 */

/** Room codes people read out loud, so no characters that look like each other. */
export const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';
export const CODE_LENGTH = 4;
export const roomCode = (random = Math.random) =>
  Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)],
  ).join('');
/** Codes are spoken, so they are matched loosely and stored upper case. */
export const normaliseCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);

/** Two people to a room. A third connection is turned away rather than silently watching. */
export const ROOM_CAPACITY = 2;

/**
 * How long the room keeps somebody's seat after their socket drops. A socket that reconnects
 * keeps its id, so a drop (a proxy timing out a line, a laptop changing networks, the room
 * server restarting) is a wait rather than the end. Mid-match the game holds while the seat is
 * empty, so this is also how long the other person can be left waiting before the match is
 * called off. Long enough for a router to come back; short enough that nobody sits there.
 */
export const RECONNECT_GRACE_MS = 60_000;
/**
 * How often a client pings the room. The answer is how it knows the line is alive: a socket can
 * look open to the browser long after the network under it has gone (a Wi-Fi roam, a sleeping
 * laptop), and nothing but silence ever says so. The traffic also keeps proxies from closing
 * an idle line during a match on a direct link.
 */
export const KEEPALIVE_MS = 5_000;
/** A ping left unanswered this long means the socket is dead whatever the browser thinks. */
export const SILENCE_MS = 10_000;
/**
 * The room closes a socket it has heard nothing on for this long. A browser throttles a hidden
 * tab's timers to once a minute, so it has to be well past that or a player who switched
 * windows would be thrown off.
 */
export const IDLE_CLOSE_MS = 90_000;

export interface Player {
  id: string;
  name: string;
  /** The side they will skate. The host takes what is left when the guest picks. */
  team: Team;
  /** The club key they picked for their own side. */
  club: string;
  ready: boolean;
  /** The host runs the simulation; the room names the first person in as host. */
  host: boolean;
  /** Their socket dropped and the room is holding the seat to see if they come back. */
  away: boolean;
}

/**
 * What a room tells the directory about itself, whenever any of it changes and again every sweep
 * so a directory that restarted hears about it within seconds. Only public rooms are listed; a
 * room that goes private, or empties, reports once more so it is taken down.
 */
export interface RoomListing {
  code: string;
  /** The host's name, which is what the browse list shows. */
  host: string;
  mode: GameMode;
  public: boolean;
  seats: number;
  playing: boolean;
  /** When the room went public, so the oldest waiting host is served first. */
  since: number;
}
/** A listing that anyone can walk into: public, one seat taken, no match on. */
export interface OpenRoom {
  code: string;
  host: string;
  mode: GameMode;
  since: number;
}
/** What quick play asks for. `any` takes the oldest open room whatever it is playing. */
export type QuickMode = GameMode | 'any';
/**
 * How long a room handed to one person stays off the list. Two people asking at once must not
 * both be sent to the same seat; if the one it went to never shows up the room comes back.
 */
export const CLAIM_MS = 15_000;
/** A listing the directory has not heard about for this long belongs to a room that is gone. */
export const LISTING_STALE_MS = 30_000;
/** How long a host in a warm-up has to say yes to somebody who arrived. */
export const FOUND_CONFIRM_MS = 30_000;
/** How long a quick-play joiner waits for the host's puck drop before looking elsewhere. */
export const JOIN_WAIT_MS = 45_000;

/**
 * The room quick play sends somebody to: the one whose host has waited longest, among those
 * that are open, playing what was asked for, and not handed to somebody else in the last few
 * seconds. Pure, so the directory's one decision can be tested without a worker.
 */
export function chooseListing(
  listings: Iterable<RoomListing & { claimedUntil: number }>,
  mode: QuickMode,
  now: number,
): (RoomListing & { claimedUntil: number }) | null {
  let best: (RoomListing & { claimedUntil: number }) | null = null;
  for (const l of listings) {
    if (!isOpen(l) || l.claimedUntil > now) continue;
    if (mode !== 'any' && l.mode !== mode) continue;
    if (!best || l.since < best.since) best = l;
  }
  return best;
}
export const isOpen = (l: RoomListing) => l.public && l.seats === 1 && !l.playing;

/** Modes two people can play against each other. Free skate is practice, so it stays local. */
export const ONLINE_MODES: GameMode[] = ['exhibition', 'threeOnThree', 'oneOnOne', 'shootout'];

/** What the host settled on before dropping the puck. Both ends build the same match from it. */
export interface MatchSetup {
  mode: GameMode;
  /** Club keys, by side. */
  clubs: [string, string];
  jerseys: [Jersey, Jersey];
  hostTeam: Team;
  /** The host's game style and rink. A room from before these existed plays fast on the barn. */
  style?: GameStyle;
  rink?: RinkSize;
}
/** Enumerated here as well as in `game/config`, because the room checks them and cannot see that. */
export const GAME_STYLES: readonly GameStyle[] = ['fast', 'classic'];
export const RINK_SIZES: readonly RinkSize[] = ['barn', 'pro', 'olympic', 'bandy'];

/**
 * One step of the handshake for a line straight between the two browsers, carried through the
 * room. Shaped like what the browser hands over, without depending on its types, because the
 * room is not a browser.
 */
export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp?: string;
}
export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
export type Signal = { sdp: SessionDescription } | { candidate: IceCandidate | null };
/** Longer than any handshake step has reason to be. */
export const SIGNAL_LIMIT = 16 * 1024;

export type ClientMessage =
  | { t: 'hello'; name: string }
  | { t: 'name'; name: string }
  | { t: 'team'; team: Team }
  | { t: 'club'; club: string }
  /** Host only: what will be played, so the other person's lobby says the same thing. */
  | { t: 'mode'; mode: GameMode }
  | { t: 'ready'; ready: boolean }
  /** Host only: whether the room is listed for anyone to walk into. */
  | { t: 'public'; public: boolean }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'signal'; data: Signal }
  | { t: 'ping' }
  | { t: 'leave' };

export type ServerMessage =
  /**
   * Who is here. `playing` says whether the room still has a match on, so a client that was away
   * can tell whether the one on its screen was called off while it was gone.
   */
  | {
      t: 'room';
      you: string;
      players: Player[];
      mode: GameMode;
      playing: boolean;
      public: boolean;
    }
  | { t: 'full' }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'signal'; from: string; data: Signal }
  | { t: 'pong' }
  | { t: 'gone'; id: string };

/**
 * What a browser on the online screen says to the directory. `quick` asks for somewhere to
 * play: an open room, or a fresh code to host one in; with a `code` it asks for that room in
 * particular, which is what picking one off the list does.
 */
export type DirectoryClientMessage = { t: 'quick'; mode: QuickMode; code?: string } | { t: 'ping' };
/**
 * `directory` is the live picture: who is looking, who is waiting and how many games are on.
 * `go` answers a `quick`; `gone` says the room asked for is no longer open.
 */
export type DirectoryServerMessage =
  | { t: 'directory'; rooms: OpenRoom[]; browsing: number; waiting: number; playing: number }
  | { t: 'go'; code: string; host: boolean }
  | { t: 'gone' }
  | { t: 'pong' };

/** The first byte of every binary message says what the rest of it is. */
export const WIRE_INPUT = 1;
export const WIRE_SNAPSHOT = 2;

export function tagged(kind: number, body: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = kind;
  out.set(new Uint8Array(body), 1);
  return out.buffer;
}
export const tagOf = (data: ArrayBuffer) => new Uint8Array(data, 0, 1)[0];
export const bodyOf = (data: ArrayBuffer) => data.slice(1);
