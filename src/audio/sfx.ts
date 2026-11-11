import { ASSETS, assetUrl, type SoundId } from '../content/assets';

/** Synthesized placeholder sounds (WebAudio), replaceable via content/assets.ts. */

let ctx: AudioContext | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem('fliptap.sound') !== 'off';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem('fliptap.sound', on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

/** The shared audio context (created lazily; browsers only let it start after a user gesture). */
export function audioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, slideTo?: number, delay = 0): void {
  const a = audioContext();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
export function noiseBuffer(a: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Burst of noise through a band-pass filter that sweeps from `from` Hz to `to` Hz. */
function noise(dur: number, gain = 0.2, delay = 0, from = 2000, to = from, q = 0.8): void {
  const a = audioContext();
  if (!a) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SYNTH: Record<SoundId, () => void> = {
  click: () => tone(660, 0.06, 'square', 0.06),
  place: () => tone(520, 0.08, 'triangle', 0.12, 780),
  deny: () => tone(180, 0.15, 'sawtooth', 0.08, 120),
  reveal: () => {
    tone(392, 0.12, 'triangle', 0.12);
    tone(523, 0.12, 'triangle', 0.12, undefined, 0.1);
    tone(784, 0.2, 'triangle', 0.12, undefined, 0.2);
  },
  step: () => tone(300, 0.07, 'sine', 0.08, 420),
  hit: () => {
    noise(0.18, 0.35, 0, 1800, 300);
    tone(160, 0.2, 'square', 0.12, 60);
  },
  guard: () => {
    tone(880, 0.18, 'triangle', 0.12, 660);
    tone(1320, 0.12, 'sine', 0.05, 990, 0.02);
  },
  miss: () => noise(0.22, 0.12, 0, 600, 3200, 2),
  heal: () => {
    tone(523, 0.15, 'sine', 0.1);
    tone(659, 0.2, 'sine', 0.1, undefined, 0.12);
  },
  ko: () => {
    noise(0.6, 0.35, 0, 1200, 120);
    tone(220, 0.7, 'sawtooth', 0.12, 40);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, undefined, i * 0.13)),
  tick: () => tone(1320, 0.04, 'square', 0.05),
  flip: () => noise(0.07, 0.12, 0, 3000, 5000, 1.5),
  clang: () => {
    tone(1180, 0.3, 'square', 0.05, 1100);
    tone(1770, 0.25, 'triangle', 0.06, 1650);
  },
  zap: () => {
    tone(1400, 0.16, 'sawtooth', 0.06, 300);
    noise(0.12, 0.1, 0.02, 4000, 1500, 3);
  },
  shimmer: () => [988, 1319, 1568].forEach((f, i) => tone(f, 0.22, 'sine', 0.05, undefined, i * 0.06)),
  reload: () => {
    noise(0.05, 0.2, 0, 2500, 2500, 4);
    noise(0.05, 0.2, 0.12, 1800, 1800, 4);
    tone(440, 0.18, 'square', 0.05, 880, 0.2);
  },
  trap: () => {
    tone(700, 0.08, 'square', 0.08, 300);
    noise(0.15, 0.2, 0.02, 3000, 900, 2);
  },
  burn: () => noise(0.35, 0.14, 0, 900, 2600, 0.6),
  swap: () => {
    tone(330, 0.18, 'sine', 0.08, 660);
    tone(660, 0.18, 'sine', 0.08, 330, 0.05);
  },
  thud: () => {
    tone(110, 0.2, 'sine', 0.2, 50);
    noise(0.12, 0.15, 0, 400, 150);
  },
  slash: () => noise(0.18, 0.22, 0, 5000, 900, 1.2),
  burst: () => {
    noise(0.3, 0.25, 0, 900, 200);
    tone(90, 0.25, 'sine', 0.15, 40);
  },
  wave: () => noise(0.4, 0.18, 0, 300, 1400, 0.7),
  beam: () => {
    tone(880, 0.3, 'sawtooth', 0.05, 1760);
    tone(440, 0.3, 'square', 0.04, 880);
  },
  quake: () => {
    tone(60, 0.45, 'sawtooth', 0.12, 35);
    noise(0.45, 0.2, 0, 250, 80, 0.5);
  },
};

const fileCache = new Map<string, HTMLAudioElement>();

export function play(id: SoundId): void {
  if (!enabled) return;
  const file = ASSETS.sounds[id];
  if (file) {
    let el = fileCache.get(file);
    if (!el) {
      el = new Audio(assetUrl(file));
      fileCache.set(file, el);
    }
    el.currentTime = 0;
    void el.play().catch(() => undefined);
    return;
  }
  SYNTH[id]();
}
