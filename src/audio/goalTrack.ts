/**
 * The goal sting. A distorted 808 drop lands with the puck, then a half-time trap beat runs
 * under the celebration and the replay: hats, clap, a ducked pad and a dark bell over an 808
 * that walks the root. Everything is synthesized on the spot, so there is no clip to license,
 * and the lamp, HUD and rumble can all lock to the same grid.
 */
export const GOAL_BPM = 140;
export const GOAL_BEAT = 60 / GOAL_BPM;
/** Sixteenth note. */
const STEP = GOAL_BEAT / 4;
const BARS = 8;
const F1 = 43.65,
  Db1 = 34.65,
  Eb1 = 38.89;
/** Chord roots per bar: i i VI VII in F minor, twice. */
const ROOTS = [F1, F1, Db1, Eb1, F1, F1, Db1, Eb1];
/** Pad voicings an octave and a half up so the saws stay clear of the 808. */
const CHORDS: number[][] = [
  [174.61, 207.65, 261.63],
  [174.61, 207.65, 261.63],
  [138.59, 174.61, 207.65],
  [155.56, 196.0, 233.08],
];
/** 808 hits per bar as [step, length in steps, interval from the root]. The b7 walks under bar B. */
const KICKS: [number, number, number][][] = [
  [
    [0, 5, 1],
    [6, 3, 1],
    [10, 3, 1],
    [13, 3, 1.1892],
  ],
  [
    [0, 4, 1],
    [4, 2, 1],
    [7, 3, 0.8909],
    [11, 2, 0.8909],
    [14, 2, 1],
  ],
];
/** Bell motif over the four-bar phrase as [step, hertz]. */
const BELLS: [number, number][] = [
  [0, 1046.5],
  [3, 830.61],
  [6, 698.46],
  [12, 830.61],
  [16, 1046.5],
  [19, 1244.51],
  [22, 1046.5],
  [28, 830.61],
  [32, 1108.73],
  [35, 830.61],
  [38, 698.46],
  [44, 830.61],
  [48, 932.33],
  [51, 783.99],
  [54, 1244.51],
  [60, 932.33],
];

export interface GoalTrack {
  /** When each 808 lands, in context time. */
  hits: number[];
  /** Fades the beat out and stops every scheduled voice. */
  stop(fade: number): void;
  /** Sits the beat under a pause menu, or brings it back. */
  duck(level: number): void;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext) {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}
/** A room: decaying stereo noise does for a hall when it only carries claps and bells. */
function impulse(ctx: BaseAudioContext) {
  let buffer = impulses.get(ctx);
  if (!buffer) {
    const n = Math.floor(ctx.sampleRate * 1.8);
    buffer = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.2));
    }
    impulses.set(ctx, buffer);
  }
  return buffer;
}
function curve(drive: number) {
  const n = 1024,
    table = new Float32Array(n),
    norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) table[i] = Math.tanh(drive * ((i * 2) / (n - 1) - 1)) / norm;
  return table;
}

/** Builds the voices and the bus. Shared by the full beat and the one-off impact. */
function rig(ctx: BaseAudioContext, out: AudioNode) {
  const sources: AudioScheduledSourceNode[] = [];
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.16;
  const clip = ctx.createWaveShaper();
  clip.curve = curve(1.3);
  clip.oversample = '2x';
  bus.connect(comp);
  comp.connect(clip);
  clip.connect(out);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.55;
  reverb.connect(reverbGain);
  reverbGain.connect(bus);
  // The 808 is driven hard into a soft clip, then rounded off so the fizz stays out of the hats.
  const drive = ctx.createGain();
  drive.gain.value = 3.6;
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve(3.6);
  shaper.oversample = '2x';
  const round = ctx.createBiquadFilter();
  round.type = 'lowpass';
  round.frequency.value = 1400;
  const kickBus = ctx.createGain();
  kickBus.gain.value = 0.6;
  drive.connect(shaper);
  shaper.connect(round);
  round.connect(kickBus);
  kickBus.connect(bus);
  // Everything melodic ducks under each 808, the way a mix does when the sub takes the room.
  const duck = ctx.createGain();
  duck.connect(bus);
  const filter = (type: BiquadFilterType, frequency: number, q = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const noise = (t: number, length: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    src.loopEnd = src.loopStart + 0.5;
    src.start(t, src.loopStart);
    src.stop(t + length);
    sources.push(src);
    return src;
  };
  const chain = (...nodes: AudioNode[]) => {
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
  };
  const kick = (t: number, freq: number, length: number, vel: number, sweep = 3, glide = 0.04) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * sweep, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + glide);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.linearRampToValueAtTime(vel * 0.65, t + length * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t + length);
    chain(osc, g, drive);
    osc.start(t);
    osc.stop(t + length + 0.02);
    sources.push(osc);
    duck.gain.setValueAtTime(0.3, t);
    duck.gain.linearRampToValueAtTime(1, t + Math.min(0.18, length * 0.9));
  };
  const crash = (t: number, vel: number) => {
    const src = noise(t, 2),
      hp = filter('highpass', 1500, 0.5),
      g = ctx.createGain(),
      send = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    send.gain.value = 0.6;
    chain(src, hp, g, bus);
    chain(g, send, reverb);
  };
  const hat = (t: number, open: boolean, vel: number) => {
    const src = noise(t, open ? 0.35 : 0.08),
      hp = filter('highpass', 7800, 0.7),
      hp2 = filter('highpass', 6000, 0.7),
      g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (open ? 0.28 : 0.045));
    chain(src, hp, hp2, g, bus);
  };
  const snare = (t: number, vel: number) => {
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(200, t);
    body.frequency.exponentialRampToValueAtTime(110, t + 0.06);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(vel * 0.9, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
    chain(body, bodyGain, bus);
    body.start(t);
    body.stop(t + 0.14);
    sources.push(body);
    const tail = noise(t, 0.35),
      bp = filter('bandpass', 2200, 0.6),
      g = ctx.createGain(),
      send = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
    send.gain.value = 0.35;
    chain(tail, bp, g, bus);
    chain(g, send, reverb);
    // Three flams make it a clap.
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.011,
        burst = noise(at, 0.04),
        band = filter('bandpass', 1400, 1.2),
        bg = ctx.createGain();
      bg.gain.setValueAtTime(vel * 0.5, at);
      bg.gain.exponentialRampToValueAtTime(0.0008, at + 0.025);
      chain(burst, band, bg, bus);
    }
  };
  const pad = (t: number, freqs: number[], length: number) => {
    for (const freq of freqs)
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const lp = filter('lowpass', 900, 0.8),
          g = ctx.createGain(),
          send = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.04, t + 0.05);
        g.gain.setValueAtTime(0.04, t + length - 0.08);
        g.gain.linearRampToValueAtTime(0, t + length);
        send.gain.value = 0.5;
        chain(osc, lp, g, duck);
        chain(g, send, reverb);
        osc.start(t);
        osc.stop(t + length + 0.01);
        sources.push(osc);
      }
  };
  const echo = ctx.createDelay(1);
  echo.delayTime.value = STEP * 3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const echoTone = filter('lowpass', 3000);
  const echoMix = ctx.createGain();
  echoMix.gain.value = 0.5;
  chain(echo, echoTone, feedback, echo);
  chain(echoTone, echoMix, duck);
  const bell = (t: number, freq: number, vel: number) => {
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 3.5;
    const index = ctx.createGain();
    index.gain.setValueAtTime(freq * 1.2, t);
    index.gain.exponentialRampToValueAtTime(1, t + 0.25);
    mod.connect(index);
    index.connect(carrier.frequency);
    const g = ctx.createGain(),
      send = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.7);
    send.gain.value = 0.6;
    chain(carrier, g, duck);
    chain(g, echo);
    chain(g, send, reverb);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + 0.72);
    mod.stop(t + 0.72);
    sources.push(carrier, mod);
  };
  return { bus, sources, kick, crash, hat, snare, pad, bell };
}

/** The whole celebration, scheduled up front. `at` is the goal moment in context time. */
export function playGoalTrack(ctx: BaseAudioContext, out: AudioNode, at: number): GoalTrack {
  const r = rig(ctx, out);
  const hits: number[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = at + bar * 16 * STEP,
      root = ROOTS[bar],
      pattern = KICKS[bar % 2];
    for (const [step, length, ratio] of pattern) {
      const t = t0 + step * STEP;
      // The first one is the drop: a long fall from high up, so it reads as an impact.
      if (bar === 0 && step === 0) r.kick(t, root, length * STEP, 1.15, 7, 0.32);
      else r.kick(t, root * ratio, length * STEP, 1);
      hits.push(t);
    }
    r.snare(t0 + 8 * STEP, 0.55);
    const triplets = bar % 4 === 3,
      rolls = bar % 2 === 1;
    for (let step = 0; step < 16; step++) {
      if (bar === 0 && step < 2) continue;
      if (triplets && step >= 8 && step < 12) continue;
      const open = step === 6 || (bar % 2 === 0 && step === 14);
      const vel = step % 4 === 0 ? 0.26 : step % 2 === 0 ? 0.2 : 0.14;
      r.hat(t0 + step * STEP, open, open ? 0.28 : vel * 1.5);
      if (rolls && step >= 12) r.hat(t0 + (step + 0.5) * STEP, false, 0.18);
    }
    if (triplets)
      for (let i = 0; i < 6; i++) r.hat(t0 + (8 + i * (4 / 6)) * STEP, false, i % 3 ? 0.2 : 0.32);
    r.pad(t0, CHORDS[bar % 4], 16 * STEP);
  }
  for (let phrase = 0; phrase < BARS / 4; phrase++)
    for (const [step, freq] of BELLS) r.bell(at + (phrase * 64 + step) * STEP, freq, 0.06);
  r.crash(at, 0.45);
  const end = at + BARS * 16 * STEP + 2;
  const stopAll = (when: number) => {
    for (const src of r.sources)
      try {
        src.stop(when);
      } catch {
        /* Already stopped. */
      }
  };
  stopAll(end);
  return {
    hits,
    stop(fade) {
      const now = ctx.currentTime;
      r.bus.gain.cancelScheduledValues(now);
      r.bus.gain.setValueAtTime(r.bus.gain.value, now);
      r.bus.gain.linearRampToValueAtTime(0, now + fade);
      stopAll(now + fade + 0.02);
    },
    duck(level) {
      r.bus.gain.setTargetAtTime(level, ctx.currentTime, 0.06);
    },
  };
}

/** Just the drop and the crash: a goal crossing the line again inside its own replay. */
export function playGoalImpact(ctx: BaseAudioContext, out: AudioNode, at: number) {
  const r = rig(ctx, out);
  r.kick(at, F1, 1.1, 0.9, 7, 0.32);
  r.crash(at, 0.3);
}
