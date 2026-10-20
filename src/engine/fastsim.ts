import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import type { MatchState, Plan } from './types';

/*
 * Allocation-free copy of rules.resolveStep used by the AI, which simulates
 * tens of thousands of rounds per decision. A test keeps it in sync with rules.ts.
 */

interface FastCard {
  cost: number;
  dr: number;
  dc: number;
  heal: number;
  guard: number;
  damage: number;
  /** Flattened [dr, dc] pairs, facing right. */
  cells: number[];
}

const cache = new Map<string, FastCard>();

export function fastCard(id: string): FastCard {
  let fc = cache.get(id);
  if (!fc) {
    const c = getCard(id);
    const cells: number[] = [];
    if (c.kind === 'attack' && c.pattern) {
      c.pattern.forEach((row, i) => {
        for (let j = 0; j < 3; j++) if (row[j] === '1') cells.push(i - 1, j - 1);
      });
    }
    fc = {
      cost: c.cost,
      dr: c.step?.[0] ?? 0,
      dc: c.step?.[1] ?? 0,
      heal: c.heal ?? 0,
      guard: c.guard ?? 0,
      damage: c.kind === 'attack' ? (c.damage ?? 0) : 0,
      cells,
    };
    cache.set(id, fc);
  }
  return fc;
}

export interface FastResult {
  life: [number, number];
  energy: [number, number];
  /** -1 none, 0/1 winner seat, 2 draw. */
  outcome: number;
}

function covers(card: FastCard, r: number, c: number, facing: number, tr: number, tc: number): boolean {
  const cells = card.cells;
  for (let k = 0; k < cells.length; k += 2) {
    const ar = r + cells[k];
    const ac = c + cells[k + 1] * facing;
    if (ar === tr && ac === tc) return true; // target is always on the board
  }
  return false;
}

const rows = BALANCE.rows;
const cols = BALANCE.cols;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Simulate one round (without end-of-round recovery). Same semantics as rules.resolveRound. */
export function fastSimulate(state: MatchState, plan0: Plan, plan1: Plan): FastResult {
  const [p0, p1] = state.players;
  let l0 = p0.life, l1 = p1.life, e0 = p0.energy, e1 = p1.energy;
  let r0 = p0.pos.r, c0 = p0.pos.c, r1 = p1.pos.r, c1 = p1.pos.c;
  let f0 = p0.facing as number, f1 = p1.facing as number;
  let outcome = -1;

  for (let slot = 0; slot < plan0.length; slot++) {
    const a = fastCard(plan0[slot]);
    const b = fastCard(plan1[slot]);
    const act0 = e0 + a.cost >= 0;
    const act1 = e1 + b.cost >= 0;

    if (act0) { r0 = clamp(r0 + a.dr, 0, rows - 1); c0 = clamp(c0 + a.dc, 0, cols - 1); }
    if (act1) { r1 = clamp(r1 + b.dr, 0, rows - 1); c1 = clamp(c1 + b.dc, 0, cols - 1); }
    if (c1 > c0) { f0 = 1; f1 = -1; } else if (c1 < c0) { f0 = -1; f1 = 1; }

    let d0 = 0, d1 = 0;
    if (act1 && b.damage > 0 && covers(b, r1, c1, f1, r0, c0)) {
      d0 = Math.max(0, b.damage - (act0 ? a.guard : 0));
    }
    if (act0 && a.damage > 0 && covers(a, r0, c0, f0, r1, c1)) {
      d1 = Math.max(0, a.damage - (act1 ? b.guard : 0));
    }

    let nl0 = l0 - d0, nl1 = l1 - d1, ne0 = e0, ne1 = e1;
    if (act0) { nl0 += a.heal; ne0 += a.cost; }
    if (act1) { nl1 += b.heal; ne1 += b.cost; }
    l0 = clamp(nl0, 0, p0.lifeMax); l1 = clamp(nl1, 0, p1.lifeMax);
    e0 = clamp(ne0, 0, p0.energyMax); e1 = clamp(ne1, 0, p1.energyMax);

    if (l0 <= 0 || l1 <= 0) {
      outcome = l0 <= 0 && l1 <= 0 ? 2 : l0 <= 0 ? 1 : 0;
      break;
    }
  }
  return { life: [l0, l1], energy: [e0, e1], outcome };
}
