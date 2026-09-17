import { Server, type Connection, type ConnectionContext } from 'partyserver';
import {
  chooseListing,
  CLAIM_MS,
  IDLE_CLOSE_MS,
  isOpen,
  LISTING_STALE_MS,
  normaliseCode,
  ONLINE_MODES,
  roomCode,
  type DirectoryClientMessage,
  type DirectoryServerMessage,
  type OpenRoom,
  type QuickMode,
  type RoomListing,
} from '../src/net/protocol';

/**
 * The one place that knows which rooms exist. Rooms are keyed by a code and nothing else can
 * list them, so a public room reports itself here whenever anything about it changes, and again
 * every few seconds, and this keeps the picture: who is waiting for somebody, how many games
 * are on, and how many people are on the online screen looking.
 *
 * It makes one decision. Somebody pressing quick play is sent to the open room whose host has
 * waited longest, or handed a fresh code to host one themselves. A room just handed out stays
 * off the list for a few seconds so two people asking at once are not sent to the same seat.
 *
 * Nothing is written down. Rooms repeat themselves, so an instance that restarts has the whole
 * list back within a sweep, and a listing nobody has repeated is dropped.
 */

type Listed = RoomListing & { claimedUntil: number; heard: number };

export class Directory extends Server<Env> {
  static options = { hibernate: false };
  private rooms = new Map<string, Listed>();
  /** When each open socket last said anything, so one that has gone quiet can be let go. */
  private heard = new Map<Connection, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  /** The last picture everybody was sent, so an unchanged one is not sent again. */
  private lastSent = '';

  /** A room saying what it is. Called over RPC by `Room`; nothing here comes from a browser. */
  report(listing: RoomListing) {
    const now = Date.now();
    const known = this.rooms.get(listing.code);
    if (!listing.public || listing.seats === 0) {
      if (known) {
        this.rooms.delete(listing.code);
        this.announce();
      }
      return;
    }
    this.rooms.set(listing.code, {
      ...listing,
      claimedUntil: known?.claimedUntil ?? 0,
      heard: now,
    });
    if (!known || picture(known) !== picture(listing)) this.announce();
  }

  onConnect(connection: Connection, _ctx: ConnectionContext) {
    this.heard.set(connection, Date.now());
    this.sweep(true);
    this.announce(connection);
  }

  onClose(connection: Connection) {
    this.heard.delete(connection);
    this.sweep(this.heard.size > 0);
    this.announce();
  }

  onError(connection: Connection) {
    try {
      connection.close(1011, 'error');
    } catch {
      // Already gone.
    }
  }

  onMessage(connection: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
    this.heard.set(connection, Date.now());
    if (typeof raw !== 'string') return;
    const message = parse(raw);
    if (!message) return;
    switch (message.t) {
      case 'ping':
        this.sendTo(connection, { t: 'pong' });
        return;
      case 'quick': {
        const mode = cleanMode(message.mode);
        if (!mode) return;
        const now = Date.now();
        this.prune(now);
        if (message.code !== undefined) {
          // A room picked off the list. It may have filled since the list was drawn.
          const wanted = this.rooms.get(normaliseCode(String(message.code)));
          if (!wanted || !isOpen(wanted) || wanted.claimedUntil > now) {
            this.sendTo(connection, { t: 'gone' });
            return;
          }
          wanted.claimedUntil = now + CLAIM_MS;
          this.sendTo(connection, { t: 'go', code: wanted.code, host: false });
          this.announce();
          return;
        }
        const found = chooseListing(this.rooms.values(), mode, now);
        if (found) {
          found.claimedUntil = now + CLAIM_MS;
          this.sendTo(connection, { t: 'go', code: found.code, host: false });
          this.announce();
          return;
        }
        // Nobody is waiting, so this person will be. A code no listed room already has.
        let code = roomCode();
        while (this.rooms.has(code)) code = roomCode();
        this.sendTo(connection, { t: 'go', code, host: true });
        return;
      }
    }
  }

  /** Forget rooms that stopped repeating themselves. */
  private prune(now: number) {
    let changed = false;
    for (const [code, room] of this.rooms)
      if (now - room.heard > LISTING_STALE_MS) {
        this.rooms.delete(code);
        changed = true;
      }
    if (changed) this.announce();
  }

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
      this.prune(now);
      // A claim running out puts a room back on the list; nobody says so but the clock.
      this.announce();
    }, SWEEP_MS);
  }

  private snapshot(): DirectoryServerMessage {
    const now = Date.now();
    const rooms: OpenRoom[] = [];
    let waiting = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      if (room.playing) playing++;
      if (!isOpen(room)) continue;
      waiting++;
      if (room.claimedUntil <= now)
        rooms.push({ code: room.code, host: room.host, mode: room.mode, since: room.since });
    }
    rooms.sort((a, b) => a.since - b.since);
    return { t: 'directory', rooms, browsing: this.heard.size, waiting, playing };
  }

  /** The picture, to everyone or to one socket. Only sent when it differs from the last one. */
  private announce(only?: Connection) {
    const message = this.snapshot();
    const text = JSON.stringify(message);
    if (only) {
      this.sendTo(only, message);
      return;
    }
    if (text === this.lastSent) return;
    this.lastSent = text;
    for (const socket of this.heard.keys()) this.sendTo(socket, message);
  }

  private sendTo(connection: Connection, message: DirectoryServerMessage) {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      // A socket closing under us; its close event is on the way.
    }
  }
}

const SWEEP_MS = 5_000;

/** What of a listing changes what anybody sees. */
const picture = (l: RoomListing) =>
  `${l.code}:${l.host}:${l.mode}:${l.public}:${l.seats}:${l.playing}:${l.since}`;

const cleanMode = (value: unknown): QuickMode | null =>
  value === 'any' || ONLINE_MODES.includes(value as never) ? (value as QuickMode) : null;

function parse(raw: string): DirectoryClientMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as DirectoryClientMessage).t !== 'string'
    )
      return null;
    return value as DirectoryClientMessage;
  } catch {
    return null;
  }
}

interface Env {
  Directory: DurableObjectNamespace<Directory>;
}
