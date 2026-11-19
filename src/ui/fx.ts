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
  const width = p[1].length;
  const flat = p.join('');
  const cells = flat.split('').filter((x) => x === '1').length;
  const col = (j: number) => p.every((row) => row[j] === '1');
  const onlySelf = cells === 1 && p[1][(width - 1) / 2] === '1';
  if (cells >= 7 || onlySelf) return 'burst';
  if (Array.from({ length: width }, (_, j) => j).some(col)) return 'beam';
  if (/^1+$/.test(p[2])) return 'quake';
  if (!p[0].includes('1') && !p[2].includes('1')) return 'wave';
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

/** Classes waiting to go back on (see retrigger), per element. */
const pending = new WeakMap<Element, Set<string>>();

/**
 * Start (or restart) the CSS animation that class `cls` plays on `el`, first taking off `others`
 * (animations it cuts short). A class that is already on comes off now and back on two frames
 * later, which restarts its animation. The usual trick, reading a size in between, would make the
 * browser lay out the whole screen right then, in the middle of the hit it animates.
 */
export function retrigger(el: Element, cls: string, others: readonly string[] = []): void {
  const waiting = pending.get(el) ?? new Set<string>();
  pending.set(el, waiting);
  for (const o of others) {
    if (o === cls) continue;
    el.classList.remove(o);
    waiting.delete(o);
  }
  if (!el.classList.contains(cls) && !waiting.has(cls)) {
    el.classList.add(cls);
    return;
  }
  el.classList.remove(cls);
  waiting.add(cls);
  // One frame is styled without the class (ending its animation), the next starts it again.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (waiting.delete(cls)) el.classList.add(cls);
    }),
  );
}

export class Fx {
  /** The board's border-box size, kept current by a ResizeObserver (null until first measured). */
  private size: { w: number; h: number } | null = null;
  /** The board's grid, read once (it never changes during a match). */
  private grid: { cols: number; rows: number } | null = null;

  constructor(
    private arena: HTMLElement,
    private layer: HTMLElement,
  ) {
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(([e]) => {
        const box = e.borderBoxSize?.[0];
        this.size = box ? { w: box.inlineSize, h: box.blockSize } : null;
      }).observe(arena);
    }
  }

  /** The board's size and grid without measuring it (a measurement mid-animation forces a layout). */
  board(): { w: number; h: number; cols: number; rows: number } {
    if (!this.size) {
      const rect = this.arena.getBoundingClientRect();
      this.size = { w: rect.width, h: rect.height };
    }
    if (!this.grid) {
      const style = getComputedStyle(this.arena);
      this.grid = { cols: Number(style.getPropertyValue('--cols')) || 4, rows: Number(style.getPropertyValue('--rows')) || 3 };
    }
    return { ...this.size, ...this.grid };
  }

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
    const b = this.board();
    const dx = ((to.c - from.c) * (b.w - 8)) / b.cols;
    const dy = ((to.r - from.r) * (b.h - 8)) / b.rows;
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

  /** Expanding ring on a square: a shield for guards, a starburst for stuns, a red flash for hits, vines for a root. */
  ring(pos: Pos, kind: 'shield' | 'stun' | 'impact' | 'root'): void {
    if (!fullEffects()) return;
    this.cell(pos, `ring ${kind}`, 800).appendChild(document.createElement('i'));
  }

  /** Shake the board; strength 1-3. */
  shake(strength: 1 | 2 | 3): void {
    if (!fullEffects()) return;
    retrigger(this.arena, `shake-${strength}`, ['shake-1', 'shake-2', 'shake-3']);
  }
}
