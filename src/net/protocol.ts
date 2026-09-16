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

/** What the host settled on before dropping the puck. Both ends build the same match from it. */
export interface MatchSetup {
  mode: GameMode;
  /** Club keys, by side. */
  clubs: [string, string];
  jerseys: [Jersey, Jersey];
  hostTeam: Team;
}

export type ClientMessage =
  | { t: 'hello'; name: string }
  | { t: 'name'; name: string }
  | { t: 'team'; team: Team }
  | { t: 'club'; club: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'room'; you: string; players: Player[] }
  | { t: 'full' }
  | { t: 'start'; setup: MatchSetup }
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
