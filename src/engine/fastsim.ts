import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import type { MatchState, Mods, Plan } from './types';

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
  isAttack: boolean;
  damage: number;
  push: number;
  stun: boolean;
  counter: number;
  drain: number;
  /** Flattened [dr, dc] pairs, facing right. */
  cells: number[];
}

const cache = new Map<string, FastCard>();

export function fastCard(id: string): FastCard {
  let fc = cache.get(id);
  if (!fc) {
    const c = getCard(id);
    const isAttack = c.kind === 'attack';
    const cells: number[] = [];
    if (isAttack && c.pattern) {
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
      isAttack,
      damage: isAttack ? (c.damage ?? 0) : 0,
      push: isAttack ? (c.push ?? 0) : 0,
      stun: isAttack && !!c.stun,
      counter: c.counter ?? 0,
      drain: isAttack ? (c.drain ?? 0) : 0,
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
  /** Final positions: [r0, c0, r1, c1]. */
  pos: [number, number, number, number];
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

/** Same as rules.hitDamage. */
function damageOf(card: FastCard, attackerLife: number, am: Mods, dm: Mods, guard: number, moved: boolean): number {
  let d = card.damage + am.damageBonus;
  if (am.lowLifeThreshold > 0 && attackerLife <= am.lowLifeThreshold) d += am.lowLifeBonus;
  if (moved) d += am.vsMovedBonus - dm.movedReduction;
  d -= guard + dm.damageReduction;
  return d > 0 ? d : 0;
}

/** Same as rules.displace, columns only. */
function displaceCol(tc: number, ac: number, attackerFacing: number, n: number): number {
  if (n > 0) {
    const dir = tc === ac ? attackerFacing : Math.sign(tc - ac);
    return clamp(tc + dir * n, 0, cols - 1);
  }
  const gap = ac - tc;
  const steps = Math.min(-n, Math.abs(gap));
  return tc + Math.sign(gap) * steps;
}

/** Simulate one round (without end-of-round recovery). Same semantics as rules.resolveRound. */
export function fastSimulate(state: MatchState, plan0: Plan, plan1: Plan): FastResult {
  const [p0, p1] = state.players;
  const m0 = p0.mods, m1 = p1.mods;
  let l0 = p0.life, l1 = p1.life, e0 = p0.energy, e1 = p1.energy;
  let r0 = p0.pos.r, c0 = p0.pos.c, r1 = p1.pos.r, c1 = p1.pos.c;
  let f0 = p0.facing as number, f1 = p1.facing as number;
  let z0 = p0.dazed, z1 = p1.dazed;
  let outcome = -1;

  for (let slot = 0; slot < plan0.length; slot++) {
    const a = fastCard(plan0[slot]);
    const b = fastCard(plan1[slot]);
    const act0 = !z0 && e0 + a.cost >= 0;
    const act1 = !z1 && e1 + b.cost >= 0;

    const sr0 = r0, sc0 = c0, sr1 = r1, sc1 = c1;
    if (act0) { r0 = clamp(r0 + a.dr, 0, rows - 1); c0 = clamp(c0 + a.dc, 0, cols - 1); }
    if (act1) { r1 = clamp(r1 + b.dr, 0, rows - 1); c1 = clamp(c1 + b.dc, 0, cols - 1); }
    const mv0 = r0 !== sr0 || c0 !== sc0;
    const mv1 = r1 !== sr1 || c1 !== sc1;
    if (c1 > c0) { f0 = 1; f1 = -1; } else if (c1 < c0) { f0 = -1; f1 = 1; }

    let d0 = 0, d1 = 0, k0 = 0, k1 = 0, h0 = 0, h1 = 0;
    let nz0 = false, nz1 = false;
    let nc0 = c0, nc1 = c1;
    if (act1 && b.isAttack && covers(b, r1, c1, f1, r0, c0)) {
      d0 = damageOf(b, l1, m1, m0, act0 ? a.guard : 0, mv0);
      if (act0 && a.counter) k1 += a.counter;
      if (b.drain && d0 > 0) h1 = Math.floor((d0 * b.drain) / 100);
      if (b.stun && d0 > 0) nz0 = true;
      if (b.push && !m0.immovable) nc0 = displaceCol(c0, c1, f1, b.push + Math.sign(b.push) * m1.pushBonus);
    }
    if (act0 && a.isAttack && covers(a, r0, c0, f0, r1, c1)) {
      d1 = damageOf(a, l0, m0, m1, act1 ? b.guard : 0, mv1);
      if (act1 && b.counter) k0 += b.counter;
      if (a.drain && d1 > 0) h0 = Math.floor((d1 * a.drain) / 100);
      if (a.stun && d1 > 0) nz1 = true;
      if (a.push && !m1.immovable) nc1 = displaceCol(c1, c0, f0, a.push + Math.sign(a.push) * m0.pushBonus);
    }

    let nl0 = l0 - d0 - k0 + h0, nl1 = l1 - d1 - k1 + h1, ne0 = e0, ne1 = e1;
    if (act0) { nl0 += a.heal; ne0 += a.cost; }
    if (act1) { nl1 += b.heal; ne1 += b.cost; }
    l0 = clamp(nl0, 0, p0.lifeMax); l1 = clamp(nl1, 0, p1.lifeMax);
    e0 = clamp(ne0, 0, p0.energyMax); e1 = clamp(ne1, 0, p1.energyMax);
    z0 = nz0; z1 = nz1;

    c0 = nc0; c1 = nc1;
    if (c1 > c0) { f0 = 1; f1 = -1; } else if (c1 < c0) { f0 = -1; f1 = 1; }

    if (l0 <= 0 || l1 <= 0) {
      outcome = l0 <= 0 && l1 <= 0 ? 2 : l0 <= 0 ? 1 : 0;
      break;
    }
  }
  return { life: [l0, l1], energy: [e0, e1], outcome, pos: [r0, c0, r1, c1] };
}
