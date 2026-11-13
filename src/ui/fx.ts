import type { CardDef, Pos } from '../engine/types';
import { fullEffects, isHapticsEnabled } from '../settings';

/*
 * Board effects: particles, travelling sparks, rings and shakes. Everything animates only
 * transform/opacity, removes itself when done, and is skipped when effects are reduced.
 */

export type FxKind = 'slash' | 'burst' | 'wave' | 'beam' | 'quake';

/** Visual style of an attack: the card's own `fx`, or one guessed from its pattern. */
export function fxKind(card: CardDef): FxKind {
  if (card.fx) return card.fx;
  const p = card.pattern ?? ['000', '000', '000'];
  const flat = p.join('');
  const cells = flat.split('').filter((x) => x === '1').length;
  const col = (j: number) => p.every((row) => row[j] === '1');
  if (cells >= 7 || flat === '000010000') return 'burst';
  if (col(0) || col(1) || col(2)) return 'beam';
  if (p[2] === '111') return 'quake';
  if (p[0] === '000' && p[2] === '000') return 'wave';
  return 'slash';
}

export type Haptic = 'tap' | 'hit' | 'big' | 'ko';
const PATTERNS: Record<Haptic, number | number[]> = { tap: 8, hit: 28, big: [40, 30, 50], ko: [80, 40, 140] };

export function haptic(kind: Haptic): void {
  if (!isHapticsEnabled() || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw without user activation */
  }
}

/** Restart a CSS animation class on an element. */
export function retrigger(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

export class Fx {
  constructor(
    private arena: HTMLElement,
    private layer: HTMLElement,
  ) {}

  private cell(pos: Pos, cls: string, life: number): HTMLElement {
    const el = document.createElement('div');
    el.className = `fx ${cls}`;
    el.style.setProperty('--r', String(pos.r));
    el.style.setProperty('--c', String(pos.c));
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), life);
    return el;
  }

  /** Burst of small particles flying out of a square. */
  particles(pos: Pos, color: string, count: number, kind: 'spark' | 'dust' = 'spark'): void {
    if (!fullEffects()) return;
    const el = this.cell(pos, `particles ${kind}`, 900);
    el.style.setProperty('--clr', color);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      const spread = kind === 'dust' ? 140 : 360;
      const base = kind === 'dust' ? 200 : 0;
      p.style.setProperty('--a', `${base + (spread * i) / count + Math.random() * 20}deg`);
      p.style.setProperty('--dist', `${(kind === 'dust' ? 14 : 22) + Math.random() * 18}px`);
      el.appendChild(p);
    }
  }

  /** Dots that travel from one square to another (counter sparks, drain motes). */
  travel(from: Pos, to: Pos, color: string, count: number, kind: 'spark' | 'mote'): void {
    if (!fullEffects()) return;
    const rect = this.arena.getBoundingClientRect();
    const cols = Number(getComputedStyle(this.arena).getPropertyValue('--cols')) || 4;
    const rows = Number(getComputedStyle(this.arena).getPropertyValue('--rows')) || 3;
    const dx = ((to.c - from.c) * (rect.width - 8)) / cols;
    const dy = ((to.r - from.r) * (rect.height - 8)) / rows;
    const el = this.cell(from, `travel ${kind}`, 1100);
    el.style.setProperty('--clr', color);
    el.style.setProperty('--dx', `${dx}px`);
    el.style.setProperty('--dy', `${dy}px`);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--delay', `${i * 70}ms`);
      p.style.setProperty('--jx', `${(Math.random() - 0.5) * 18}px`);
      p.style.setProperty('--jy', `${(Math.random() - 0.5) * 18}px`);
      el.appendChild(p);
    }
  }

  /** Motes drawn in from all around into a square (Focus gathering energy). */
  gather(pos: Pos, color: string, count: number): void {
    if (!fullEffects()) return;
    const el = this.cell(pos, 'particles gather', 1000);
    el.style.setProperty('--clr', color);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--a', `${(360 * i) / count + Math.random() * 25}deg`);
      p.style.setProperty('--dist', `${26 + Math.random() * 14}px`);
      p.style.setProperty('--delay', `${Math.round(Math.random() * 220)}ms`);
      el.appendChild(p);
    }
  }

  /** Expanding ring on a square: a shield for guards, a starburst for stuns. */
  ring(pos: Pos, kind: 'shield' | 'stun'): void {
    if (!fullEffects()) return;
    this.cell(pos, `ring ${kind}`, 800).appendChild(document.createElement('i'));
  }

  /** Shake the board; strength 1-3. */
  shake(strength: 1 | 2 | 3): void {
    if (!fullEffects()) return;
    this.arena.classList.remove('shake-1', 'shake-2', 'shake-3');
    retrigger(this.arena, `shake-${strength}`);
  }
}
