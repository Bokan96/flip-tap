import { ASSETS, assetUrl } from '../content/assets';
import { isMusicEnabled } from '../settings';
import { audioContext, noiseBuffer } from './sfx';

/*
 * Background music: a tiny step sequencer playing original placeholder loops, or a looping
 * audio file per track if one is set in content/assets.ts (ASSETS.music).
 */
export type Track = 'menu' | 'battle';

interface Song {
  bpm: number;
  /** One chord per bar (MIDI note numbers). */
  chords: number[][];
  /** Steps (16 per bar) on which the bass plays the chord root. */
  bass: number[];
  /** [step, tone] pairs: tone 0-2 picks a chord note, +3 adds an octave. */
  arp: [number, number][];
  arpWave: OscillatorType;
  pad: boolean;
  drums: boolean;
}

const SONGS: Record<Track, Song> = {
  menu: {
    bpm: 84,
    chords: [
      [62, 65, 69],
      [58, 62, 65],
      [65, 69, 72],
      [60, 64, 67],
    ],
    bass: [0, 10],
    arp: [[0, 0], [3, 2], [6, 1], [8, 3], [11, 2], [14, 1]],
    arpWave: 'triangle',
    pad: true,
    drums: false,
  },
  battle: {
    bpm: 118,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [60, 64, 67],
      [55, 59, 62],
    ],
    bass: [0, 3, 6, 8, 11, 14],
    arp: [[0, 0], [2, 1], [4, 2], [6, 3], [8, 0], [10, 1], [12, 2], [14, 4]],
    arpWave: 'square',
    pad: false,
    drums: true,
  },
};

const VOLUME = 0.5;
const DUCKED = 0.15;

let wanted: Track | null = null;
let playing: Track | null = null;
let master: GainNode | null = null;
let fileEl: HTMLAudioElement | null = null;
let timer: number | null = null;
let step = 0;
let nextTime = 0;
let ducked = false;
let gestureSeen = false;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function voice(a: AudioContext, freq: number, t: number, dur: number, type: OscillatorType, gain: number, attack = 0.01): void {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function drum(a: AudioContext, kind: 'kick' | 'snare' | 'hat', t: number): void {
  if (kind === 'kick') {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + 0.2);
    return;
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1800;
  const g = a.createGain();
  const dur = kind === 'hat' ? 0.04 : 0.12;
  g.gain.setValueAtTime(kind === 'hat' ? 0.05 : 0.14, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function schedule(): void {
  const a = audioContext();
  if (!a || !master || !playing) return;
  const song = SONGS[playing];
  const stepDur = 60 / song.bpm / 4;
  while (nextTime < a.currentTime + 0.15) {
    const chord = song.chords[Math.floor(step / 16) % song.chords.length];
    const s = step % 16;
    if (song.bass.includes(s)) voice(a, midi(chord[0] - 24), nextTime, stepDur * 1.8, 'triangle', 0.22);
    const arp = song.arp.find(([at]) => at === s);
    if (arp) {
      const note = chord[arp[1] % 3] + 12 * Math.floor(arp[1] / 3);
      voice(a, midi(note), nextTime, stepDur * 1.6, song.arpWave, song.arpWave === 'square' ? 0.03 : 0.06);
    }
    if (song.pad && s === 0) for (const n of chord) voice(a, midi(n - 12), nextTime, stepDur * 16, 'sine', 0.035, 0.4);
    if (song.drums) {
      if (s === 0 || s === 8) drum(a, 'kick', nextTime);
      if (s === 4 || s === 12) drum(a, 'snare', nextTime);
      if (s % 4 === 2) drum(a, 'hat', nextTime);
    }
    nextTime += stepDur;
    step++;
  }
}

function stop(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  const a = audioContext();
  if (master && a) {
    const old = master;
    old.gain.setTargetAtTime(0, a.currentTime, 0.08);
    setTimeout(() => old.disconnect(), 400);
  }
  master = null;
  fileEl?.pause();
  fileEl = null;
  playing = null;
}

function start(track: Track): void {
  stop();
  if (!isMusicEnabled() || !gestureSeen || document.hidden) return;
  playing = track;
  const file = ASSETS.music[track];
  if (file) {
    fileEl = new Audio(assetUrl(file));
    fileEl.loop = true;
    fileEl.volume = ducked ? DUCKED : VOLUME;
    void fileEl.play().catch(() => undefined);
    return;
  }
  const a = audioContext();
  if (!a) return;
  master = a.createGain();
  master.gain.value = ducked ? DUCKED : VOLUME;
  master.connect(a.destination);
  step = 0;
  nextTime = a.currentTime + 0.05;
  schedule();
  timer = window.setInterval(schedule, 25);
}

/** Choose the background track (null = silence). Starts after the first user gesture. */
export function setMusic(track: Track | null): void {
  wanted = track;
  if (track === playing) return;
  if (!track) return stop();
  start(track);
}

/** Re-apply the music on/off setting. */
export function refreshMusic(): void {
  if (!isMusicEnabled()) stop();
  else if (wanted && playing !== wanted) start(wanted);
}

/** Lower the music while a menu is open. */
export function duckMusic(on: boolean): void {
  ducked = on;
  const a = audioContext();
  if (master && a) master.gain.setTargetAtTime(on ? DUCKED : VOLUME, a.currentTime, 0.1);
  if (fileEl) fileEl.volume = on ? DUCKED : VOLUME;
}

// Browsers only allow audio after a gesture; background tabs throttle timers, so pause there.
const onGesture = () => {
  if (gestureSeen) return;
  gestureSeen = true;
  if (wanted && !playing) start(wanted);
};
window.addEventListener('pointerdown', onGesture);
window.addEventListener('keydown', onGesture);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (wanted) start(wanted);
});
