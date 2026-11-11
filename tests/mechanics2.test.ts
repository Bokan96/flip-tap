import { describe, expect, it } from 'vitest';
import { CARDS, FIGHTERS } from '../src/content/cards';
import { planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';

const IDLE: Plan = ['guard', 'focus', 'up'];

function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = [], bonusB: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB });
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  return s;
}

describe('traps', () => {
  it('a trap set this step springs on the enemy who ends a later step on it, then is gone', () => {
    // Briar's Snare traps the square in front: (1,2). Marin steps onto it in step 2.
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['briarSnare', 'guard', 'focus'], ['guard', 'left', 'focus']]);
    expect(r.steps[0].traps).toEqual([{ at: 1 * 4 + 2, owner: 0, damage: 15 + 10, until: 2 }]);
    expect(r.steps[1].players[1].trapDamage).toBe(25); // Deep Roots: +10
    expect(r.steps[1].traps).toEqual([]);
    expect(r.steps[2].players[1].trapDamage).toBe(0);
  });

  it('does not hurt its owner, and a trap set under an enemy springs at the end of the next step', () => {
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['briarSnare', 'right', 'guard'], ['guard', 'focus', 'down']]);
    expect(r.steps[0].players[1].trapDamage).toBe(0); // set at the end of step 1
    expect(r.steps[1].players[0].trapDamage).toBe(0); // Briar steps onto its own trap: safe
    expect(r.steps[1].players[1].trapDamage).toBe(25); // Marin still standing there
  });

  it('lasts until the end of the next round', () => {
    const s = duel('briar', 'marin', { r: 1, c: 0 }, { r: 0, c: 3 });
    let r = resolveRound(s, [['briarSnare', 'guard', 'focus'], IDLE]);
    expect(r.state.arena.traps).toHaveLength(1);
    r = resolveRound(r.state, [IDLE, ['guard', 'focus', 'down']]);
    expect(r.state.arena.traps).toHaveLength(0);
  });
});

describe('burn', () => {
  it('a damaging hit burns the target on each later step this round', () => {
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['vexHex', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    const marin = r.steps.map((st) => st.players[1]);
    expect(marin[0].burnDamage).toBe(0);
    expect(marin[0].burning).toBe(15); // Hex Bolt 10 + Fever 5
    expect(marin[1].burnDamage).toBe(15);
    expect(marin[2].burnDamage).toBe(15);
    expect(r.state.players[1].burn).toBe(0); // gone at the end of the round
    expect(r.state.players[1].life).toBe(100 - 20 - 15 - 15);
  });

  it('needs the hit to deal damage, and burns do not stack', () => {
    const s = duel('marin', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 }, ['bulwark']);
    let r = resolveRound(s, [['bulwark', 'guard', 'focus'], ['vexHex', 'guard', 'focus']]);
    expect(r.steps[0].players[0].burning).toBe(0);
    const t = duel('marin', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 });
    r = resolveRound(t, [['focus', 'guard', 'up'], ['vexHex', 'vexSmolder', 'focus']]);
    expect(r.steps[1].players[0].burning).toBe(15); // the stronger burn stays
  });
});

describe('swap', () => {
  it('trades places after movement', () => {
    const s = duel('vex', 'marin', { r: 0, c: 0 }, { r: 2, c: 3 });
    const r = resolveRound(s, [['vexSwap', 'guard', 'focus'], ['left', 'guard', 'focus']]);
    const [v, m] = r.steps[0].players;
    expect(v.swapped).toBe(true);
    expect(v.final).toEqual({ r: 2, c: 2 });
    expect(m.final).toEqual({ r: 0, c: 0 });
    expect(v.facing).toBe(-1);
  });

  it('cannot move an immovable rival, and two swaps trade once', () => {
    let s = duel('vex', 'basalt', { r: 1, c: 0 }, { r: 1, c: 3 });
    let r = resolveRound(s, [['vexSwap', 'guard', 'focus'], IDLE]);
    expect(r.steps[0].players[0].swapped).toBe(false);
    s = duel('vex', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 }, [], ['phaseStep']);
    r = resolveRound(s, [['vexSwap', 'guard', 'focus'], ['phaseStep', 'guard', 'focus']]);
    expect(r.steps[0].players[0].final).toEqual({ r: 1, c: 3 });
  });
});

describe('new content', () => {
  it('cards with the new effects are well formed', () => {
    for (const c of Object.values(CARDS)) {
      if (c.burn) expect(c.kind).toBe('attack');
      if (c.trap) expect(c.kind).toBe('trap');
      if (c.kind === 'trap') expect(c.pattern).toHaveLength(3);
      if (c.swap) expect(c.kind).toBe('move');
    }
    expect(FIGHTERS.map((f) => f.id)).toEqual(expect.arrayContaining(['briar', 'vex']));
    const s = duel('briar', 'vex', { r: 1, c: 0 }, { r: 1, c: 3 });
    expect(planError(s.players[0], ['briarSnare', 'briarLash', 'guard'])).toBeNull();
  });
});
