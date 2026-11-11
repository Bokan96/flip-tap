/** Per-viewer preferences that are not part of the rules. */
export type Speed = 'fast' | 'normal' | 'slow';

const KEY = 'fliptap.speed';
const MULTIPLIER: Record<Speed, number> = { fast: 0.6, normal: 1, slow: 1.5 };

let speed: Speed = read();

function read(): Speed {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'fast' || v === 'slow' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function getSpeed(): Speed {
  return speed;
}

export function setSpeed(s: Speed): void {
  speed = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* storage unavailable */
  }
}

export function speedMultiplier(): number {
  return MULTIPLIER[speed];
}

/** Seconds a human gets to plan a round; 0 = no limit. */
export type PlanTimer = 0 | 30 | 60;
const TIMER_KEY = 'fliptap.timer';
let timer: PlanTimer = readTimer();

function readTimer(): PlanTimer {
  try {
    const v = Number(localStorage.getItem(TIMER_KEY));
    return v === 30 || v === 60 ? v : 0;
  } catch {
    return 0;
  }
}

export function getPlanTimer(): PlanTimer {
  return timer;
}

export function setPlanTimer(t: PlanTimer): void {
  timer = t;
  try {
    localStorage.setItem(TIMER_KEY, String(t));
  } catch {
    /* storage unavailable */
  }
}
