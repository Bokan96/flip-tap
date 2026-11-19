import { describe, expect, it } from 'vitest';
import { resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Pos } from '../src/engine/types';
import { cleanCard } from '../src/meta/custom';

/** The 3×5 Classic board with both fighters placed facing each other, at full energy. */
function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = [], bonusB: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB }, {}, 'classic');
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  for (const p of s.players) p.energy = p.energyMax;
  return s;
}

describe('a fighter knocked out by a step’s hits stays out', () => {
  it('Rekindle doesn’t heal Cinder back from 0', () => {
    // Cinder at 10 life heals 20 (he is at 50 or less) while Marin’s Splash hits for 25.
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 10;
    const r = resolveRound(s, [['cinderRekindle', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]);
    const cinder = r.steps[0].players[0];
    expect(cinder.healed).toBe(0);
    expect(cinder.life).toBe(0);
    expect(r.state.outcome).toEqual({ winner: 1 });
  });

  it('a heal still works when the fighter survives the hits', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 30;
    const r = resolveRound(s, [['cinderRekindle', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]);
    expect(r.steps[0].players[0].healed).toBe(20);
    expect(r.steps[0].players[0].life).toBe(30 - 25 + 20);
  });

  it('a drain doesn’t save an attacker a counter knocks out', () => {
    // Leech (20, drains 100%) into Riposte (guard 10, counter 20): 10 gets through, 20 comes back.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['leech'], ['riposte']);
    s.players[0].life = 15;
    const r = resolveRound(s, [['leech', 'guard', 'focus'], ['riposte', 'guard', 'focus']]);
    const volta = r.steps[0].players[0];
    expect(volta.counterTaken).toBe(20);
    expect(volta.drained).toBe(0);
    expect(volta.life).toBe(0);
    expect(r.state.outcome).toEqual({ winner: 1 });
  });
});

describe('root', () => {
  it('a damaging hit stops the target’s moves for the rest of the round, then wears off', () => {
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['entangle']);
    const r = resolveRound(s, [['entangle', 'guard', 'focus'], ['focus', 'right', 'up']]);
    const [hit, second, third] = r.steps.map((st) => st.players[1]);
    expect(hit.rootApplied).toBe(true);
    expect(second.rootBlocked).toBe(true);
    expect(second.final).toEqual({ r: 1, c: 2 });
    expect(third.rootBlocked).toBe(true);
    expect(third.final).toEqual({ r: 1, c: 2 });
    // Worn off: next round Marin moves again.
    expect(r.state.players[1].rooted).toBe(false);
    const r2 = resolveRound(r.state, [['guard', 'focus', 'up'], ['up', 'guard', 'focus']]);
    expect(r2.steps[0].players[1].rootBlocked).toBe(false);
    expect(r2.steps[0].players[1].final).toEqual({ r: 0, c: 2 });
  });

  it('needs the hit to deal damage', () => {
    // Entangle's 15 into Guard's 15: nothing gets through, so no root.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['entangle']);
    const r = resolveRound(s, [['entangle', 'guard', 'focus'], ['guard', 'right', 'up']]);
    expect(r.steps[0].players[1].rootApplied).toBe(false);
    expect(r.steps[1].players[1].final).toEqual({ r: 1, c: 3 });
  });

  it('a rooted fighter can still be pushed, and swapped by the other side, but can’t swap', () => {
    // Pushed: Entangle roots Marin, then Shockwave (push 1) still moves her a square back.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['entangle', 'shockwave']);
    const pushed = resolveRound(s, [['entangle', 'shockwave', 'guard'], ['focus', 'guard', 'left']]);
    expect(pushed.steps[1].players[1].final).toEqual({ r: 1, c: 3 });
    expect(pushed.steps[2].players[1].rootBlocked).toBe(true);

    // Swapped by the other side: Volta’s Phase Step still trades places with rooted Vex.
    const t = duel('volta', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 }, ['entangle', 'phaseStep']);
    const swapped = resolveRound(t, [['entangle', 'phaseStep', 'guard'], ['focus', 'guard', 'vexSwap']]);
    expect(swapped.steps[1].players[1].final).toEqual({ r: 1, c: 1 });
    // Rooted Vex’s own Mirror Step does nothing.
    const third = swapped.steps[2].players[1];
    expect(third.rootBlocked).toBe(true);
    expect(third.swapped).toBe(false);
    expect(third.final).toEqual({ r: 1, c: 1 });
  });

  it('custom attack cards can have it, other kinds can’t', () => {
    const atk = cleanCard({ id: 'cc-vine', name: 'Vine', kind: 'attack', cost: -15, damage: 15, pattern: ['000', '011', '000'], root: true });
    expect(atk?.root).toBe(true);
    const guard = cleanCard({ id: 'cc-g', name: 'G', kind: 'guard', cost: 0, guard: 15, root: true });
    expect(guard?.root).toBeUndefined();
  });
});
