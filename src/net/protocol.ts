import type { GameMode, Jersey, Team } from '../game/types';

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
 * keeps its id, so a brief drop (a proxy timing out an idle line, a laptop changing networks)
 * is invisible to the other person; only staying gone this long counts as leaving.
 */
export const RECONNECT_GRACE_MS = 10_000;
/**
 * How often a client says something on the room socket when it has nothing to say. During a
 * match on a direct line the socket would otherwise carry nothing at all, and an idle line is
 * what proxies close.
 */
export const KEEPALIVE_MS = 20_000;

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
}

/** Modes two people can play against each other. Free skate is practice, so it stays local. */
export const ONLINE_MODES: GameMode[] = ['exhibition', 'threeOnThree', 'oneOnOne', 'shootout'];

/** What the host settled on before dropping the puck. Both ends build the same match from it. */
export interface MatchSetup {
  mode: GameMode;
  /** Club keys, by side. */
  clubs: [string, string];
  jerseys: [Jersey, Jersey];
  hostTeam: Team;
}

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
  | { t: 'start'; setup: MatchSetup }
  | { t: 'signal'; data: Signal }
  | { t: 'ping' }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'room'; you: string; players: Player[]; mode: GameMode }
  | { t: 'full' }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'signal'; from: string; data: Signal }
  | { t: 'pong' }
  | { t: 'gone'; id: string };

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
