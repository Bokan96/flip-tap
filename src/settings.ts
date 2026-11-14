/** Per-viewer preferences that are not part of the rules. Stored in localStorage when available. */

function stored<T extends string>(key: string, allowed: readonly T[], fallback: () => T) {
  let value: T = fallback();
  try {
    const v = localStorage.getItem(key);
    if (v !== null && (allowed as readonly string[]).includes(v)) value = v as T;
  } catch {
    /* storage unavailable: use the default */
  }
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable: setting lasts for this session */
      }
    },
  };
}

// ---------- animation speed ----------
export type Speed = 'fast' | 'normal' | 'slow';
/** Slowest first, the order the speed slider shows them. */
export const SPEEDS: readonly Speed[] = ['slow', 'normal', 'fast'];
const MULTIPLIER: Record<Speed, number> = { fast: 0.6, normal: 1, slow: 1.5 };
const speed = stored<Speed>('fliptap.speed', SPEEDS, () => 'normal');
export const getSpeed = speed.get;
export const setSpeed = speed.set;
export const speedMultiplier = () => MULTIPLIER[speed.get()];

// ---------- plan timer ----------
/** Seconds a human gets to plan a round; 0 = no limit. These are the stops on the timer slider. */
export const PLAN_TIMERS = [0, 15, 30, 45, 60, 90] as const;
export type PlanTimer = (typeof PLAN_TIMERS)[number];
const timer = stored<string>('fliptap.timer', PLAN_TIMERS.map(String), () => '0');
export const getPlanTimer = () => Number(timer.get()) as PlanTimer;
export const setPlanTimer = (t: PlanTimer) => timer.set(String(t));

// ---------- music ----------
const music = stored<'on' | 'off'>('fliptap.music', ['on', 'off'], () => 'on');
export const isMusicEnabled = () => music.get() === 'on';
export const setMusicEnabled = (on: boolean) => music.set(on ? 'on' : 'off');

// ---------- vibration ----------
const haptics = stored<'on' | 'off'>('fliptap.haptics', ['on', 'off'], () => 'on');
export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const isHapticsEnabled = () => haptics.get() === 'on';
export const setHapticsEnabled = (on: boolean) => haptics.set(on ? 'on' : 'off');

// ---------- card selection ----------
/** On touch, 'on' puts a tapped card straight into the plan instead of selecting it first. */
const instant = stored<'on' | 'off'>('fliptap.instantSelect', ['on', 'off'], () => 'off');
export const isInstantSelect = () => instant.get() === 'on';
export const setInstantSelect = (on: boolean) => instant.set(on ? 'on' : 'off');
/** The setting only changes taps; a mouse click always adds straight away. */
export const touchCapable = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

// ---------- visual effects ----------
/** 'reduced' turns off shakes, particles, hops and flashes. Defaults to the system's reduced-motion setting. */
export type Effects = 'full' | 'reduced';
const effects = stored<Effects>('fliptap.effects', ['full', 'reduced'], () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full',
);
export const getEffects = effects.get;
export const fullEffects = () => effects.get() === 'full';
export function setEffects(e: Effects): void {
  effects.set(e);
  applyEffectsClass();
}
/** Mirrors the effects setting as a class on <html> so CSS can switch animations off. */
export function applyEffectsClass(): void {
  document.documentElement.classList.toggle('reduced-fx', !fullEffects());
}
