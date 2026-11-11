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
  reload: boolean;
  burn: number;
  /** Trap card: damage of each trap it sets (0 otherwise). */
  trap: number;
  swap: boolean;
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
    if ((isAttack || c.kind === 'trap') && c.pattern) {
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
      reload: c.kind === 'reload',
      burn: isAttack ? (c.burn ?? 0) : 0,
      trap: c.kind === 'trap' ? (c.trap ?? 0) : 0,
      swap: !!c.swap,
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
  /** Final facing (1 = right, -1 = left). */
  facing: [number, number];
  /** Ammo fighters: how many attacks are spent at the end of the round (-1 for everyone else). */
  spent: [number, number];
  /** Traps still on the board for the next round, flattened as [square, owner, damage, ...]. */
  traps: number[];
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

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Same as rules.hitDamage. */
function damageOf(card: FastCard, attackerLife: number, am: Mods, dm: Mods, guard: number, moved: boolean): number {
  let d = card.damage + am.damageBonus;
  if (am.lowLifeThreshold > 0 && attackerLife <= am.lowLifeThreshold) d += am.lowLifeBonus;
  if (moved) d += am.vsMovedBonus - dm.movedReduction;
  d -= guard + dm.damageReduction;
  return d > 0 ? d : 0;
}


/**
 * Simulate one round. Same semantics as rules.resolveRound, including fatigue, but without the
 * end-of-round energy recovery.
 */
export function fastSimulate(state: MatchState, plan0: Plan, plan1: Plan): FastResult {
  const A = state.arena;
  const rows = A.rows;
  const cols = A.cols;
  const blocked = A.blocked;
  const tiles = A.tiles;
  /** Same as rules.isOpen. */
  const open = (rr: number, cc: number) =>
    rr >= 0 && rr < rows && cc >= 0 && cc < cols && (blocked.length === 0 || !blocked.includes(rr * cols + cc));
  /** Same as rules.displace (columns only, stops at edges and blocked squares). */
  const displaceCol = (tr: number, tc: number, ac: number, attackerFacing: number, n: number) => {
    const dir = n > 0 ? (tc === ac ? attackerFacing : Math.sign(tc - ac)) : Math.sign(ac - tc);
    let steps = n > 0 ? n : Math.min(-n, Math.abs(ac - tc));
    let cc = tc;
    while (steps-- > 0 && open(tr, cc + dir)) cc += dir;
    return cc;
  };
  const P = state.players;
  const m = [P[0].mods, P[1].mods];
  const lifeMax = [P[0].lifeMax, P[1].lifeMax];
  const energyMax = [P[0].energyMax, P[1].energyMax];
  const life = [P[0].life, P[1].life];
  const en = [P[0].energy, P[1].energy];
  const r = [P[0].pos.r, P[1].pos.r];
  const c = [P[0].pos.c, P[1].pos.c];
  const f = [P[0].facing as number, P[1].facing as number];
  const z = [P[0].dazed, P[1].dazed];
  // Spent attacks, tracked only for ammo fighters (null otherwise).
  const spent: (string[] | null)[] = [m[0].ammo ? [...P[0].spent] : null, m[1].ammo ? [...P[1].spent] : null];
  const ids = ['', ''];
  // Traps on the board (copied: they fire and get placed during the round). `keep` = still there next round.
  const traps = A.traps.map((t) => ({ at: t.at, owner: t.owner as number, damage: t.damage, keep: t.until > state.round }));
  const burn = [P[0].burn, P[1].burn];
  const burnNow = [0, 0];
  const burnHit = [0, 0];
  const sr = [0, 0];
  const sc = [0, 0];
  const card: FastCard[] = [fastCard(plan0[0]), fastCard(plan1[0])];
  const act = [false, false];
  const mv = [false, false];
  const nz = [false, false];
  const dmg = [0, 0];
  const ctr = [0, 0];
  const drn = [0, 0];
  const nc = [0, 0];
  let outcome = -1;

  const face = () => {
    if (c[1] > c[0]) {
      f[0] = 1;
      f[1] = -1;
    } else if (c[1] < c[0]) {
      f[0] = -1;
      f[1] = 1;
    }
  };

  for (let slot = 0; slot < plan0.length; slot++) {
    ids[0] = plan0[slot];
    ids[1] = plan1[slot];
    card[0] = fastCard(ids[0]);
    card[1] = fastCard(ids[1]);
    for (let i = 0; i < 2; i++) {
      const sp = spent[i];
      act[i] = !z[i] && en[i] + card[i].cost >= 0 && !(sp !== null && card[i].isAttack && sp.includes(ids[i]));
      nz[i] = false;
      burnNow[i] = burn[i];
      burnHit[i] = 0;
      sr[i] = r[i];
      sc[i] = c[i];
      if (act[i] && (card[i].dr || card[i].dc)) {
        const nr = clamp(r[i] + card[i].dr, 0, rows - 1);
        const ncc = clamp(c[i] + card[i].dc, 0, cols - 1);
        if (open(nr, ncc)) {
          r[i] = nr;
          c[i] = ncc;
        }
      }
    }
    // Swap (same as rules.resolveStep).
    const sw0 = act[0] && card[0].swap;
    const sw1 = act[1] && card[1].swap;
    if ((sw0 || sw1) && (sw0 || !m[0].immovable) && (sw1 || !m[1].immovable)) {
      const tr = r[0];
      const tc = c[0];
      r[0] = r[1];
      c[0] = c[1];
      r[1] = tr;
      c[1] = tc;
    }
    for (let i = 0; i < 2; i++) mv[i] = r[i] !== sr[i] || c[i] !== sc[i];
    face();

    // Both attack: the stronger card (then the healthier fighter) strikes first.
    let first = -1;
    if (act[0] && act[1] && card[0].isAttack && card[1].isAttack) {
      if (card[0].damage !== card[1].damage) first = card[0].damage > card[1].damage ? 0 : 1;
      else if (life[0] !== life[1]) first = life[0] > life[1] ? 0 : 1;
    }

    if (first >= 0) {
      for (let k = 0; k < 2; k++) {
        const o = k === 0 ? first : 1 - first;
        const i = 1 - o;
        if (life[o] <= 0) continue;
        const a = card[o];
        if (!covers(a, r[o], c[o], f[o], r[i], c[i])) continue;
        const d = damageOf(a, life[o], m[o], m[i], 0, mv[i]);
        life[i] = clamp(life[i] - d, 0, lifeMax[i]);
        if (a.drain && d > 0) life[o] = clamp(life[o] + Math.floor((d * a.drain) / 100), 0, lifeMax[o]);
        if (a.stun && d > 0) nz[i] = true;
        if (a.burn && d > 0) burnHit[i] = a.burn + m[o].burnBonus;
        if (a.push && !m[i].immovable) {
          c[i] = displaceCol(r[i], c[i], c[o], f[o], a.push + Math.sign(a.push) * m[o].pushBonus);
          face();
        }
      }
      for (let i = 0; i < 2; i++) {
        if (!act[i]) continue;
        life[i] = clamp(life[i] + card[i].heal, 0, lifeMax[i]);
        en[i] = clamp(en[i] + card[i].cost, 0, energyMax[i]);
      }
    } else {
      for (let i = 0; i < 2; i++) {
        dmg[i] = ctr[i] = drn[i] = 0;
        nc[i] = c[i];
      }
      for (let i = 0; i < 2; i++) {
        const o = 1 - i;
        const a = card[o];
        if (!act[o] || !a.isAttack || !covers(a, r[o], c[o], f[o], r[i], c[i])) continue;
        dmg[i] = damageOf(a, life[o], m[o], m[i], act[i] ? card[i].guard : 0, mv[i]);
        if (act[i] && card[i].counter) ctr[o] += card[i].counter;
        if (a.drain && dmg[i] > 0) drn[o] = Math.floor((dmg[i] * a.drain) / 100);
        if (a.stun && dmg[i] > 0) nz[i] = true;
        if (a.burn && dmg[i] > 0) burnHit[i] = a.burn + m[o].burnBonus;
        if (a.push && !m[i].immovable) nc[i] = displaceCol(r[i], c[i], c[o], f[o], a.push + Math.sign(a.push) * m[o].pushBonus);
      }
      for (let i = 0; i < 2; i++) {
        let l = life[i] - dmg[i] - ctr[i] + drn[i];
        let e = en[i];
        if (act[i]) {
          l += card[i].heal;
          e += card[i].cost;
        }
        life[i] = clamp(l, 0, lifeMax[i]);
        en[i] = clamp(e, 0, energyMax[i]);
      }
      c[0] = nc[0];
      c[1] = nc[1];
      face();
    }
    // Square effects (same as rules.resolveStep).
    for (let i = 0; i < 2; i++) {
      const t = tiles[r[i] * cols + c[i]];
      if (t === 'spikes') life[i] = clamp(life[i] - BALANCE.tiles.spikes, 0, lifeMax[i]);
      else if (t === 'well') en[i] = clamp(en[i] + BALANCE.tiles.well, 0, energyMax[i]);
    }
    // Enemy traps, then running burns, then new traps (same order as rules.resolveStep).
    if (traps.length) {
      for (let i = 0; i < 2; i++) {
        const at = r[i] * cols + c[i];
        let hurt = 0;
        for (let k = traps.length - 1; k >= 0; k--) {
          if (traps[k].at === at && traps[k].owner !== i) {
            hurt += traps[k].damage;
            traps.splice(k, 1);
          }
        }
        if (hurt) life[i] = clamp(life[i] - hurt, 0, lifeMax[i]);
      }
    }
    for (let i = 0; i < 2; i++) {
      if (burnNow[i] > 0) life[i] = clamp(life[i] - burnNow[i], 0, lifeMax[i]);
      if (burnHit[i] > burn[i]) burn[i] = burnHit[i];
    }
    for (let i = 0; i < 2; i++) {
      const tc = card[i];
      if (!act[i] || !tc.trap) continue;
      const cells = tc.cells;
      for (let k = 0; k < cells.length; k += 2) {
        const tr = r[i] + cells[k];
        const tcc = c[i] + cells[k + 1] * f[i];
        if (!open(tr, tcc)) continue;
        const at = tr * cols + tcc;
        for (let q = traps.length - 1; q >= 0; q--) if (traps[q].at === at && traps[q].owner === i) traps.splice(q, 1);
        traps.push({ at, owner: i, damage: tc.trap + m[i].trapBonus, keep: true });
      }
    }
    z[0] = nz[0];
    z[1] = nz[1];
    for (let i = 0; i < 2; i++) {
      const sp = spent[i];
      if (!act[i]) continue;
      if (card[i].reload) {
        if (sp) sp.length = 0;
      } else if (sp && card[i].isAttack && !sp.includes(ids[i])) sp.push(ids[i]);
    }

    if (life[0] <= 0 || life[1] <= 0) {
      outcome = life[0] <= 0 && life[1] <= 0 ? 2 : life[0] <= 0 ? 1 : 0;
      break;
    }
  }
  // Fatigue at the end of late rounds (same as rules.resolveRound).
  if (outcome === -1 && state.round > BALANCE.fatigueAfterRound) {
    life[0] = Math.max(0, life[0] - BALANCE.fatigueDamage);
    life[1] = Math.max(0, life[1] - BALANCE.fatigueDamage);
    if (life[0] <= 0 || life[1] <= 0) outcome = life[0] <= 0 && life[1] <= 0 ? 2 : life[0] <= 0 ? 1 : 0;
  }
  const left: number[] = [];
  for (const t of traps) if (t.keep) left.push(t.at, t.owner, t.damage);
  return {
    life: [life[0], life[1]],
    energy: [en[0], en[1]],
    outcome,
    pos: [r[0], c[0], r[1], c[1]],
    facing: [f[0], f[1]],
    spent: [spent[0] ? spent[0].length : -1, spent[1] ? spent[1].length : -1],
    traps: left,
  };
}
