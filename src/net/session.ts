import PartySocket from 'partysocket';
import { EMPTY_INPUT } from '../game/config';
import type { InputFrame, MatchState, Team } from '../game/types';
import { mergeEdges, noEdges } from '../input/frames';
import { decodeInput, encodeInput } from './input';
import { applySnapshot, encodeSnapshot } from './snapshot';
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
 */

export type NetStatus = 'connecting' | 'lobby' | 'playing' | 'closed';

/**
 * Frames the host lets build up before catching up. The simulation steps faster than anyone
 * sends, so the queue is usually empty and the last frame stands in; this only covers a burst
 * arriving after a stall, or a guest on a display faster than the 120 Hz step.
 */
const JITTER_TARGET = 2;
/** Snapshots a second. Fast enough that the pose code, which reads deltas, stays smooth. */
export const SNAPSHOT_HZ = 30;

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

  private socket: PartySocket;
  /** Host: the guest's frames, waiting to be taken one per simulation step. */
  private queue: InputFrame[] = [];
  /** Host: the last frame the guest sent, held while nothing new arrives. */
  private held: InputFrame = EMPTY_INPUT;
  /** Guest: the newest snapshot, applied once on the next frame drawn. */
  private pending: ArrayBuffer | null = null;
  private sinceSnapshot = 0;
  /** Host: the last call the guest has been told about, so each one crosses exactly once. */
  private sentEvent = -1;

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
      else if (tag === WIRE_SNAPSHOT && !this.isHost) this.pending = bodyOf(data);
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'room':
        this.you = message.you;
        this.players = message.players;
        if (this.status === 'connecting') this.status = 'lobby';
        break;
      case 'full':
        this.notice = 'That game is already full.';
        this.status = 'closed';
        break;
      case 'start':
        this.setup = message.setup;
        this.status = 'playing';
        this.onStart?.(message.setup);
        break;
      case 'gone':
        this.notice = 'Your opponent left.';
        break;
    }
    this.changed();
  }

  private queueInput(body: ArrayBuffer) {
    this.queue.push(decodeInput(body).frame);
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

  /** Guest: what we are trying to do, sent every frame we draw. */
  sendInput(frame: InputFrame, tick: number) {
    if (this.socket.readyState !== 1) return;
    this.socket.send(tagged(WIRE_INPUT, encodeInput(frame, tick)));
  }

  /** Host: say what happened, at a steady rate rather than every simulation step. */
  publish(s: MatchState, dt: number) {
    if (this.socket.readyState !== 1 || !this.isHost) return;
    this.sinceSnapshot += dt;
    if (this.sinceSnapshot < 1 / SNAPSHOT_HZ) return;
    this.sinceSnapshot = 0;
    this.socket.send(tagged(WIRE_SNAPSHOT, encodeSnapshot(s, this.sentEvent)));
    this.sentEvent = s.events.at(-1)?.id ?? this.sentEvent;
  }

  /** Guest: pose the match on the newest thing the host said. True when there was one. */
  applyLatest(s: MatchState) {
    if (!this.pending) return false;
    applySnapshot(s, this.pending);
    this.pending = null;
    return true;
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
    this.socket.close();
  }

  private send(message: ClientMessage) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  private changed() {
    this.onChange?.();
  }
}

/** Where the rooms live. Set VITE_ROOM_HOST to point a build at a deployed worker. */
export const ROOM_HOST = (import.meta.env.VITE_ROOM_HOST as string) || 'localhost:8787';
