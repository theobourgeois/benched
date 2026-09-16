import type { GameEvent, GameMode, MatchState, Team } from '../game/types';

const SAMPLE_NAMES = [
  'shot',
  'slapshot',
  'wrist',
  'pass',
  'pass2',
  'pass3',
  'hit',
  'boards',
  'post',
  'save',
  'save2',
  'goal',
  'horn',
  'whistle',
  'skating',
] as const;

/** Field recordings only — slap, wrist, pass, pads, iron, horn, whistle. */
export class ArenaAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = true;
  private samples = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private skateSource: AudioBufferSourceNode | null = null;
  private skateGain: GainNode | null = null;
  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(value ? 0.65 : 0, this.context.currentTime, 0.025);
  }
  private loadSamples() {
    if (this.loading || !this.context) return;
    const context = this.context;
    this.loading = Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        try {
          const response = await fetch(`/audio/${name}.mp3`);
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.samples.set(name, buffer);
        } catch {
          /* Skip a clip that fails to decode; play() stays silent for that event. */
        }
      }),
    ).then(() => {});
  }
  private sample(name: string, volume: number, rate = 1, delay = 0) {
    const buffer = this.samples.get(name),
      ctx = this.context;
    if (!this.active || !buffer || !ctx || !this.master) return false;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(ctx.currentTime + delay);
    return true;
  }
  private pick(names: readonly string[], volume: number, rate = 1) {
    const ready = names.filter((name) => this.samples.has(name));
    if (!ready.length) return false;
    return this.sample(ready[Math.floor(Math.random() * ready.length)], volume, rate);
  }
  /** `scale` quiets the skates in a slowed or held replay. */
  updateSkating(match: MatchState, scale = 1, team: Team = 0) {
    const ctx = this.context,
      buffer = this.samples.get('skating');
    if (!ctx || !this.master || !buffer) return;
    if (!this.skateSource) {
      this.skateSource = ctx.createBufferSource();
      this.skateGain = ctx.createGain();
      this.skateGain.gain.value = 0;
      this.skateSource.buffer = buffer;
      this.skateSource.loop = true;
      this.skateSource.connect(this.skateGain);
      this.skateGain.connect(this.master);
      this.skateSource.start();
    }
    const p = match.skaters[match.sides[team].controlled];
    const speed =
      (match.phase === 'playing' || match.phase === 'goal') &&
      p.downTimer <= 0 &&
      p.diveTimer <= 0 &&
      p.cellyKind !== 'limp'
        ? Math.hypot(p.vx, p.vz) * scale
        : 0;
    this.skateGain!.gain.setTargetAtTime(
      this.active ? Math.min(0.55, speed / 18) : 0,
      ctx.currentTime,
      0.08,
    );
    this.skateSource.playbackRate.setTargetAtTime(
      0.8 + Math.min(speed, 12) * 0.035,
      ctx.currentTime,
      0.12,
    );
  }
  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.active ? 0.65 : 0;
      this.master.connect(this.context.destination);
    }
    void this.context.resume();
    this.loadSamples();
  }
  play(event: GameEvent, mode: GameMode) {
    const jitter = (span: number) => 1 + (Math.random() - 0.5) * span;
    switch (event.type) {
      case 'shot':
        this.pick(
          event.power > 0.55 ? ['slapshot', 'shot'] : ['wrist', 'shot'],
          0.72 + event.power * 0.28,
          jitter(0.08),
        );
        break;
      case 'pass':
        this.pick(['pass', 'pass2', 'pass3'], 0.58, jitter(0.12));
        break;
      case 'hit':
        if (event.power >= 0.3) this.pick(['hit'], 0.7 + event.power * 0.35, jitter(0.05));
        else this.pick(['boards', 'save'], 0.45 + event.power, jitter(0.1));
        break;
      case 'post':
      case 'crossbar':
        this.sample('post', 0.65 + event.power * 0.35, jitter(0.04));
        break;
      case 'save':
        this.pick(['save', 'save2', 'boards'], 0.7, jitter(0.08));
        break;
      case 'goal':
        if (mode === 'freeSkate') break;
        // A bar-down rings out before the horn.
        this.sample('goal', 0.9, 1, event.barDown ? 0.35 : 0);
        break;
      case 'horn':
        this.sample('horn', 0.85);
        break;
      case 'faceoff':
        this.sample('whistle', 0.5, jitter(0.04));
        break;
      default: {
        const _exhaustive: never = event.type;
        return _exhaustive;
      }
    }
  }
}
