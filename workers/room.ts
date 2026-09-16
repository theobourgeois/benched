import { Server, routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';
import {
  ROOM_CAPACITY,
  SIGNAL_LIMIT,
  WIRE_INPUT,
  WIRE_SNAPSHOT,
  tagOf,
  type ClientMessage,
  type MatchSetup,
  type Player,
  type ServerMessage,
} from '../src/net/protocol';

/**
 * A room for two. It holds who is in it, which side they picked and whether they are ready, then
 * gets out of the way: once the puck drops it relays bytes between the two of them and nothing
 * else. It also carries the handshake for a line straight between the two browsers, which,
 * when it opens, takes the play traffic instead. It deliberately does not simulate hockey — a durable object is a poor place to run a
 * hundred and twenty steps a second, and it does not need to, because one of the browsers does.
 *
 * Everything here is untrusted input from a browser. Nothing is read without a shape check.
 */

interface Seat {
  name: string;
  team: 0 | 1;
  club: string;
  ready: boolean;
  host: boolean;
}

export class Room extends Server<Env> {
  /** Hibernation would drop this, and a room outliving its players is not worth keeping warm. */
  static options = { hibernate: false };
  private seats = new Map<string, Seat>();
  private setup: MatchSetup | null = null;

  onConnect(connection: Connection, _ctx: ConnectionContext) {
    if (this.seats.size >= ROOM_CAPACITY) {
      this.sendTo(connection, { t: 'full' });
      connection.close(4001, 'room full');
      return;
    }
    // First one in runs the match; the other takes the side they did not.
    const host = this.seats.size === 0;
    const taken = [...this.seats.values()].map((seat) => seat.team);
    this.seats.set(connection.id, {
      name: host ? 'Player 1' : 'Player 2',
      team: taken.includes(0) ? 1 : 0,
      club: '',
      ready: false,
      host,
    });
    this.sendTo(connection, { t: 'room', you: connection.id, players: this.players() });
    this.announce();
    // Someone joining a match already under way still needs to know what it is.
    if (this.setup) this.sendTo(connection, { t: 'start', setup: this.setup });
  }

  onClose(connection: Connection) {
    if (!this.seats.delete(connection.id)) return;
    this.setup = null;
    // The room needs a host. If the one who left was it, promote whoever is still here.
    const rest = [...this.seats.values()];
    if (rest.length && !rest.some((seat) => seat.host)) rest[0].host = true;
    this.broadcastJson({ t: 'gone', id: connection.id });
    this.announce();
  }

  onMessage(connection: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
    // Play traffic is bytes, and the room is only a pipe for it: straight to the other person.
    if (typeof raw !== 'string') {
      const data = raw instanceof ArrayBuffer ? raw : toBuffer(raw);
      if (data.byteLength < 2) return;
      const tag = tagOf(data);
      if (tag !== WIRE_INPUT && tag !== WIRE_SNAPSHOT) return;
      this.relay(connection, data);
      return;
    }
    const message = parse(raw);
    const seat = this.seats.get(connection.id);
    if (!message || !seat) return;
    switch (message.t) {
      case 'signal': {
        // A handshake step for the other person. Opaque here, beyond being a bounded object.
        if (raw.length > SIGNAL_LIMIT || !message.data || typeof message.data !== 'object') return;
        for (const other of this.getConnections())
          if (other.id !== connection.id)
            this.sendTo(other, { t: 'signal', from: connection.id, data: message.data });
        return;
      }
      case 'hello':
      case 'name':
        seat.name = clean(message.name) || seat.name;
        break;
      case 'team': {
        if (message.team !== 0 && message.team !== 1) return;
        seat.team = message.team;
        // Two people cannot skate for the same club, so the other one moves over.
        for (const [id, other] of this.seats)
          if (id !== connection.id && other.team === seat.team)
            other.team = (1 - seat.team) as 0 | 1;
        break;
      }
      case 'club':
        if (typeof message.club !== 'string' || message.club.length > 32) return;
        seat.club = message.club;
        break;
      case 'ready':
        seat.ready = !!message.ready;
        break;
      case 'start': {
        // Only the host drops the puck, and only once everybody is ready.
        if (!seat.host || this.seats.size < ROOM_CAPACITY) return;
        if (![...this.seats.values()].every((s) => s.ready)) return;
        const setup = cleanSetup(message.setup);
        if (!setup) return;
        this.setup = setup;
        this.broadcastJson({ t: 'start', setup });
        return;
      }
      case 'leave':
        connection.close(1000, 'left');
        return;
    }
    this.announce();
  }

  /** Straight through to the other person in the room. */
  private relay(from: Connection, data: ArrayBuffer) {
    for (const other of this.getConnections()) if (other.id !== from.id) other.send(data);
  }
  private players(): Player[] {
    return [...this.seats].map(([id, seat]) => ({ id, ...seat }));
  }
  private announce() {
    const players = this.players();
    for (const connection of this.getConnections())
      this.sendTo(connection, { t: 'room', you: connection.id, players });
  }
  private sendTo(connection: Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }
  private broadcastJson(message: ServerMessage) {
    this.broadcast(JSON.stringify(message));
  }
}

const toBuffer = (view: ArrayBufferView) =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;

/** Names are shown to the other player, so they are trimmed and kept short. */
const clean = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 16) : '';

function parse(raw: string): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof (value as ClientMessage).t !== 'string')
      return null;
    return value as ClientMessage;
  } catch {
    return null;
  }
}

/** The setup reaches the other browser and builds a match there, so it is checked field by field. */
function cleanSetup(setup: unknown): MatchSetup | null {
  if (!setup || typeof setup !== 'object') return null;
  const { mode, clubs, jerseys, hostTeam } = setup as MatchSetup;
  const modes = ['exhibition', 'threeOnThree', 'oneOnOne', 'shootout'];
  const jerseyKinds = ['home', 'away'];
  if (!modes.includes(mode)) return null;
  if (
    !Array.isArray(clubs) ||
    clubs.length !== 2 ||
    !clubs.every((c) => typeof c === 'string' && c.length <= 32)
  )
    return null;
  if (
    !Array.isArray(jerseys) ||
    jerseys.length !== 2 ||
    !jerseys.every((j) => jerseyKinds.includes(j))
  )
    return null;
  if (hostTeam !== 0 && hostTeam !== 1) return null;
  return { mode, clubs: [clubs[0], clubs[1]], jerseys: [jerseys[0], jerseys[1]], hostTeam };
}

interface Env {
  Room: DurableObjectNamespace<Room>;
}

export default {
  async fetch(request: Request, env: Env) {
    // A plain answer for anything watching the server come up, before rooms are involved.
    if (new URL(request.url).pathname === '/health') return new Response('ok');
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ??
      new Response('benched room server', { status: 404 })
    );
  },
};
