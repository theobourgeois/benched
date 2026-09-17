import type { SessionDescription, Signal } from './protocol';

/**
 * A line straight between the two browsers, with nothing in the middle.
 *
 * The room relays play traffic, but a relay is a detour: every stick press goes out to the
 * nearest edge of the network and back, twice, even when the other person is across the room.
 * Once both people are in the lobby the host offers a WebRTC data channel, and the room carries
 * the handshake. When it opens, play traffic takes it and the relay becomes the fallback. Every
 * packet is self-contained, so the channel is unordered and never retransmits: a stale frame
 * is worth less than nothing, because the next one is already on its way.
 *
 * It does not always open. Two networks that cannot see each other without a relay of their
 * own fall back to the room, which is what they had before, and nothing is lost.
 *
 * It does not always stay open either. A line that stalls (`disconnected`) usually recovers on
 * its own within seconds, so it is kept, but play goes by the room until it does; sent into a
 * stalled line it would vanish without a trace. A line that fails is closed, and the host
 * offers a new one.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** More than this queued and the line is not keeping up; fresher frames are on their way. */
const BACKLOG_BYTES = 32 * 1024;

export class DirectLink {
  onMessage: ((data: ArrayBuffer) => void) | null = null;
  /** The line opened or closed. */
  onChange: (() => void) | null = null;
  readonly supported = typeof RTCPeerConnection !== 'undefined';

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  /** Candidates that arrived before the description they belong to. */
  private waiting: Signal[] = [];
  /** When the line last changed state, so a handshake or a stall is given time to settle. */
  changedAt = 0;

  constructor(private readonly signal: (s: Signal) => void) {}

  /** Whether play can go this way right now. */
  get open() {
    return this.channel?.readyState === 'open' && this.pc?.connectionState !== 'disconnected';
  }
  /** A handshake under way, or a stall that may yet recover: not worth replacing yet. */
  get settling() {
    const state = this.pc?.connectionState;
    return state === 'new' || state === 'connecting' || state === 'disconnected';
  }

  /** Host: offer a line. Called when the other person arrives, and again if they come back. */
  async offer() {
    if (!this.supported) return;
    const pc = this.fresh();
    this.adopt(pc.createDataChannel('play', { ordered: false, maxRetransmits: 0 }));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription && this.pc === pc)
        this.signal({ sdp: describe(pc.localDescription) });
    } catch {
      // The relay is still there.
    }
  }

  /** Whatever the other end said through the room. */
  async handle(s: Signal) {
    if (!this.supported) return;
    try {
      if ('sdp' in s) {
        if (s.sdp.type === 'offer') {
          const pc = this.fresh();
          pc.ondatachannel = (e) => this.adopt(e.channel);
          await pc.setRemoteDescription(s.sdp);
          if (this.pc !== pc) return;
          await pc.setLocalDescription(await pc.createAnswer());
          if (pc.localDescription && this.pc === pc)
            this.signal({ sdp: describe(pc.localDescription) });
        } else if (this.pc) await this.pc.setRemoteDescription(s.sdp);
        const queued = this.waiting;
        this.waiting = [];
        for (const c of queued) await this.handle(c);
      } else if (this.pc && s.candidate) {
        if (!this.pc.remoteDescription) this.waiting.push(s);
        else await this.pc.addIceCandidate(s.candidate);
      }
    } catch {
      // A handshake that does not work out leaves the relay in place.
    }
  }

  /** True when the line took it. False means send it the long way round. */
  send(data: ArrayBuffer): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return false;
    // Backed up: drop this one rather than queue it behind the others. Fresher ones follow.
    if (channel.bufferedAmount > BACKLOG_BYTES) return true;
    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    this.waiting = [];
  }

  private fresh() {
    this.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (this.pc === pc) this.signal({ candidate: e.candidate ? e.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.changedAt = performance.now();
      // Failed is final for this connection; drop it so the next offer starts clean.
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close();
      this.onChange?.();
    };
    this.pc = pc;
    this.changedAt = performance.now();
    return pc;
  }

  private adopt(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.onChange?.();
    channel.onclose = () => {
      if (this.channel === channel) this.channel = null;
      this.onChange?.();
    };
    channel.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) this.onMessage?.(e.data);
    };
    this.channel = channel;
  }
}

/** Only the two fields that cross; the object the browser hands over carries more. */
const describe = (d: RTCSessionDescription): SessionDescription => ({
  type: d.type as 'offer' | 'answer',
  sdp: d.sdp,
});
