import PartySocket from 'partysocket';
import { EMPTY_INPUT } from '../game/config';
import type { GameMode, InputFrame, MatchState, Team } from '../game/types';
import { mergeEdges, noEdges } from '../input/frames';
import { decodeInput, encodeInput } from './input';
import {
  decodeSnapshot,
  encodeSnapshot,
  sinceStamp,
  snapshotEcho,
  snapshotStamp,
  STAMP_WRAP,
  stampNow,
} from './snapshot';
import { SnapshotView, SNAPSHOT_HZ } from './view';
import { DirectLink } from './peer';
import {
  bodyOf,
  KEEPALIVE_MS,
  ONLINE_MODES,
  RECONNECT_GRACE_MS,
  SILENCE_MS,
  tagOf,
  tagged,
  WIRE_INPUT,
  WIRE_SNAPSHOT,
  type ClientMessage,
  type MatchSetup,
  type Player,
  type ServerMessage,
} from './protocol';

/**
 * One side of an online match.
 *
 * The host runs the simulation and says what happened; the guest sends what it is trying to do
 * and draws what it is told. That asymmetry is the whole design: there is no second simulation to
 * disagree with the first, so there is nothing to reconcile and nothing to desync.
 *
 * The guest draws a little behind what it has heard, blending between snapshots, so the match
 * moves every frame rather than every packet. That is `SnapshotView`. Play traffic goes straight
 * between the two browsers when a line can be opened, and through the room when it cannot; that
 * is `DirectLink`. This is the room, and the choice between the two.
 */

/**
 * `connecting` covers the first connection and any reconnection after it: the socket
 * reconnects on its own and keeps its id, so the room hands the same seat back. `closed` is
 * final: we hung up, or the room turned us away. A match that was called off (the other person
 * stayed gone) puts the session back in `lobby` while the match is still on screen; the overlay
 * says so and offers the way back.
 */
export type NetStatus = 'connecting' | 'lobby' | 'playing' | 'closed';

/**
 * Frames the host lets build up before catching up. The simulation steps faster than anyone
 * sends, so the queue is usually empty and the last frame stands in; this only covers a burst
 * arriving after a stall.
 */
const JITTER_TARGET = 2;
/**
 * Play heard from the other browser within this long counts as a live line, whatever the room
 * says about their socket: the direct link can carry a match through the room's socket dropping.
 */
const HEARD_MS = 1000;
/** Host: the first wait before offering a fresh direct line, and the longest it backs off to. */
const LINK_RETRY_MS = 8_000;
const LINK_RETRY_MAX_MS = 60_000;
/** A handshake or a stalled line gets this long to settle before it is replaced. */
const LINK_SETTLE_MS = 12_000;
/** Input frames a second from the guest. The host steps at 120 and holds the last one between. */
export const INPUT_HZ = 60;
export { SNAPSHOT_HZ };

/** What the corner of the screen can say about the connection. */
export interface NetStats {
  /** Round trip to the other browser and back, smoothed, in milliseconds. Zero until measured. */
  rtt: number;
  /** Snapshots that landed in the last second. Host: input frames that did. */
  rate: number;
  /** Guest: how far behind the newest snapshot it is drawing, in milliseconds. */
  delay: number;
  /** Guest: times it caught up with the newest snapshot and had to wait, since the puck dropped. */
  starved: number;
  /** Whether play traffic is going straight to the other browser rather than through the room. */
  direct: boolean;
}

export class NetSession {
  status: NetStatus = 'connecting';
  you = '';
  players: Player[] = [];
  /** What the host has picked to play. */
  mode: GameMode = ONLINE_MODES[0];
  setup: MatchSetup | null = null;
  /** Whether the room is listed for anyone to walk into. What the room says, not what we asked. */
  isPublic = false;
  /** Something the player needs to be told: the room was full, or the other person left. */
  notice: string | null = null;
  /** Called whenever anything a screen draws has changed. */
  onChange: (() => void) | null = null;
  /** The same, for code that is not a screen and must not be displaced by one. */
  private watchers = new Set<() => void>();
  /** Called when the host drops the puck, on both ends. */
  onStart: ((setup: MatchSetup) => void) | null = null;
  readonly stats: NetStats = { rtt: 0, rate: 0, delay: 0, starved: 0, direct: false };

  private socket: PartySocket;
  /** Pings the room, checks the answers came back, and looks after the direct line. */
  private watchdog: ReturnType<typeof setInterval>;
  /** When the last ping went out, and when the room last said anything at all. */
  private pingSent = 0;
  private heardAt = 0;
  /** When play last arrived from the other browser, by either road. */
  private peerAt = 0;
  /** When the other person's seat went empty, for the countdown. Zero while they are here. */
  private awaySince = 0;
  private lastOffer = 0;
  private offerDelay = LINK_RETRY_MS;
  private readonly online = () => {
    // The network is back; do not wait out the reconnect backoff.
    if (this.status !== 'closed' && this.socket.readyState !== 1) this.socket.reconnect();
  };
  private readonly visible = () => {
    // A hidden tab's timers were throttled, so check the line now rather than a minute from now.
    if (!document.hidden) this.tick();
  };
  /** The line straight to the other browser, when there is one. */
  private readonly link = new DirectLink((data) => this.send({ t: 'signal', data }));
  /** Host: who the line was last offered to, so a returning guest is offered a new one. */
  private offeredTo = '';
  /** What we asked the room to be. Said again on every fresh socket, so a restart keeps it. */
  private wantPublic: boolean | null = null;
  /** Host: the guest's frames, waiting to be taken one per simulation step. */
  private queue: InputFrame[] = [];
  /** Host: the last frame the guest sent, held while nothing new arrives. */
  private held: InputFrame = EMPTY_INPUT;
  /** Host: the guest's newest clock reading, sent back so it can time the round trip. */
  private guestStamp = 0;
  /** Host: the newest input heard, so one that took the slow road after a faster one is dropped. */
  private newestInput = -1;
  private sinceSnapshot = 0;
  /** Host: the last call the guest has been told about, so each one crosses exactly once. */
  private sentEvent = -1;

  /** Guest: presses since the last frame went out, so none is lost between sends. */
  private outbound: InputFrame | null = null;
  private lastSend = 0;
  /** Guest: the host's newest clock reading, sent back so it can time the round trip. */
  private hostStamp = 0;
  /** Guest: what the host has said, and the moment of it being drawn. */
  private readonly snapshots = new SnapshotView();
  /** Arrivals in the last second, for the readout. */
  private arrivals = 0;
  private rateSince = 0;

  constructor(
    readonly room: string,
    host: string,
    name: string,
  ) {
    // Back quickly after a drop: the room only holds a seat for so long.
    this.socket = new PartySocket({
      host,
      party: 'room',
      room,
      minReconnectionDelay: 500,
      maxReconnectionDelay: 3000,
    });
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('open', () => {
      if (this.status === 'closed') return;
      // Stays `connecting` until the room says who is here, so a match it called off while we
      // were gone is never shown as still on.
      this.pingSent = 0;
      this.heardAt = performance.now();
      this.send({ t: 'hello', name });
      if (this.wantPublic !== null) this.send({ t: 'public', public: this.wantPublic });
      this.changed();
    });
    // The socket reconnects by itself, and the room keeps the seat for a while, so a drop is a
    // wait rather than the end: nothing here is forgotten, and a direct line stays up through it.
    this.socket.addEventListener('close', () => {
      if (this.status !== 'closed') this.status = 'connecting';
      this.changed();
    });
    this.watchdog = setInterval(() => this.tick(), KEEPALIVE_MS);
    this.socket.addEventListener('message', (event: MessageEvent) => {
      this.heardAt = performance.now();
      this.receive(event.data);
    });
    this.link.onMessage = (data) => this.receive(data);
    this.link.onChange = () => {
      this.stats.direct = this.link.open;
      this.tendLink(performance.now());
      this.changed();
    };
    window.addEventListener('online', this.online);
    document.addEventListener('visibilitychange', this.visible);
  }

  /**
   * Every few seconds: ping the room, and if the last ping went unanswered, the socket is dead
   * however open it looks, so drop it and dial again. Judged against the ping rather than the
   * clock, so a hidden tab whose timers were held back is not mistaken for a dead line.
   */
  private tick() {
    if (this.status === 'closed') return;
    const now = performance.now();
    if (this.socket.readyState === 1) {
      const unanswered = this.pingSent > 0 && this.heardAt < this.pingSent;
      if (unanswered && now - this.pingSent > SILENCE_MS) {
        this.pingSent = 0;
        this.socket.reconnect();
      } else if (!unanswered) {
        this.pingSent = now;
        this.send({ t: 'ping' });
      }
    }
    this.tendLink(now);
  }

  /**
   * Host: keep a direct line to the other person. Offered as soon as they are in, and again
   * whenever it is down and not about to come back, backing off while offers go unanswered.
   */
  private tendLink(now: number) {
    if (!this.isHost || !this.link.supported || this.status === 'closed') return;
    const other = this.opponent;
    if (!other || other.away || this.socket.readyState !== 1) return;
    if (other.id !== this.offeredTo) {
      this.offeredTo = other.id;
      // A new person has a new clock; nothing they send is stale against the old one's.
      this.newestInput = -1;
      this.lastOffer = 0;
      this.offerDelay = LINK_RETRY_MS;
    }
    if (this.link.open) {
      this.offerDelay = LINK_RETRY_MS;
      return;
    }
    if (this.link.settling && now - this.link.changedAt < LINK_SETTLE_MS) return;
    if (this.lastOffer && now - this.lastOffer < this.offerDelay) return;
    if (this.lastOffer) this.offerDelay = Math.min(this.offerDelay * 2, LINK_RETRY_MAX_MS);
    this.lastOffer = now;
    void this.link.offer();
  }

  /** Everyone in the room, and which of them is us. */
  get me() {
    return this.players.find((p) => p.id === this.you);
  }
  get opponent() {
    return this.players.find((p) => p.id !== this.you);
  }
  get isHost() {
    return this.me?.host ?? false;
  }
  /** The side this client plays. Until the room answers, assume the near bench. */
  get team(): Team {
    return this.me?.team ?? 0;
  }
  get everyoneReady() {
    return this.players.length === 2 && this.players.every((p) => p.ready && !p.away);
  }
  /** Whether the room socket is up. Play may still be getting through without it. */
  get connected() {
    return this.status !== 'connecting' && this.status !== 'closed';
  }
  /**
   * A match is on screen but somebody's line is down and nothing is getting through another way:
   * our socket is reconnecting, or the room says theirs is. The host holds the simulation while
   * this is true, so nobody plays against an empty bench.
   */
  get interrupted() {
    if (!this.setup || this.status === 'closed') return false;
    const cut = this.status === 'connecting' || !!this.opponent?.away;
    return cut && !(this.link.open && performance.now() - this.peerAt < HEARD_MS);
  }
  /** Milliseconds left before the room gives up on the other person's seat, or null. */
  get awayRemaining() {
    if (!this.awaySince) return null;
    return Math.max(0, RECONNECT_GRACE_MS - (performance.now() - this.awaySince));
  }

  private receive(data: string | ArrayBuffer) {
    if (typeof data !== 'string') {
      if (data.byteLength < 2) return;
      this.peerAt = performance.now();
      const tag = tagOf(data);
      // The host is told what the other person is doing; the guest is told what happened.
      if (tag === WIRE_INPUT && this.isHost) this.queueInput(bodyOf(data));
      else if (tag === WIRE_SNAPSHOT && !this.isHost) this.queueSnapshot(bodyOf(data));
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'room': {
        this.you = message.you;
        this.players = message.players;
        this.mode = message.mode;
        this.isPublic = message.public;
        const other = this.opponent;
        this.awaySince = other?.away ? this.awaySince || performance.now() : 0;
        if (this.setup && !message.playing) {
          // The room called the match off while we were away from it.
          if (this.status !== 'lobby')
            this.endMatch('The game was called off while you were away.');
        } else if (this.status === 'connecting') this.status = this.setup ? 'playing' : 'lobby';
        // Somebody new across the table means the last one's leaving is old news.
        if (this.status === 'lobby' && other && !this.setup) this.notice = null;
        this.tendLink(performance.now());
        break;
      }
      case 'signal':
        void this.link.handle(message.data);
        return;
      case 'pong':
        return;
      case 'full':
        this.notice = 'That game is already full.';
        // Final. Left to itself the socket would keep knocking every few seconds.
        this.close();
        break;
      case 'start':
        // The room says it again to a socket that reconnected mid-match. That match is the one
        // already on the ice; building it again would put the score back to nothing.
        if (this.setup && this.status === 'playing') return;
        this.setup = message.setup;
        this.status = 'playing';
        this.notice = null;
        this.resetView();
        this.onStart?.(message.setup);
        break;
      case 'gone':
        this.awaySince = 0;
        if (this.setup) this.endMatch('Your opponent left the game.');
        else this.notice = 'Your opponent left.';
        break;
    }
    this.changed();
  }

  /**
   * The room called the match off. The match stays on screen under an overlay until the player
   * picks where to go, but nothing more is played or drawn of it, and the room is a lobby again.
   */
  private endMatch(notice: string) {
    this.setup = null;
    this.status = 'lobby';
    this.notice = notice;
    this.awaySince = 0;
    this.link.close();
    this.offeredTo = '';
    this.stats.direct = false;
    this.resetView();
  }

  /** A new match is a new timeline: nothing heard about the old one applies to it. */
  private resetView() {
    this.snapshots.reset();
    this.queue = [];
    this.held = EMPTY_INPUT;
    this.newestInput = -1;
    this.sentEvent = -1;
  }

  /** Play traffic takes the line when there is one, and the room when there is not. */
  private transmit(data: ArrayBuffer) {
    if (this.link.send(data)) return;
    if (this.socket.readyState === 1) this.socket.send(data);
  }

  private countArrival(now: number) {
    this.arrivals++;
    if (now - this.rateSince >= 1000) {
      this.stats.rate = this.arrivals;
      this.arrivals = 0;
      this.rateSince = now;
    }
  }
  private timeRoundTrip(echo: number, now: number) {
    if (!echo) return;
    const rtt = sinceStamp(echo, now);
    // A stamp older than the wrap is nonsense; so is one from before the last resync.
    if (rtt > 10_000) return;
    this.stats.rtt = this.stats.rtt ? this.stats.rtt * 0.8 + rtt * 0.2 : rtt;
  }

  private queueInput(body: ArrayBuffer) {
    const now = performance.now();
    const { frame, stamp, echo } = decodeInput(body);
    // Frames can overtake each other between the two roads. An older one is not worth a step.
    if (
      this.newestInput >= 0 &&
      (stamp - this.newestInput + STAMP_WRAP) % STAMP_WRAP > STAMP_WRAP / 2
    )
      return;
    this.newestInput = stamp;
    this.queue.push(frame);
    this.guestStamp = stamp;
    this.timeRoundTrip(echo, now);
    this.countArrival(now);
  }

  private queueSnapshot(body: ArrayBuffer) {
    const now = performance.now();
    const snap = decodeSnapshot(body);
    this.hostStamp = snapshotStamp(snap);
    this.timeRoundTrip(snapshotEcho(snap), now);
    this.countArrival(now);
    this.snapshots.push(snap);
  }

  /**
   * Host: the guest's intent for one step. A missing frame repeats the last one rather than
   * falling back to the AI, because a dropped packet is not the player letting go of the stick.
   */
  takeGuestInput(): InputFrame {
    let taken = this.queue.shift();
    // Frames that piled up are folded together rather than thrown away, so a burst after a
    // stall still delivers the shot somebody took during it.
    while (this.queue.length > JITTER_TARGET) {
      const next = this.queue.shift()!;
      taken = taken ? mergeEdges(taken, next) : next;
    }
    if (taken) this.held = taken;
    const frame = this.held;
    // The step that sees a press consumes it. Without this the held frame would fire the same
    // shot on every step until the next packet landed.
    this.held = noEdges(this.held);
    return frame;
  }

  /**
   * Host: forget what the guest was doing before the game held. Their stick from before the drop
   * is not what they are doing now, and a queue of it would be played out in a rush on resume.
   */
  clearGuestInput() {
    this.queue = [];
    this.held = EMPTY_INPUT;
  }

  /**
   * Guest: what we are trying to do. Called every frame drawn; goes out at a steady rate, with
   * every press made in between folded into the next frame sent. True when one went out, which
   * is the caller's cue that those presses have been delivered.
   */
  sendInput(frame: InputFrame, now = performance.now()): boolean {
    this.outbound = mergeEdges(this.outbound, frame);
    const interval = 1000 / INPUT_HZ;
    if (now - this.lastSend < interval) return false;
    if (this.socket.readyState !== 1 && !this.link.open) return false;
    // Carry the remainder so a display near the send rate does not halve it, never owing more
    // than one.
    this.lastSend = Math.max(this.lastSend + interval, now - interval);
    this.transmit(tagged(WIRE_INPUT, encodeInput(this.outbound, stampNow(now), this.hostStamp)));
    this.outbound = null;
    return true;
  }

  /** Host: say what happened, at a steady rate rather than every simulation step. */
  publish(s: MatchState, dt: number) {
    if (!this.isHost || (this.socket.readyState !== 1 && !this.link.open)) return;
    this.sinceSnapshot += dt;
    const interval = 1 / SNAPSHOT_HZ;
    if (this.sinceSnapshot < interval) return;
    // Carry the remainder so a display near the snapshot rate does not halve it, but never
    // owe more than one, or a stall would be followed by a burst.
    this.sinceSnapshot = Math.min(this.sinceSnapshot - interval, interval);
    this.transmit(
      tagged(
        WIRE_SNAPSHOT,
        encodeSnapshot(s, this.sentEvent, stampNow(performance.now()), this.guestStamp),
      ),
    );
    this.sentEvent = s.events.at(-1)?.id ?? this.sentEvent;
  }

  /**
   * Guest: pose the match on the moment being drawn, `delta` seconds after the last one. True
   * when the moment passed a snapshot, which is when its calls land in the match.
   */
  view(s: MatchState, delta: number): boolean {
    const fresh = this.snapshots.pose(s, delta);
    this.stats.delay = this.snapshots.delayMs;
    this.stats.starved = this.snapshots.starved;
    return fresh;
  }

  setName(name: string) {
    this.send({ t: 'name', name });
  }
  pickTeam(team: Team) {
    this.send({ t: 'team', team });
  }
  setClub(club: string) {
    this.send({ t: 'club', club });
  }
  setMode(mode: GameMode) {
    this.send({ t: 'mode', mode });
  }
  setReady(ready: boolean) {
    this.send({ t: 'ready', ready });
  }
  /** Host only: list the room for anyone to walk into, or take it off the list. */
  setPublic(on: boolean) {
    this.wantPublic = on;
    this.send({ t: 'public', public: on });
  }
  start(setup: MatchSetup) {
    this.send({ t: 'start', setup });
  }
  close() {
    if (this.status === 'closed') return;
    this.status = 'closed';
    clearInterval(this.watchdog);
    window.removeEventListener('online', this.online);
    document.removeEventListener('visibilitychange', this.visible);
    // Said out loud, so the room lets the seat go now rather than waiting to see if we return.
    this.send({ t: 'leave' });
    this.link.close();
    this.socket.close();
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  /** Hear about every change for as long as the returned function has not been called. */
  watch(fn: () => void) {
    this.watchers.add(fn);
    return () => {
      this.watchers.delete(fn);
    };
  }
  private changed() {
    this.onChange?.();
    for (const fn of this.watchers) fn();
  }
}

/**
 * Where the rooms live. Set by `.env.development` and `.env.production`; falling back to this
 * page's own origin covers a build that serves the game from the room worker itself.
 */
export const ROOM_HOST = (import.meta.env.VITE_ROOM_HOST as string) || location.host;
