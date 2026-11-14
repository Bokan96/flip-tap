import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { CARDS, FIGHTERS } from '../src/content/cards';
import { enumeratePlans } from '../src/engine/ai';
import { canPlace, planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';

const IDLE: Plan = ['guard', 'focus', 'up'];

/** A match on the 3×4 board (Close Quarters): these tests were written for its edges. */
function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = [], bonusB: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB }, {}, 'quarters');
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  // Full energy, so the plans under test are affordable (a match itself starts at BALANCE.energyStart).
  for (const p of s.players) p.energy = p.energyMax;
  return s;
}

const snare = CARDS.briarSnare.trap! + 10; // Deep Roots: +10

describe('traps', () => {
  it('a trap set this step springs on the enemy who ends a later step on it, then is gone', () => {
    // Briar's Snare traps the square in front: (1,2). Marin steps onto it in step 2.
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['briarSnare', 'guard', 'focus'], ['guard', 'left', 'focus']]);
    expect(r.steps[0].traps).toEqual([{ at: 1 * 4 + 2, owner: 0, damage: snare, until: 2 }]);
    expect(r.steps[1].players[1].trapDamage).toBe(snare);
    expect(r.steps[1].traps).toEqual([]);
    expect(r.steps[2].players[1].trapDamage).toBe(0);
  });

  it('does not hurt its owner, and a trap set under an enemy springs at the end of the next step', () => {
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['briarSnare', 'right', 'guard'], ['guard', 'focus', 'down']]);
    expect(r.steps[0].players[1].trapDamage).toBe(0); // set at the end of step 1
    expect(r.steps[1].players[0].trapDamage).toBe(0); // Briar steps onto its own trap: safe
    expect(r.steps[1].players[1].trapDamage).toBe(snare); // Marin still standing there
  });

  it('lasts until the end of the next round', () => {
    const s = duel('briar', 'marin', { r: 1, c: 0 }, { r: 0, c: 3 });
    let r = resolveRound(s, [['briarSnare', 'guard', 'focus'], IDLE]);
    expect(r.state.arena.traps).toHaveLength(1);
    r = resolveRound(r.state, [IDLE, ['guard', 'focus', 'down']]);
    expect(r.state.arena.traps).toHaveLength(0);
  });

  it('an enemy attack covering a trap breaks it before it can spring', () => {
    // A trap under Marin; Marin's Splash covers his own square, so it breaks and never springs.
    const s = duel('briar', 'marin', { r: 1, c: 0 }, { r: 1, c: 2 });
    s.arena.traps = [{ at: 1 * 4 + 2, owner: 0, damage: 25, until: 2 }];
    const r = resolveRound(s, [['guard', 'focus', 'up'], ['marinSplash', 'guard', 'focus']]);
    expect(r.steps[0].brokenTraps).toEqual([1 * 4 + 2]);
    expect(r.steps[0].players[1].trapDamage).toBe(0);
    expect(r.state.arena.traps).toEqual([]);
  });

  it('your own attacks leave your traps alone', () => {
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 0, c: 3 });
    s.arena.traps = [{ at: 1 * 4 + 2, owner: 0, damage: 25, until: 2 }];
    const r = resolveRound(s, [['briarBloom', 'guard', 'focus'], IDLE]);
    expect(r.steps[0].brokenTraps).toEqual([]);
    expect(r.state.arena.traps).toHaveLength(1);
  });
});

describe('hex (Vex)', () => {
  it('a damaging hit hexes; the next enemy hit deals the bonus and breaks it', () => {
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    // Marin steps down in step 2, still inside Flare's squares.
    const r = resolveRound(s, [['vexHex', 'vexFlare', 'guard'], ['focus', 'down', 'up']]);
    const marin = r.steps.map((st) => st.players[1]);
    expect(marin[0].hexApplied).toBe(true);
    expect(marin[0].hexed).toBe(true);
    expect(marin[0].damageTaken).toBe(CARDS.vexHex.damage);
    // Flare cashes it in: +10 for the hex, +10 for Malice.
    expect(marin[1].hexBroken).toBe(true);
    expect(marin[1].hexed).toBe(false);
    expect(marin[1].damageTaken).toBe(CARDS.vexFlare.damage! + BALANCE.hexDamage + 10);
  });

  it('lasts across rounds until a hit lands, and a hexing hit on a hexed target only breaks it', () => {
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    let r = resolveRound(s, [['vexHex', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    expect(r.state.players[1].hexed).toBe(true);
    r = resolveRound(r.state, [['guard', 'focus', 'up'], ['guard', 'focus', 'down']]);
    expect(r.state.players[1].hexed).toBe(true);
    const t = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    t.players[1].hexed = true;
    const u = resolveRound(t, [['vexHex', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    expect(u.steps[0].players[1].hexBroken).toBe(true);
    expect(u.steps[0].players[1].hexApplied).toBe(false);
    expect(u.state.players[1].hexed).toBe(false);
  });

  it('needs damage to hex, but any connecting hit breaks it', () => {
    const s = duel('marin', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 }, ['bulwark']);
    let r = resolveRound(s, [['bulwark', 'guard', 'focus'], ['vexHex', 'guard', 'focus']]);
    expect(r.steps[0].players[0].hexed).toBe(false);
    const t = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    t.players[0].hexed = true;
    r = resolveRound(t, [['guard', 'focus', 'up'], ['marinSplash', 'guard', 'focus']]);
    expect(r.steps[0].players[0].hexBroken).toBe(true);
    expect(r.steps[0].players[0].damageTaken).toBe(CARDS.marinSplash.damage! + BALANCE.hexDamage - CARDS.guard.guard!);
  });
});

describe('recoil and Rekindle (Cinder)', () => {
  it('recoil hurts on a hit or a miss', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 0 }, { r: 0, c: 3 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], IDLE]);
    expect(r.steps[0].players[1].hit).toBe('miss');
    expect(r.steps[0].players[0].recoilTaken).toBe(CARDS.cinderJab.recoil);
    expect(r.steps[0].players[0].life).toBe(100 - CARDS.cinderJab.recoil!);
  });

  it('can knock Cinder out, and a double knockout is a draw', () => {
    let s = duel('cinder', 'marin', { r: 1, c: 0 }, { r: 0, c: 3 });
    s.players[0].life = 5;
    expect(resolveRound(s, [['cinderJab', 'guard', 'focus'], IDLE]).state.outcome).toEqual({ winner: 1 });
    s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 5;
    s.players[1].life = 20;
    expect(resolveRound(s, [['cinderJab', 'guard', 'focus'], ['focus', 'guard', 'up']]).state.outcome).toEqual({ winner: null, draw: true });
  });

  it('Rekindle only heals at 50 life or less (after this step’s hits)', () => {
    const heal = CARDS.cinderRekindle.heal!;
    let s = duel('cinder', 'marin', { r: 1, c: 0 }, { r: 0, c: 3 });
    s.players[0].life = 60;
    let r = resolveRound(s, [['cinderRekindle', 'guard', 'focus'], IDLE]);
    expect(r.steps[0].players[0].healed).toBe(0);
    expect(r.steps[0].players[0].energy).toBe(100 + CARDS.cinderRekindle.cost);
    s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 60;
    r = resolveRound(s, [['cinderRekindle', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]);
    expect(r.steps[0].players[0].healed).toBe(heal);
    expect(r.steps[0].players[0].life).toBe(60 - CARDS.marinSplash.damage! + heal);
  });
});

describe('sap (Volta)', () => {
  it('drains energy on a hit, even a guarded one, and can leave a later card unpaid', () => {
    const s = duel('volta', 'cinder', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[1].energy = 50;
    // Cinder guards (Short Circuit's 10 damage is fully blocked) but still loses energy; Wildfire then fizzles.
    const r = resolveRound(s, [['voltaCircuit', 'guard', 'focus'], ['guard', 'cinderBlaze', 'up']]);
    const c = r.steps.map((st) => st.players[1]);
    expect(c[0].hit).toBe('guard');
    expect(c[0].damageTaken).toBe(0);
    expect(c[0].energyLost).toBe(CARDS.voltaCircuit.sap);
    expect(c[0].energy).toBe(50 - CARDS.voltaCircuit.sap!);
    expect(c[1].active).toBe(false);
  });
});

describe('ambush cards (Umbra)', () => {
  it('Pounce deals its bonus only to a target that moved', () => {
    const s = duel('umbra', 'marin', { r: 1, c: 1 }, { r: 0, c: 3 });
    const r = resolveRound(s, [['umbraPounce', 'guard', 'focus'], ['left', 'guard', 'focus']]);
    // Damage + card bonus + Ambush.
    expect(r.steps[0].players[1].damageTaken).toBe(CARDS.umbraPounce.damage! + CARDS.umbraPounce.vsMoved! + 5);
    const t = duel('umbra', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const u = resolveRound(t, [['umbraPounce', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    expect(u.steps[0].players[1].damageTaken).toBe(CARDS.umbraPounce.damage);
  });
});

describe('planted attacks (Basalt)', () => {
  it('can’t be planned after a move card in the same round', () => {
    const s = duel('basalt', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const b = s.players[0];
    expect(planError(b, ['basaltCrush', 'up', 'guard'])).toBeNull();
    expect(planError(b, ['up', 'basaltCrush', 'guard'])).toMatch(/move/);
    expect(planError(b, ['up', 'guard', 'basaltQuake'])).toMatch(/move/);
    expect(canPlace(b, ['up', '', ''], 1, 'basaltCrush')).toBe(false);
    expect(canPlace(b, ['', 'basaltCrush', ''], 0, 'up')).toBe(false);
    for (const plan of enumeratePlans(b)) expect(planError(b, plan)).toBeNull();
  });
});

describe('forward dashes (Zephyr)', () => {
  it('move toward the opponent and counter an attack that hits', () => {
    // Zephyr on the right dashes left into Cinder's Jab: Slipstream −10, counter back.
    const s = duel('cinder', 'zephyr', { r: 1, c: 0 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['zephyrDash', 'guard', 'focus']]);
    const [c, z] = r.steps[0].players;
    expect(z.final).toEqual({ r: 1, c: 1 });
    expect(z.damageTaken).toBe(CARDS.cinderJab.damage! - 10);
    expect(c.counterTaken).toBe(CARDS.zephyrDash.counter);
    // Facing right, the same card goes right.
    const t = duel('zephyr', 'cinder', { r: 1, c: 0 }, { r: 1, c: 3 });
    const u = resolveRound(t, [['zephyrLunge', 'guard', 'focus'], IDLE]);
    expect(u.steps[0].players[0].final).toEqual({ r: 1, c: 2 });
  });
});

describe('new content', () => {
  it('cards with the newer effects are well formed', () => {
    for (const c of Object.values(CARDS)) {
      if (c.trap) expect(c.kind).toBe('trap');
      if (c.kind === 'trap') expect(c.pattern).toHaveLength(3);
      if (c.swap) expect(c.kind).toBe('move');
    }
    expect(FIGHTERS.map((f) => f.id)).toEqual(expect.arrayContaining(['briar', 'vex']));
    const s = duel('briar', 'vex', { r: 1, c: 0 }, { r: 1, c: 3 });
    expect(planError(s.players[0], ['briarSnare', 'briarLash', 'guard'])).toBeNull();
  });
});
