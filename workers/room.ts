import {
  Server,
  getServerByName,
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
} from 'partyserver';
import {
  GAME_STYLES,
  IDLE_CLOSE_MS,
  ONLINE_MODES,
  RECONNECT_GRACE_MS,
  RINK_SIZES,
  ROOM_CAPACITY,
  SIGNAL_LIMIT,
  WIRE_INPUT,
  WIRE_SNAPSHOT,
  tagOf,
  type ClientMessage,
  type MatchSetup,
  type Player,
  type RoomListing,
  type ServerMessage,
} from '../src/net/protocol';
import type { GameMode, GameStyle, RinkSize } from '../src/game/types';
import { Directory } from './directory';

/** Deployed as one worker: the rooms, and the directory that lists the public ones. */
export { Directory };

/**
 * A room for two. It holds who is in it, which side they picked and whether they are ready, then
 * gets out of the way: once the puck drops it relays bytes between the two of them and nothing
 * else. It also carries the handshake for a line straight between the two browsers, which,
 * when it opens, takes the play traffic instead. It deliberately does not simulate hockey — a durable object is a poor place to run a
 * hundred and twenty steps a second, and it does not need to, because one of the browsers does.
 *
 * A socket that drops and comes back keeps its id, so a seat is held for a while after its
 * socket closes rather than given up on the spot. The other person is told the seat is empty
 * straight away (their game holds while it is), and only told somebody left once they have
 * stayed gone. Who is in the room is written down as it changes, so the room server restarting
 * under a match (a deploy, the platform moving it) hands everybody the same seats when their
 * sockets come back.
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
  /**
   * The open socket for each seat, kept here rather than asked of the framework: a socket that
   * reconnects reuses its id, and if the old one closes after the new one arrived the
   * framework's own list forgets the new one along with it.
   */
  private sockets = new Map<string, Connection>();
  /** Seats whose socket dropped, waiting to see if it comes back. */
  private dropping = new Map<string, ReturnType<typeof setTimeout>>();
  private setup: MatchSetup | null = null;
  /** What the host has picked to play. */
  private mode: GameMode = ONLINE_MODES[0];
  /**
   * Listed for anyone to walk into. Quick play rooms are; a room made to send a friend the code
   * is not, unless its host says so. The directory hears about it whenever anything changes.
   */
  private isPublic = false;
  /** Whether the directory may still have this room on its list. */
  private listed = false;
  /** When the room last became somewhere anybody could walk into, for the queue's order. */
  private openSince = 0;
  private wasOpen = false;
  /** When each open socket last said anything, so one that has gone quiet can be let go. */
  private heard = new Map<Connection, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private savedAt = 0;

  /**
   * Back from a restart with whatever was written down. Everyone's socket went with the old
   * instance, so every seat starts its grace; the ones whose owners reconnect keep it. A record
   * older than the grace belongs to a room nobody came back to.
   */
  async onStart() {
    const saved = await this.ctx.storage.get<Saved>(SAVED_KEY);
    if (!saved) return;
    if (Date.now() - saved.at > RECONNECT_GRACE_MS) {
      await this.ctx.storage.delete(SAVED_KEY);
      return;
    }
    this.seats = new Map(saved.seats);
    this.setup = saved.setup;
    this.mode = saved.mode;
    this.isPublic = saved.public;
    this.openSince = saved.openSince;
    for (const id of this.seats.keys())
      this.dropping.set(
        id,
        setTimeout(() => this.drop(id), RECONNECT_GRACE_MS),
      );
  }

  onConnect(connection: Connection, _ctx: ConnectionContext) {
    const returning = this.seats.get(connection.id);
    if (!returning && this.seats.size >= ROOM_CAPACITY) {
      this.sendTo(connection, { t: 'full' });
      try {
        connection.close(4001, 'room full');
      } catch {
        // Already gone.
      }
      return;
    }
    const stale = this.sockets.get(connection.id);
    this.sockets.set(connection.id, connection);
    this.heard.set(connection, Date.now());
    this.sweep(true);
    // The same seat on a fresh socket: the old one is done, and its close is ignored below.
    if (stale && stale !== connection) {
      try {
        stale.close(4002, 'replaced');
      } catch {
        // Already gone.
      }
    }
    if (returning) {
      // Back before anyone was told. Same seat, same side, and the same match if one is on.
      this.keep(connection.id);
    } else {
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
    }
    this.save();
    this.announce();
    // Someone coming back to a match already under way still needs to know what it is.
    if (this.setup) this.sendTo(connection, { t: 'start', setup: this.setup });
  }

  onClose(connection: Connection, code: number) {
    this.heard.delete(connection);
    // A socket this seat has already replaced closing late says nothing about the seat.
    if (this.sockets.get(connection.id) !== connection) return this.sweep(this.sockets.size > 0);
    this.sockets.delete(connection.id);
    this.sweep(this.sockets.size > 0);
    if (!this.seats.has(connection.id)) return;
    // A browser closing its tab says so, and is not coming back. Anything else might be.
    if (code === GOING_AWAY) return this.drop(connection.id);
    this.keep(connection.id);
    this.dropping.set(
      connection.id,
      setTimeout(() => this.drop(connection.id), RECONNECT_GRACE_MS),
    );
    // The other person's game holds from now, rather than after the grace, so nothing is
    // played against an empty bench.
    this.announce();
  }

  onError(connection: Connection) {
    // The close that follows does the work; this only makes sure the socket is not counted open.
    try {
      connection.close(1011, 'error');
    } catch {
      // Already gone.
    }
  }

  /** Stop waiting on a seat: its socket came back, or it is being let go for good. */
  private keep(id: string) {
    const pending = this.dropping.get(id);
    if (pending !== undefined) clearTimeout(pending);
    this.dropping.delete(id);
  }

  /**
   * Stayed gone. The seat opens up, and the other person is told. A match cannot go on with one
   * person, so it is called off: both ends go back to the lobby, where whoever is left can wait
   * for them to rejoin with the same code. Only then does the room pick a new host, so the one
   * running the simulation never changes while a match is on.
   */
  private drop(id: string) {
    this.keep(id);
    if (this.sockets.has(id) || !this.seats.delete(id)) return;
    this.setup = null;
    const rest = [...this.seats.values()];
    for (const seat of rest) seat.ready = false;
    if (rest.length && !rest.some((seat) => seat.host)) rest[0].host = true;
    this.save();
    this.broadcastJson({ t: 'gone', id });
    this.announce();
  }

  /**
   * Now and then, while anyone is connected: let go of sockets that have gone quiet (a client
   * pings every few seconds, so one that says nothing for this long is not there, whatever the
   * platform thinks), and refresh the record so a restart knows it is recent.
   */
  private sweep(running: boolean) {
    if (!running) {
      if (this.sweeper !== null) clearInterval(this.sweeper);
      this.sweeper = null;
      return;
    }
    if (this.sweeper !== null) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [socket, at] of this.heard)
        if (now - at > IDLE_CLOSE_MS) {
          try {
            socket.close(4003, 'silent');
          } catch {
            // Already gone.
          }
        }
      if (this.seats.size && now - this.savedAt > RECONNECT_GRACE_MS / 3) this.save();
      // The directory forgets a room that stops repeating itself, restart or not.
      if (this.isPublic) this.report();
    }, SWEEP_MS);
  }

  /** Write down who is here. An empty room leaves nothing behind. */
  private save() {
    this.savedAt = Date.now();
    if (!this.seats.size) {
      void this.ctx.storage.delete(SAVED_KEY);
      return;
    }
    const saved: Saved = {
      at: this.savedAt,
      seats: [...this.seats],
      setup: this.setup,
      mode: this.mode,
      public: this.isPublic,
      openSince: this.openSince,
    };
    void this.ctx.storage.put(SAVED_KEY, saved);
  }

  onMessage(connection: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
    this.heard.set(connection, Date.now());
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
      case 'ping':
        // Nothing to say; the answer keeps the line from looking idle in both directions.
        this.sendTo(connection, { t: 'pong' });
        return;
      case 'signal': {
        // A handshake step for the other person. Opaque here, beyond being a bounded object.
        if (raw.length > SIGNAL_LIMIT || !message.data || typeof message.data !== 'object') return;
        for (const other of this.others(connection.id))
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
      case 'mode':
        if (!seat.host || !ONLINE_MODES.includes(message.mode)) return;
        this.mode = message.mode;
        break;
      case 'club':
        if (typeof message.club !== 'string' || message.club.length > 32) return;
        // Two people cannot skate for the same club; a pick the other person holds is refused.
        for (const [id, other] of this.seats)
          if (id !== connection.id && other.club && other.club === message.club) return;
        seat.club = message.club;
        break;
      case 'ready':
        seat.ready = !!message.ready;
        break;
      case 'public':
        if (!seat.host) return;
        this.isPublic = !!message.public;
        break;
      case 'start': {
        // Only the host drops the puck, and only once everybody is here and ready.
        if (!seat.host || this.seats.size < ROOM_CAPACITY) return;
        if (![...this.seats].every(([id, s]) => s.ready && this.sockets.has(id))) return;
        const setup = cleanSetup(message.setup);
        if (!setup) return;
        this.setup = setup;
        this.save();
        this.broadcastJson({ t: 'start', setup });
        return;
      }
      case 'leave':
        // Said on purpose, so the other person hears it now rather than after the grace.
        this.sockets.delete(connection.id);
        this.drop(connection.id);
        connection.close(1000, 'left');
        return;
    }
    this.save();
    this.announce();
  }

  /** Straight through to the other person in the room. */
  private relay(from: Connection, data: ArrayBuffer) {
    for (const other of this.others(from.id)) {
      try {
        other.send(data);
      } catch {
        // Closing under us; its close event is on the way.
      }
    }
  }
  /** Every open socket but this one's. */
  private *others(id: string) {
    for (const [otherId, socket] of this.sockets) if (otherId !== id) yield socket;
  }
  private players(): Player[] {
    return [...this.seats].map(([id, seat]) => ({ id, ...seat, away: !this.sockets.has(id) }));
  }
  private announce() {
    const players = this.players();
    const playing = this.setup !== null;
    for (const [id, socket] of this.sockets)
      this.sendTo(socket, {
        t: 'room',
        you: id,
        players,
        mode: this.mode,
        playing,
        public: this.isPublic,
      });
    this.report();
  }

  /**
   * Tell the directory what this room is. Said after anything changes and again every sweep; a
   * room that is private and was never listed has nothing to say. Only ever the room's own
   * view, so nothing a browser sent reaches the directory unchecked.
   */
  private report() {
    // A seat whose socket is down is nobody to walk in on: the room is off the list until they
    // are back, however long it holds the seat for them.
    const here = [...this.seats.keys()].every((id) => this.sockets.has(id));
    const listable = this.isPublic && here;
    const open = listable && this.seats.size === 1 && this.setup === null;
    if (open && !this.wasOpen) this.openSince = Date.now();
    this.wasOpen = open;
    if (!listable && !this.listed) return;
    this.listed = listable && this.seats.size > 0;
    const host = [...this.seats.values()].find((seat) => seat.host);
    const listing: RoomListing = {
      code: this.name,
      host: host?.name ?? 'Player 1',
      mode: this.mode,
      public: listable,
      seats: this.seats.size,
      playing: this.setup !== null,
      since: this.openSince,
    };
    void getServerByName(this.env.Directory, DIRECTORY_NAME)
      .then((directory) => directory.report(listing))
      .catch(() => {
        // The directory being unreachable costs a listing, not a game.
      });
  }
  private sendTo(connection: Connection, message: ServerMessage) {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      // A socket closing under us; its close event is on the way.
    }
  }
  private broadcastJson(message: ServerMessage) {
    for (const socket of this.sockets.values()) this.sendTo(socket, message);
  }
}

/** The close code a browser sends when its page is closed or navigated away. */
const GOING_AWAY = 1001;
const SWEEP_MS = 10_000;
const SAVED_KEY = 'room';

/** What survives the room server restarting. */
interface Saved {
  at: number;
  seats: [string, Seat][];
  setup: MatchSetup | null;
  mode: GameMode;
  public: boolean;
  openSince: number;
}
/** The directory is one object for everybody; this is its name. */
const DIRECTORY_NAME = 'main';

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
  const { mode, clubs, jerseys, hostTeam, style, rink } = setup as MatchSetup;
  const jerseyKinds = ['home', 'away'];
  if (!ONLINE_MODES.includes(mode)) return null;
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
  // Both ends index tables with these, so anything unrecognised becomes the default, not a crash.
  return {
    mode,
    clubs: [clubs[0], clubs[1]],
    jerseys: [jerseys[0], jerseys[1]],
    hostTeam,
    style: GAME_STYLES.includes(style as GameStyle) ? style : 'fast',
    rink: RINK_SIZES.includes(rink as RinkSize) ? rink : 'barn',
  };
}

interface Env {
  Room: DurableObjectNamespace<Room>;
  Directory: DurableObjectNamespace<Directory>;
}

export default {
  async fetch(request: Request, env: Env) {
    // A plain answer for anything watching the server come up, before rooms are involved.
    if (new URL(request.url).pathname === '/health') return new Response('ok');
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ??
      new Response('hcky.io room server', { status: 404 })
    );
  },
};
