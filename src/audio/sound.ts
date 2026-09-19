import { leadHuman } from '../game/humans';
import { RINK } from '../game/config';
import { clamp } from '../game/math';
import { modeInfo } from '../game/modes';
import type { GameEvent, GameMode, MatchState, Settings, Team } from '../game/types';
import { GOAL_BEAT, playGoalImpact, playGoalTrack, type GoalTrack } from './goalTrack';
import {
  celebrationLevel,
  GOAL_LEAD_IN,
  pickGoalSong,
  songCueTime,
  type GoalSong,
} from './goalSongs';

const SAMPLE_NAMES = [
  'shot',
  'slapshot',
  'wrist',
  'pass2',
  'pass3',
  'receive',
  'receive2',
  'check',
  'bighit',
  'glass',
  'glass2',
  'glass3',
  'glass4',
  'stick',
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

/** Metres from the boards inside which a big hit also rattles the glass. */
const GLASS_REACH = 2.2;

/** Whether a spot on the ice is up against the boards, corners included. */
function byTheBoards(x: number, z: number) {
  const cx = RINK.halfLength - RINK.corner,
    cz = RINK.halfWidth - RINK.corner;
  if (Math.abs(x) > cx && Math.abs(z) > cz)
    return Math.hypot(Math.abs(x) - cx, Math.abs(z) - cz) > RINK.corner - GLASS_REACH;
  return Math.abs(x) > RINK.halfLength - GLASS_REACH || Math.abs(z) > RINK.halfWidth - GLASS_REACH;
}

const GLASS = ['glass', 'glass2', 'glass3', 'glass4'];

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
/** The menu's four kinds of press. */
export type UiSound = 'move' | 'select' | 'back' | 'action';

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
  /** The soundtrack song parked on the lead-in for the next goal, and the one playing now. */
  private goalSong: HTMLAudioElement | null = null;
  private goalGain: GainNode | null = null;
  private cued: GoalSong | null = null;
  private playing: GoalSong | null = null;
  private lastSong: string | undefined;
  /** The whole second the clock showed last frame, so each of the last ten beeps once. */
  private clockSecond = Infinity;
  /** Last frame's phase and countdown, so each new faceoff chimes once. Pauses are skipped. */
  private lastPhase: MatchState['phase'] | null = null;
  private lastCountdown = 0;
  /** When the last menu blip started, so a held direction does not smear into a buzz. */
  private lastBlip = -Infinity;
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
  private pick(names: readonly string[], volume: number, rate = 1, delay = 0) {
    const ready = names.filter((name) => this.samples.has(name));
    if (!ready.length) return false;
    return this.sample(ready[Math.floor(Math.random() * ready.length)], volume, rate, delay);
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
    const p = match.skaters[leadHuman(match, team)?.controlled ?? team * 6];
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
  /**
   * The last ten seconds of a period beep once a second, as EA's NHL games do. It is read off the
   * clock rather than sent as an event, so a guest hears it on its own clock and a pause or a
   * stoppage simply holds it.
   */
  updateClock(match: MatchState) {
    const live =
      match.phase === 'playing' && modeInfo(match.mode).timed && match.mode !== 'shootout';
    const second = Math.ceil(match.clock);
    if (live && match.clock > 0 && second <= 10 && second < this.clockSecond) this.beep();
    this.clockSecond = second;
    // A new draw is a faceoff phase that was not one last frame, or one whose countdown jumped
    // back up. Read off the match like the clock, so a guest hears it on its own view.
    if (match.phase === 'paused') return;
    const fresh =
      match.phase === 'faceoff' &&
      (this.lastPhase !== 'faceoff' || match.countdown > this.lastCountdown + 0.05);
    if (fresh) this.faceoffSet();
    this.lastPhase = match.phase;
    this.lastCountdown = match.countdown;
  }
  /**
   * The centres are set: a low hit with a bright metallic edge, like a broadcast sting. There is
   * no count to the drop on purpose, so this marks the start of the wait and the whistle its end.
   */
  private faceoffSet() {
    this.thump(95, 0.2, 0.4);
    this.noise('bandpass', 2000, 0.9, 0.07, 0.22);
    this.ping(1568, 0.25, 0.025, 0.004);
  }
  /**
   * Menu presses, in the manner of a console sports menu: nothing melodic, just short, sharp
   * transients. A move is a soft low tick, confirm is a snap with a little weight under it,
   * back is the same snap darker and softer, and the other buttons a mid click.
   */
  ui(kind: UiSound) {
    const ctx = this.context;
    if (!this.active || !ctx || !this.sfx) return;
    if (kind === 'move') {
      // Pad and key repeat both run faster than a click can ring out; let every other one through.
      if (ctx.currentTime - this.lastBlip < 0.045) return;
      this.lastBlip = ctx.currentTime;
      this.noise('bandpass', 2400, 0.9, 0.014, 0.22);
    } else if (kind === 'select') {
      this.noise('bandpass', 2000, 1, 0.035, 0.3);
      this.thump(140, 0.08, 0.28);
      this.ping(1760, 0.08, 0.02, 0.006);
    } else if (kind === 'back') {
      this.noise('lowpass', 1500, 0.8, 0.04, 0.26);
      this.thump(100, 0.07, 0.22);
    } else this.noise('bandpass', 1800, 1.2, 0.025, 0.25);
  }
  /** Half a second of white noise, made once and shared by every click. */
  private noiseBuffer: AudioBuffer | null = null;
  /** Connects a one-shot through an envelope into the effects bus and tidies it after. */
  private shot(source: AudioScheduledSourceNode, first: AudioNode, level: number, length: number) {
    const ctx = this.context!,
      at = ctx.currentTime,
      env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.001, at + length);
    first.connect(env);
    env.connect(this.sfx!);
    source.start(at);
    source.stop(at + length + 0.02);
    source.onended = () => {
      source.disconnect();
      first.disconnect();
      env.disconnect();
    };
  }
  /** A filtered burst of noise: the body of every click. */
  private noise(type: BiquadFilterType, freq: number, q: number, length: number, level: number) {
    const ctx = this.context;
    if (!this.active || !ctx || !this.sfx) return;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    source.connect(filter);
    this.shot(source, filter, level, length);
  }
  /** A sine that drops an octave fast: weight under a press, felt more than heard. */
  private thump(freq: number, length: number, level: number) {
    const ctx = this.context;
    if (!this.active || !ctx || !this.sfx) return;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq / 2, ctx.currentTime + length);
    this.shot(osc, osc, level, length);
  }
  /** A thin, steady sine: the glint on top of a click. `bend` sharpens its attack by a hair. */
  private ping(freq: number, length: number, level: number, bend = 0) {
    const ctx = this.context;
    if (!this.active || !ctx || !this.sfx) return;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * (1 + bend * 10), ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + 0.01);
    this.shot(osc, osc, level, length);
  }
  private beep() {
    const ctx = this.context;
    if (!this.active || !ctx || !this.sfx) return;
    const now = ctx.currentTime,
      gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.004);
    gain.gain.setValueAtTime(0.32, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    gain.connect(this.sfx);
    // A scoreboard tone: a clean fundamental with a quieter octave above it for edge.
    for (const [freq, level] of [
      [1175, 1],
      [2350, 0.18],
    ] as const) {
      const osc = ctx.createOscillator(),
        partial = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      partial.gain.value = level;
      osc.connect(partial);
      partial.connect(gain);
      osc.start(now);
      osc.stop(now + 0.17);
      osc.onended = () => {
        osc.disconnect();
        partial.disconnect();
      };
    }
    window.setTimeout(() => gain.disconnect(), 400);
  }
  /** Loads a song and parks the playhead on the lead-in, so a goal can start it without a seek. */
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
        if (this.cued === pick) song.currentTime = songCueTime(pick.drop);
      },
      { once: true },
    );
    song.load();
  }
  /** The song swelling into its drop, or the synthesized beat if the song is not ready. */
  private startCelebration() {
    const ctx = this.context;
    if (!ctx || !this.musicBus || !this.goalOn || !this.active) return;
    this.stopCelebration();
    const song = this.goalSong,
      cued = this.cued;
    const parked = cued ? songCueTime(cued.drop) : 0;
    const ready = song && cued && song.readyState >= 2 && Math.abs(song.currentTime - parked) < 1;
    if (ready) {
      this.playing = cued;
      this.lastSong = cued.name;
      this.cued = null;
      this.goalGain!.gain.cancelScheduledValues(ctx.currentTime);
      this.goalGain!.gain.setValueAtTime(
        celebrationLevel(song.currentTime, cued.drop, false),
        ctx.currentTime,
      );
      void song.play().catch(() => this.fallbackCelebration());
    } else this.fallbackCelebration();
  }
  private fallbackCelebration() {
    const ctx = this.context;
    if (!ctx || !this.musicBus) return;
    this.playing = null;
    this.celebration?.stop(0.02);
    this.celebration = playGoalTrack(ctx, this.musicBus, ctx.currentTime + GOAL_LEAD_IN);
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
        first = since < 0 ? -since : Math.ceil(since / beat) * beat - since,
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
    if (this.playing && this.goalGain && this.context && this.goalSong)
      this.goalGain.gain.setTargetAtTime(
        celebrationLevel(this.goalSong.currentTime, this.playing.drop, paused),
        this.context.currentTime,
        0.06,
      );
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
  /**
   * Body contact in three weights, so a shove does not sound like a knockdown: a shove is the
   * heavy-bag hit played quiet and pitched up, a stagger plays it straight, and a knockdown is its
   * own layered hit with a low boom and a board bang already in it. Along the boards the boards
   * and glass shake behind it as well.
   */
  private hit(event: GameEvent, jitter: (span: number) => number) {
    const power = event.power;
    if (power < 0.45) {
      this.sample('check', 0.22 + power * 0.5, jitter(0.12) * 1.18);
      return;
    }
    const big = power >= 0.75;
    if (big) this.sample('bighit', 0.9 + (power - 0.75) * 0.4, jitter(0.06));
    else this.sample('check', 0.55 + power * 0.4, jitter(0.08));
    if (event.x !== undefined && event.z !== undefined && byTheBoards(event.x, event.z))
      this.pick(GLASS, big ? 0.5 : 0.45, jitter(0.08), 0.012);
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
        this.pick(['pass2', 'pass3'], 0.58, jitter(0.12));
        break;
      case 'receive':
        // Softer and a touch lower than the pass, so the two ends of one pass read apart.
        this.pick(['receive', 'receive2'], 0.3 + event.power * 0.3, jitter(0.1) * 0.94);
        break;
      case 'hit':
        this.hit(event, jitter);
        break;
      case 'stick':
        this.sample('stick', 0.45 + event.power, jitter(0.14));
        break;
      case 'deflect':
        this.sample('check', 0.25 + event.power * 0.4, jitter(0.2) * 1.3);
        break;
      case 'boards':
        this.pick(['boards', 'save2'], 0.3 + event.power * 0.5, jitter(0.1));
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
        } else this.startCelebration();
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
