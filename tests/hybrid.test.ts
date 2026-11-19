import { describe, expect, it } from 'vitest';
import { fastSimulate } from '../src/engine/fastsim';
import { planError, resolveRound, threatArea } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';
import { cleanCard } from '../src/meta/custom';
import { cardHtml } from '../src/ui/card';

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

/** The real rules and the AI's fast copy agree on a round. */
function agrees(s: MatchState, plans: [Plan, Plan]): void {
  const real = resolveRound(s, plans);
  const fast = fastSimulate(s, plans[0], plans[1]);
  const last = real.steps[real.steps.length - 1].players;
  expect(fast.life).toEqual([real.state.players[0].life, real.state.players[1].life]);
  expect(fast.pos).toEqual([last[0].final.r, last[0].final.c, last[1].final.r, last[1].final.c]);
}

describe('lunge (move, then attack)', () => {
  it('steps with the moves, turns to face the opponent, then strikes from the new square', () => {
    // Charge: a step forward, then the square it lands on and the one in front.
    const s = duel('volta', 'marin', { r: 1, c: 0 }, { r: 1, c: 2 }, ['charge']);
    const plans: [Plan, Plan] = [['charge', 'guard', 'focus'], ['focus', 'guard', 'up']];
    const step = resolveRound(s, plans).steps[0];
    expect(step.players[0].to).toEqual({ r: 1, c: 1 });
    expect(step.players[0].moved).toBe(true);
    expect(step.players[1].damageTaken).toBe(20);
    agrees(s, plans);
  });

  it('turns before it strikes', () => {
    // Facing the wrong way (as after the opponent leapt past): forward takes Volta further away,
    // then the lunge turns them back toward Marin.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 }, ['charge']);
    s.players[0].facing = -1;
    const step = resolveRound(s, [['charge', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0];
    expect(step.players[0].to).toEqual({ r: 1, c: 0 });
    expect(step.players[0].facing).toBe(1);
  });

  it('rooted: the step doesn’t happen, the strike still does (from where they stand)', () => {
    const s = duel('volta', 'marin', { r: 1, c: 0 }, { r: 1, c: 1 }, ['charge']);
    s.players[0].rooted = true;
    const plans: [Plan, Plan] = [['charge', 'guard', 'focus'], ['focus', 'guard', 'up']];
    const step = resolveRound(s, plans).steps[0];
    expect(step.players[0].rootBlocked).toBe(true);
    expect(step.players[0].to).toEqual({ r: 1, c: 0 });
    expect(step.players[1].damageTaken).toBe(20);
    agrees(s, plans);
  });
});

describe('hit-and-run (attack, then move)', () => {
  it('strikes from where it stands, then steps back', () => {
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['hitAndRun']);
    const plans: [Plan, Plan] = [['hitAndRun', 'guard', 'focus'], ['focus', 'guard', 'up']];
    const p = resolveRound(s, plans).steps[0].players;
    expect(p[1].damageTaken).toBe(15);
    expect(p[0].afterPush).toEqual({ r: 1, c: 1 });
    expect(p[0].final).toEqual({ r: 1, c: 0 });
    expect(p[0].moved).toBe(false); // the step after the hit doesn't count as moving for this step's hits
    agrees(s, plans);
  });

  it('steps after a push, from where the push left them', () => {
    // Ferro's Shockwave pushes Volta back a square; then Volta's step back takes another.
    // (Not Marin: her Riptide pushes a square further.)
    const s = duel('volta', 'ferro', { r: 1, c: 2 }, { r: 1, c: 3 }, ['hitAndRun'], ['shockwave']);
    const plans: [Plan, Plan] = [['hitAndRun', 'guard', 'focus'], ['shockwave', 'guard', 'focus']];
    const p = resolveRound(s, plans).steps[0].players;
    expect(p[0].afterPush).toEqual({ r: 1, c: 1 });
    expect(p[0].final).toEqual({ r: 1, c: 0 });
    agrees(s, plans);
  });

  it('traps spring where the step ends', () => {
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['hitAndRun']);
    s.arena.traps.push({ at: 1 * s.arena.cols + 0, owner: 1, damage: 15, until: s.round + 1 });
    const plans: [Plan, Plan] = [['hitAndRun', 'guard', 'focus'], ['focus', 'guard', 'up']];
    const p = resolveRound(s, plans).steps[0].players;
    expect(p[0].final).toEqual({ r: 1, c: 0 });
    expect(p[0].trapDamage).toBe(15);
    agrees(s, plans);
  });

  it('a fighter knocked out first doesn’t step', () => {
    // Splash (25) beats Hit and Run (15) and knocks Volta out before the step.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['hitAndRun']);
    s.players[0].life = 10;
    const p = resolveRound(s, [['hitAndRun', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]).steps[0].players;
    expect(p[0].interrupted).toBe(true);
    expect(p[0].final).toEqual({ r: 1, c: 1 });
  });

  it('rooted, even by this step’s hit: no step', () => {
    // Entangle and Hit and Run land at the same time; the root stops the step that follows.
    const s = duel('volta', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 }, ['hitAndRun'], ['entangle']);
    const plans: [Plan, Plan] = [['hitAndRun', 'guard', 'focus'], ['entangle', 'guard', 'focus']];
    const p = resolveRound(s, plans).steps[0].players;
    expect(p[0].rootApplied).toBe(true);
    expect(p[0].rootBlocked).toBe(true);
    expect(p[0].final).toEqual({ r: 1, c: 1 });
    agrees(s, plans);
  });
});

describe('cards that move', () => {
  it('count as a move for planted attacks', () => {
    const s = duel('basalt', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 }, ['charge', 'hitAndRun']);
    const basalt = s.players[0];
    expect(planError(basalt, ['charge', 'basaltCrush', 'guard'])).not.toBeNull();
    expect(planError(basalt, ['hitAndRun', 'basaltCrush', 'guard'])).not.toBeNull();
    expect(planError(basalt, ['basaltCrush', 'charge', 'guard'])).toBeNull();
  });

  it('a lunge’s reach counts from where it lands (enemy reach)', () => {
    const s = duel('marin', 'volta', { r: 1, c: 0 }, { r: 1, c: 4 }, [], ['charge']);
    const { now } = threatArea(s, 1);
    // Charge lands on (1,3) and hits there and (1,2).
    expect(now.some((q) => q.r === 1 && q.c === 2)).toBe(true);
  });

  it('custom attacks can move, but then can’t be planted', () => {
    const c = cleanCard({ id: 'cc-dash', name: 'Dash', kind: 'attack', cost: -20, damage: 20, pattern: ['000', '011', '000'], step: [0, -1], forward: true, stepAfter: true, planted: true });
    expect(c).toMatchObject({ step: [0, -1], forward: true, stepAfter: true });
    expect(c?.planted).toBeUndefined();
    const still = cleanCard({ id: 'cc-jab', name: 'Jab', kind: 'attack', cost: -15, damage: 20, pattern: ['000', '011', '000'], planted: true });
    expect(still?.planted).toBe(true);
    expect(still?.step).toBeUndefined();
  });

  it('show the whole move on the card: start, step and hit squares', () => {
    const html = cardHtml('charge');
    expect(html).toContain('mini-grid hybrid');
    expect(html).toContain('class="me"');
    // The square Charge steps to is also hit.
    expect(html).toContain('class="move on"');
  });
});
