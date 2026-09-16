import { clamp } from '../game/math';
import type { GameEvent, GameMode, MatchState, Settings, Team } from '../game/types';
import { GOAL_BEAT, playGoalImpact, playGoalTrack, type GoalTrack } from './goalTrack';
import { pickGoalSong, type GoalSong } from './goalSongs';

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
  'horn',
  'whistle',
  'skating',
] as const;

/** Matches the old master ceiling so 100% effects sound like they used to. */
const SFX_CEILING = 0.65;
const MUSIC_CEILING = 0.42;
const VOLUME_STEPS = 20;

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function readVolume(n: unknown, fallback = 1) {
  return typeof n === 'number' && Number.isFinite(n) ? clamp(n, 0, 1) : fallback;
}

/** Five-percent ticks, the same grain the settings slider uses. */
export function stepVolume(n: number, dir: 1 | -1) {
  const ticks = n * VOLUME_STEPS;
  const next = dir > 0 ? Math.floor(ticks + 1e-6) + 1 : Math.ceil(ticks - 1e-6) - 1;
  return clamp(next / VOLUME_STEPS, 0, 1);
}

export function formatVolume(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** Field recordings and the goal soundtrack. */
export class ArenaAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private active = true;
  private masterVol = 1;
  private sfxVol = 1;
  private musicVol = 0.7;
  private goalOn = true;
  private samples = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private skateSource: AudioBufferSourceNode | null = null;
  private skateGain: GainNode | null = null;
  /** The synthesized beat, only when the soundtrack could not be cued. */
  private celebration: GoalTrack | null = null;
  /** The soundtrack song cued at its drop for the next goal, and the one playing now. */
  private goalSong: HTMLAudioElement | null = null;
  private goalGain: GainNode | null = null;
  private cued: GoalSong | null = null;
  private playing: GoalSong | null = null;
  private lastSong: string | undefined;
  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    this.syncGains();
    if (!value) this.stopCelebration();
  }
  get goalMusic() {
    return this.goalOn;
  }
  set goalMusic(value: boolean) {
    this.goalOn = value;
    if (!value) this.stopCelebration();
  }
  apply(settings: Settings) {
    this.active = settings.sound;
    this.masterVol = settings.masterVolume;
    this.sfxVol = settings.sfxVolume;
    this.musicVol = settings.musicVolume;
    this.goalOn = settings.goalMusic;
    this.syncGains();
    if (!this.goalOn || !this.active) this.stopCelebration();
  }
  private syncGains() {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.active ? this.masterVol : 0, now, 0.04);
    this.sfx?.gain.setTargetAtTime(this.sfxVol * SFX_CEILING, now, 0.04);
    this.musicBus?.gain.setTargetAtTime(this.musicVol * MUSIC_CEILING, now, 0.04);
  }
  private loadSamples() {
    if (this.loading || !this.context) return;
    const context = this.context;
    this.loading = Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        try {
          const response = await fetch(asset(`audio/${name}.mp3`));
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
    if (!this.active || !buffer || !ctx || !this.sfx) return false;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.sfx);
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
    if (!ctx || !this.sfx || !buffer) return;
    if (!this.skateSource) {
      this.skateSource = ctx.createBufferSource();
      this.skateGain = ctx.createGain();
      this.skateGain.gain.value = 0;
      this.skateSource.buffer = buffer;
      this.skateSource.loop = true;
      this.skateSource.connect(this.skateGain);
      this.skateGain.connect(this.sfx);
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
  /** Loads a song and parks the playhead on its drop, so a goal can start it without a seek. */
  private cueGoalSong() {
    const ctx = this.context;
    if (!ctx || !this.musicBus) return;
    if (!this.goalSong) {
      const song = new Audio();
      song.preload = 'auto';
      song.crossOrigin = 'anonymous';
      this.goalSong = song;
      this.goalGain = ctx.createGain();
      ctx.createMediaElementSource(song).connect(this.goalGain);
      this.goalGain.connect(this.musicBus);
    }
    const song = this.goalSong,
      pick = pickGoalSong(this.lastSong);
    this.cued = pick;
    song.src = asset(`audio/music/${pick.name}.mp3`);
    song.addEventListener(
      'loadedmetadata',
      () => {
        if (this.cued === pick) song.currentTime = pick.drop;
      },
      { once: true },
    );
    song.load();
  }
  /** The song at its drop, or the synthesized beat if the song is not ready. */
  private startCelebration(delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.musicBus || !this.goalOn || !this.active) return;
    this.stopCelebration();
    const song = this.goalSong,
      cued = this.cued;
    const ready =
      song && cued && song.readyState >= 2 && Math.abs(song.currentTime - cued.drop) < 1;
    if (ready) {
      this.playing = cued;
      this.lastSong = cued.name;
      this.cued = null;
      this.goalGain!.gain.cancelScheduledValues(ctx.currentTime);
      this.goalGain!.gain.setValueAtTime(1, ctx.currentTime);
      const go = () => void song.play().catch(() => this.fallbackCelebration());
      if (delay > 0) window.setTimeout(go, delay * 1000);
      else go();
    } else this.fallbackCelebration(delay);
  }
  private fallbackCelebration(delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.musicBus) return;
    this.playing = null;
    this.celebration?.stop(0.02);
    this.celebration = playGoalTrack(ctx, this.musicBus, ctx.currentTime + delay);
  }
  private stopCelebration(fade = 0.15) {
    this.celebration?.stop(fade);
    this.celebration = null;
    const ctx = this.context,
      song = this.goalSong;
    if (this.playing && ctx && song && this.goalGain) {
      this.playing = null;
      this.goalGain.gain.cancelScheduledValues(ctx.currentTime);
      this.goalGain.gain.setValueAtTime(this.goalGain.gain.value, ctx.currentTime);
      this.goalGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      window.setTimeout(
        () => {
          if (this.playing) return;
          song.pause();
          this.cueGoalSong();
        },
        fade * 1000 + 50,
      );
    }
  }
  /** Seconds per beat of whatever is celebrating, for the lamp, the call and the rumble. */
  celebrationBeat() {
    return this.playing ? 60 / this.playing.bpm : GOAL_BEAT;
  }
  /** Pad rumble times for the beats still ahead of us, in milliseconds from now. */
  celebrationPulses(span = 4) {
    const ctx = this.context;
    if (!ctx) return [];
    if (this.playing && this.goalSong) {
      const beat = 60 / this.playing.bpm,
        since = this.goalSong.currentTime - this.playing.drop,
        first = Math.ceil(since / beat) * beat - since,
        pulses: number[] = [];
      for (let t = first; t < span; t += beat) pulses.push(Math.max(0, t * 1000));
      return pulses;
    }
    const track = this.celebration;
    if (!track) return [];
    const now = ctx.currentTime;
    return track.hits
      .filter((t) => t >= now - 0.02 && t < now + span)
      .map((t) => Math.max(0, (t - now) * 1000));
  }
  /** Ducks the beat under a pause, and fades it out once the call is over. */
  updateCelebration(on: boolean, paused: boolean) {
    if (!this.celebration && !this.playing) return;
    if (!on) {
      this.stopCelebration(0.7);
      return;
    }
    this.celebration?.duck(paused ? 0.22 : 1);
    if (this.playing && this.goalGain && this.context)
      this.goalGain.gain.setTargetAtTime(paused ? 0.22 : 1, this.context.currentTime, 0.06);
  }
  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.sfx = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.sfx.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(this.context.destination);
      this.syncGains();
      this.loadSamples();
      this.cueGoalSong();
    }
    void this.context.resume();
  }
  play(event: GameEvent, mode: GameMode, replay = false) {
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
        if (replay) {
          if (this.context && this.musicBus && this.goalOn && this.active)
            playGoalImpact(this.context, this.musicBus, this.context.currentTime);
        } else this.startCelebration(event.barDown ? 0.35 : 0);
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
