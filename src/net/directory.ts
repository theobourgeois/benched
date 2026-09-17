import PartySocket from 'partysocket';
import {
  KEEPALIVE_MS,
  roomCode,
  type DirectoryClientMessage,
  type DirectoryServerMessage,
  type OpenRoom,
  type QuickMode,
} from './protocol';

/**
 * The online screen's line to the directory: the live picture of who is looking, who is
 * waiting and how many games are on, and the one question quick play asks — where do I go?
 *
 * Opened while the online screen is up and closed when it is left; the room a person ends up
 * in is a `NetSession`, not this. If the directory cannot be reached the answer is to host a
 * fresh room, so quick play always leads somewhere, if only to a warm-up.
 */

/** How long to wait for the directory's answer before hosting without it. */
const ANSWER_MS = 8_000;

export interface Destination {
  code: string;
  /** Whether we open the room and wait, or walk into somebody else's. */
  host: boolean;
}

export class DirectorySession {
  /** Rooms anyone can walk into, oldest wait first. */
  rooms: OpenRoom[] = [];
  /** People on the online screen right now, including this one. */
  browsing = 0;
  /** Hosts waiting for somebody, listed or handed out in the last few seconds. */
  waiting = 0;
  playing = 0;
  /** Whether the directory has answered at all yet. */
  connected = false;
  onChange: (() => void) | null = null;

  private socket: PartySocket;
  private keepalive: ReturnType<typeof setInterval>;
  private asking: {
    resolve: (to: Destination | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  /** Said before the line opened, to go out the moment it does. */
  private unsent: DirectoryClientMessage[] = [];
  private closed = false;
  /** Whether this line is still up to be asked. */
  get open() {
    return !this.closed;
  }

  constructor(host: string) {
    this.socket = new PartySocket({ host, party: 'directory', room: DIRECTORY_NAME });
    this.socket.addEventListener('message', (event: MessageEvent) => this.receive(event.data));
    this.socket.addEventListener('open', () => {
      const unsent = this.unsent;
      this.unsent = [];
      for (const message of unsent) this.send(message);
    });
    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.changed();
    });
    this.keepalive = setInterval(() => this.send({ t: 'ping' }), KEEPALIVE_MS);
  }

  /**
   * Somewhere to play: an open room for this mode, or a fresh code to host one. With a `code`,
   * that room in particular, which is what picking one off the list asks; if it is no longer
   * open the answer is null and the list will say so.
   */
  quick(mode: QuickMode, code?: string): Promise<Destination | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.asking = this.asking.filter((a) => a.resolve !== resolve);
        // No directory to ask: host somewhere, and whoever finds the code finds you.
        resolve(code ? null : { code: roomCode(), host: true });
      }, ANSWER_MS);
      this.asking.push({ resolve, timer });
      this.send(code ? { t: 'quick', mode, code } : { t: 'quick', mode });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepalive);
    for (const ask of this.asking) {
      clearTimeout(ask.timer);
      ask.resolve(null);
    }
    this.asking = [];
    this.socket.close();
  }

  private receive(data: unknown) {
    if (typeof data !== 'string') return;
    let message: DirectoryServerMessage;
    try {
      message = JSON.parse(data) as DirectoryServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'directory':
        this.rooms = message.rooms;
        this.browsing = message.browsing;
        this.waiting = message.waiting;
        this.playing = message.playing;
        this.connected = true;
        break;
      case 'go':
        this.answer({ code: message.code, host: message.host });
        return;
      case 'gone':
        this.answer(null);
        return;
      case 'pong':
        return;
    }
    this.changed();
  }

  /** Answers come back in the order the questions went out. */
  private answer(to: Destination | null) {
    const ask = this.asking.shift();
    if (!ask) return;
    clearTimeout(ask.timer);
    ask.resolve(to);
  }

  private send(message: DirectoryClientMessage) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
    else if (message.t !== 'ping') this.unsent.push(message);
  }
  private changed() {
    this.onChange?.();
  }
}

/** The directory is one object for everybody; this is its name. */
const DIRECTORY_NAME = 'main';
