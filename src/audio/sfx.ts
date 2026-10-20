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

function audio(): AudioContext | null {
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
  const a = audio();
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

function noise(dur: number, gain = 0.2, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const g = a.createGain();
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(g).connect(a.destination);
  src.start(t);
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
    noise(0.18, 0.25);
    tone(160, 0.2, 'square', 0.12, 60);
  },
  guard: () => tone(880, 0.18, 'triangle', 0.12, 660),
  miss: () => tone(900, 0.12, 'sine', 0.05, 1400),
  heal: () => {
    tone(523, 0.15, 'sine', 0.1);
    tone(659, 0.2, 'sine', 0.1, undefined, 0.12);
  },
  ko: () => {
    noise(0.5, 0.3);
    tone(220, 0.6, 'sawtooth', 0.12, 40);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, undefined, i * 0.13)),
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
