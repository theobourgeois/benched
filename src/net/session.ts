import PartySocket from 'partysocket';
import { EMPTY_INPUT } from '../game/config';
import type { InputFrame, MatchState, Team } from '../game/types';
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

export type NetStatus = 'connecting' | 'lobby' | 'playing' | 'closed';

/**
 * Frames the host lets build up before catching up. The simulation steps faster than anyone
 * sends, so the queue is usually empty and the last frame stands in; this only covers a burst
 * arriving after a stall.
 */
const JITTER_TARGET = 2;
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
  setup: MatchSetup | null = null;
  /** Something the player needs to be told: the room was full, or the other person left. */
  notice: string | null = null;
  /** Called whenever anything a screen draws has changed. */
  onChange: (() => void) | null = null;
  /** Called when the host drops the puck, on both ends. */
  onStart: ((setup: MatchSetup) => void) | null = null;
  readonly stats: NetStats = { rtt: 0, rate: 0, delay: 0, starved: 0, direct: false };

  private socket: PartySocket;
  /** The line straight to the other browser, when there is one. */
  private readonly link = new DirectLink((data) => this.send({ t: 'signal', data }));
  /** Host: who the line was last offered to, so a returning guest is offered a new one. */
  private offeredTo = '';
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
    this.socket = new PartySocket({ host, party: 'room', room });
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('open', () => {
      this.status = this.setup ? 'playing' : 'lobby';
      this.send({ t: 'hello', name });
      this.changed();
    });
    this.socket.addEventListener('close', () => {
      if (this.status !== 'closed') this.status = 'closed';
      this.changed();
    });
    this.socket.addEventListener('message', (event: MessageEvent) => this.receive(event.data));
    this.link.onMessage = (data) => this.receive(data);
    this.link.onChange = () => {
      this.stats.direct = this.link.open;
      this.changed();
    };
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
    return this.players.length === 2 && this.players.every((p) => p.ready);
  }

  private receive(data: string | ArrayBuffer) {
    if (typeof data !== 'string') {
      if (data.byteLength < 2) return;
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
        if (this.status === 'connecting') this.status = 'lobby';
        // The host offers the other person a line as soon as they are in, and a fresh one if
        // they drop and come back as somebody new.
        const other = this.opponent;
        if (this.isHost && other && other.id !== this.offeredTo) {
          this.offeredTo = other.id;
          // A new person has a new clock; nothing they send is stale against the old one's.
          this.newestInput = -1;
          void this.link.offer();
        }
        break;
      }
      case 'signal':
        void this.link.handle(message.data);
        return;
      case 'full':
        this.notice = 'That game is already full.';
        this.status = 'closed';
        break;
      case 'start':
        this.setup = message.setup;
        this.status = 'playing';
        this.resetView();
        this.onStart?.(message.setup);
        break;
      case 'gone':
        this.notice = 'Your opponent left.';
        break;
    }
    this.changed();
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
  setReady(ready: boolean) {
    this.send({ t: 'ready', ready });
  }
  start(setup: MatchSetup) {
    this.send({ t: 'start', setup });
  }
  close() {
    this.status = 'closed';
    this.link.close();
    this.socket.close();
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  private changed() {
    this.onChange?.();
  }
}

/**
 * Where the rooms live. Set by `.env.development` and `.env.production`; falling back to this
 * page's own origin covers a build that serves the game from the room worker itself.
 */
export const ROOM_HOST = (import.meta.env.VITE_ROOM_HOST as string) || location.host;
