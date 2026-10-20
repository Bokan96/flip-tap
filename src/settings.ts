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
