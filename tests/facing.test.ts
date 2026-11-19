import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/content/cards';
import { resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Pos } from '../src/engine/types';

/** A match on the 3×5 board with both fighters placed, facing each other, at full energy. */
function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = [], bonusB: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB }, {}, 'classic');
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  for (const p of s.players) p.energy = p.energyMax;
  return s;
}

describe('facing turns only on your own move', () => {
  it('an attacker keeps facing when the enemy leaps past, so the attack whiffs', () => {
    // Cinder faces right at (1,1); Marin leaps from (1,2) over to (1,0) as Ember Jab goes off.
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, [], ['leapLeft']);
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['leapLeft', 'guard', 'focus']]);
    const [cinder, marin] = r.steps[0].players;
    expect(marin.final).toEqual({ r: 1, c: 0 });
    expect(marin.hit).toBe('miss');
    expect(cinder.facing).toBe(1); // still facing the empty side
    expect(marin.facing).toBe(1); // the one who moved turned to face Cinder
  });

  it('a swap leaves the other fighter facing away, so their attack whiffs', () => {
    // Vex swaps places with Cinder; Cinder didn't play a move card, so Ember Jab goes the old way.
    const s = duel('cinder', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 });
    const step = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['vexSwap', 'guard', 'focus']]).steps[0];
    const [cinder, vex] = step.players;
    expect(cinder.final).toEqual({ r: 1, c: 2 });
    expect(vex.final).toEqual({ r: 1, c: 1 });
    expect(cinder.facing).toBe(1);
    expect(vex.hit).toBe('miss');
    expect(vex.facing).toBe(1);
  });

  it('a swapped fighter turns back once they play a move card', () => {
    const s = duel('cinder', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['guard', 'up', 'focus'], ['vexSwap', 'guard', 'focus']]);
    expect(r.steps[0].players[0].facing).toBe(1); // swapped to (1,2), still facing right, away from Vex
    expect(r.steps[1].players[0].final).toEqual({ r: 0, c: 2 });
    expect(r.steps[1].players[0].facing).toBe(-1); // the step up turns Cinder toward Vex's column
  });

  it('the fighters face each other again before the next round', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, [], ['leapLeft']);
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['leapLeft', 'guard', 'focus']]);
    expect(r.steps[2].players[0].facing).toBe(1); // still turned away at the end of the round's steps
    expect(r.state.players.map((p) => p.facing)).toEqual([-1, 1]); // and facing each other after it
  });
});

describe('basic Guard drains energy', () => {
  it('takes 10 energy from an attacker it guards, and nothing on a miss', () => {
    const s = duel('marin', 'cinder', { r: 1, c: 1 }, { r: 1, c: 2 });
    const step = resolveRound(s, [['marinSplash', 'guard', 'focus'], ['guard', 'focus', 'up']]).steps[0];
    const [marin, cinder] = step.players;
    expect(cinder.hit).toBe('guard');
    expect(marin.energyLost).toBe(CARDS.guard.blockSap);
    expect(marin.energy).toBe(100 + CARDS.marinSplash.cost - 10);

    const far = duel('marin', 'cinder', { r: 1, c: 0 }, { r: 1, c: 4 });
    const miss = resolveRound(far, [['marinSplash', 'guard', 'focus'], ['guard', 'focus', 'up']]).steps[0];
    expect(miss.players[1].hit).toBe('miss');
    expect(miss.players[0].energyLost).toBe(0);
  });
});
