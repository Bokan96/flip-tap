import { describe, expect, it } from 'vitest';
import { ARENAS, arenaState } from '../src/content/arenas';
import { BALANCE } from '../src/content/balance';
import { BONUS_CARD_IDS, CARDS, FIGHTERS } from '../src/content/cards';
import { fastSimulate } from '../src/engine/fastsim';
import { runMatch } from '../src/engine/match';
import { enumeratePlans, SIM_PROFILE } from '../src/engine/ai';
import { Rng } from '../src/engine/rng';
import { displace, isOpen, planError, resolveRound } from '../src/engine/rules';
import { createMatch, mergeMods } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';

const IDLE: Plan = ['guard', 'up', 'down'];

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

describe('push and pull', () => {
  it('a push knocks the target one square away', () => {
    const s = duel('zephyr', 'cinder', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['zephyrGust', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    const p1 = r.steps[0].players[1];
    expect(p1.to).toEqual({ r: 1, c: 2 });
    expect(p1.final).toEqual({ r: 1, c: 3 });
  });

  it('a push into the wall leaves the target in place', () => {
    const s = duel('zephyr', 'cinder', { r: 1, c: 2 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['zephyrGust', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].final).toEqual({ r: 1, c: 3 });
  });

  it('a push on a shared square goes the way the attacker faces', () => {
    const s = duel('zephyr', 'cinder', { r: 1, c: 1 }, { r: 1, c: 1 });
    s.players[0].facing = 1;
    const r = resolveRound(s, [['zephyrGust', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].final).toEqual({ r: 1, c: 2 });
  });

  it('a pull draws the target toward the attacker without passing them', () => {
    const s = duel('umbra', 'cinder', { r: 1, c: 1 }, { r: 0, c: 2 });
    const r = resolveRound(s, [['umbraGrasp', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].final).toEqual({ r: 0, c: 1 });
    const classic = arenaState('quarters');
    expect(displace(classic, { r: 0, c: 3 }, { r: 1, c: 1 }, 1, -5)).toEqual({ r: 0, c: 1 });
    expect(displace(classic, { r: 0, c: 1 }, { r: 1, c: 1 }, 1, -1)).toEqual({ r: 0, c: 1 });
  });

  it('Riptide pushes one extra square (Geyser hits Marin’s own column)', () => {
    const s = duel('marin', 'cinder', { r: 1, c: 1 }, { r: 0, c: 1 });
    const r = resolveRound(s, [['marinGeyser', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].hit).toBe('guard');
    expect(r.steps[0].players[1].final).toEqual({ r: 0, c: 3 });
  });

  it('Tidal Lure reaches two squares and Riptide pulls the target all the way in', () => {
    const s = duel('marin', 'cinder', { r: 1, c: 0 }, { r: 2, c: 2 });
    const r = resolveRound(s, [['marinLure', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    const p1 = r.steps[0].players[1];
    expect(p1.damageTaken).toBe(5);
    expect(p1.final).toEqual({ r: 2, c: 0 });
    // One square away is out of its reach.
    const t = duel('marin', 'cinder', { r: 1, c: 0 }, { r: 1, c: 1 });
    expect(resolveRound(t, [['marinLure', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0].players[1].hit).toBe('miss');
  });

  it('an immovable fighter ignores push and pull', () => {
    const s = duel('zephyr', 'basalt', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['zephyrGust', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].final).toEqual({ r: 1, c: 2 });
  });

  it('later steps use the pushed position', () => {
    // Pushed from c2 to c3, so the follow-up Jab from c1 (reaching c2) misses.
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['cinderRing', 'cinderJab', 'guard'], ['guard', 'focus', 'up']]);
    expect(r.steps[1].players[1].hit).toBe('miss');
  });
});

describe('stun', () => {
  it('cancels the target’s next card, which then costs nothing', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 });
    s.players[1].energy = 50;
    const r = resolveRound(s, [['cinderPillar', 'guard', 'focus'], ['guard', 'marinSplash', 'up']]);
    expect(r.steps[0].players[1].dazed).toBe(true);
    const second = r.steps[1].players[1];
    expect(second.stunned).toBe(true);
    expect(second.active).toBe(false);
    expect(r.steps[1].players[0].hit).toBe('none');
    expect(second.energy).toBe(50);
    expect(r.steps[2].players[1].active).toBe(true);
  });

  it('needs the hit to deal damage', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 }, [], ['bulwark']);
    const r = resolveRound(s, [['cinderPillar', 'guard', 'focus'], ['bulwark', 'marinSplash', 'up']]);
    expect(r.steps[0].players[1].dazed).toBe(false);
    expect(r.steps[1].players[1].active).toBe(true);
  });

  it('wears off at the end of the round', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 });
    const r = resolveRound(s, [['guard', 'focus', 'cinderPillar'], ['guard', 'focus', 'down']]);
    expect(r.steps[2].players[1].dazed).toBe(true);
    expect(r.state.players[1].dazed).toBe(false);
  });
});

describe('counter and drain', () => {
  it('counter hurts the attacker when its owner is hit', () => {
    const s = duel('cinder', 'basalt', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['basaltSpikes', 'focus', 'up']]);
    const [a, b] = r.steps[0].players;
    expect(b.damageTaken).toBe(25 - 20);
    expect(a.counterTaken).toBe(20);
    expect(a.life).toBe(100 - 20); // the counter (Ember Jab has no recoil)
  });

  it('counter does nothing on a miss', () => {
    const s = duel('cinder', 'basalt', { r: 1, c: 0 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['basaltSpikes', 'focus', 'up']]);
    expect(r.steps[0].players[0].counterTaken).toBe(0);
  });

  it('drain heals the attacker for a share of the damage dealt', () => {
    const s = duel('umbra', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 });
    s.players[0].life = 50;
    const r = resolveRound(s, [['umbraClaw', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    const [a, b] = r.steps[0].players;
    expect(b.damageTaken).toBe(25 - 15);
    // A share of the damage actually dealt, rounded down.
    const healed = Math.floor(((25 - 15) * CARDS.umbraClaw.drain!) / 100);
    expect(healed).toBeGreaterThan(0);
    expect(a.drained).toBe(healed);
    expect(a.life).toBe(50 + healed);
  });
});

describe('passives', () => {
  it('Kindle adds damage at low life', () => {
    const at = (life: number) => {
      const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
      s.players[0].life = life;
      return resolveRound(s, [['cinderJab', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0].players[1].damageTaken;
    };
    expect(at(51)).toBe(25);
    expect(at(50)).toBe(35);
  });

  it('Capacitor regains extra energy each round', () => {
    const s = duel('volta', 'cinder', { r: 1, c: 0 }, { r: 1, c: 3 });
    s.players[0].energy = 30;
    s.players[1].energy = 30;
    const r = resolveRound(s, [IDLE, IDLE]);
    expect(r.state.players[0].energy).toBe(30 + BALANCE.energyPerRound + 10);
    expect(r.state.players[1].energy).toBe(30 + BALANCE.energyPerRound);
  });

  it('Slipstream takes less damage after moving', () => {
    const s = duel('cinder', 'zephyr', { r: 1, c: 1 }, { r: 0, c: 2 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['down', 'guard', 'focus']]);
    expect(r.steps[0].players[1].damageTaken).toBe(25 - 10);
  });

  it('Ambush adds damage against a target that moved', () => {
    const s = duel('umbra', 'marin', { r: 1, c: 1 }, { r: 0, c: 3 });
    const r = resolveRound(s, [['umbraClaw', 'guard', 'focus'], ['left', 'guard', 'focus']]);
    const ambush = FIGHTERS.find((f) => f.id === 'umbra')!.passive!.mods.vsMovedBonus!;
    expect(ambush).toBeGreaterThan(0);
    expect(r.steps[0].players[1].damageTaken).toBe(CARDS.umbraClaw.damage! + ambush);
  });

  it('every fighter starts with the same life and energy', () => {
    for (const f of FIGHTERS) {
      const p = createMatch({ fighterId: f.id }, { fighterId: 'marin' }).players[0];
      expect([p.life, p.lifeMax, p.energy, p.energyMax], f.id).toEqual([BALANCE.lifeMax, BALANCE.lifeMax, BALANCE.energyStart, BALANCE.energyMax]);
    }
    const s = createMatch({ fighterId: 'basalt' }, { fighterId: 'volta' });
    expect(s.players[0].mods.immovable).toBe(true);
    expect(s.players[1].mods.energyPerRound).toBe(10);
  });

  it('match modifiers stack with passives', () => {
    const s = createMatch({ fighterId: 'volta' }, { fighterId: 'cinder' }, { mods: { energyPerRound: 10, damageBonus: 5 }, startLife: 50 });
    expect(s.players[0].mods.energyPerRound).toBe(20);
    expect(s.players[1].mods.damageBonus).toBe(5);
    expect(s.players[1].life).toBe(50);
    expect(mergeMods({ immovable: true }, { immovable: false }).immovable).toBe(true);
  });
});

describe('fast simulator with every card, modifier and arena', () => {
  function randomPlan(rng: Rng, s: MatchState, seat: 0 | 1): Plan {
    const p = s.players[seat];
    for (;;) {
      const plan = rng.shuffle([...p.deck]).slice(0, 3);
      if (!planError(p, plan)) return plan;
    }
  }

  it('matches the rules engine', () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 1500; i++) {
      const pickBonus = () => rng.shuffle([...BONUS_CARD_IDS]).slice(0, 5);
      const s = createMatch(
        { fighterId: rng.pick(FIGHTERS).id, bonusCards: pickBonus() },
        { fighterId: rng.pick(FIGHTERS).id, bonusCards: pickBonus() },
        { mods: { damageBonus: rng.int(3) * 5, damageReduction: rng.int(2) * 5 } },
        rng.pick(ARENAS).id,
      );
      s.round = 1 + rng.int(14); // late rounds exercise fatigue
      for (const p of s.players) {
        do p.pos = { r: rng.int(s.arena.rows), c: rng.int(s.arena.cols) };
        while (!isOpen(s.arena, p.pos.r, p.pos.c));
        p.life = 1 + rng.int(p.lifeMax);
        p.energy = rng.int(p.energyMax + 1);
        p.dazed = rng.int(5) === 0;
        if (p.mods.ammo) p.spent = p.deck.filter((id) => CARDS[id].kind === 'attack' && rng.int(2) === 0);
        p.hexed = rng.int(3) === 0;
      }
      // A few traps already on the board, owned by either side.
      for (let k = rng.int(3); k > 0; k--) {
        const at = rng.int(s.arena.rows * s.arena.cols);
        if (!s.arena.blocked.includes(at)) s.arena.traps.push({ at, owner: rng.int(2) as 0 | 1, damage: 10 + rng.int(3) * 5, until: s.round + 1 });
      }
      const plans: [Plan, Plan] = [randomPlan(rng, s, 0), randomPlan(rng, s, 1)];
      const real = resolveRound(s, plans);
      const fast = fastSimulate(s, plans[0], plans[1]);
      const last = real.steps[real.steps.length - 1].players;
      // Life includes end-of-round fatigue; energy is compared before the end-of-round refill.
      expect(fast.life).toEqual([real.state.players[0].life, real.state.players[1].life]);
      expect(fast.energy).toEqual([last[0].energy, last[1].energy]);
      expect(fast.pos).toEqual([last[0].final.r, last[0].final.c, last[1].final.r, last[1].final.c]);
      // What carries into the next round (the AI scores these).
      const ps = real.state.players;
      expect(fast.facing).toEqual([ps[0].facing, ps[1].facing]);
      expect(fast.spent).toEqual(ps.map((p) => (p.mods.ammo ? p.spent.length : -1)));
      expect(fast.hexed).toEqual([ps[0].hexed, ps[1].hexed]);
      const key = (at: number, owner: number, dmg: number) => `${at}:${owner}:${dmg}`;
      const fastTraps: string[] = [];
      for (let k = 0; k < fast.traps.length; k += 3) fastTraps.push(key(fast.traps[k], fast.traps[k + 1], fast.traps[k + 2]));
      expect(fastTraps.sort()).toEqual(real.state.arena.traps.map((t) => key(t.at, t.owner, t.damage)).sort());
      const o = real.state.outcome;
      expect(fast.outcome).toBe(o === null ? -1 : o.winner === null ? 2 : o.winner);
    }
  });
});

describe('content and match runner', () => {
  it('every effect card is well formed', () => {
    for (const c of Object.values(CARDS)) {
      if (c.push || c.stun || c.drain || c.sap || c.hex || c.vsMoved || c.recoil || c.planted) expect(c.kind, c.id).toBe('attack');
      if (c.counter) expect(['guard', 'move'], c.id).toContain(c.kind);
      if (c.forward) expect(c.kind, c.id).toBe('move');
      if (c.healAtOrBelow !== undefined) expect(c.kind, c.id).toBe('heal');
    }
    for (const f of FIGHTERS) expect(f.passive?.name).toBeTruthy();
  });

  it('runMatch is deterministic for a seed', () => {
    const run = () => runMatch({ fighterId: 'zephyr' }, { fighterId: 'umbra' }, { profiles: [SIM_PROFILE, SIM_PROFILE], seed: 9 });
    const a = run();
    const b = run();
    expect(a.rounds).toBe(b.rounds);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.rounds).toBeGreaterThan(0);
  }, 60_000);
});

describe('attack priority', () => {
  it('the stronger attack lands first, and a knockout cancels the reply', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[1].life = 40;
    const r = resolveRound(s, [['cinderBlaze', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]);
    const step = r.steps[0];
    expect(step.sequence).toEqual([0, 1]);
    expect(step.players[1].interrupted).toBe(true);
    expect(step.players[0].hit).toBe('none');
    expect(step.players[0].life).toBe(100 - 10); // only Wildfire's recoil
    expect(r.state.outcome).toEqual({ winner: 0 });
  });

  it('on equal damage the fighter with more life strikes first', () => {
    // Ember Jab and Zap both deal 25.
    const s = duel('cinder', 'volta', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 20;
    s.players[1].life = 30;
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['voltaZap', 'guard', 'focus']]);
    expect(r.steps[0].sequence).toEqual([1, 0]);
    expect(r.steps[0].players[0].interrupted).toBe(true);
    expect(r.state.outcome).toEqual({ winner: 1 });
  });

  it('equal damage and equal life still strike at the same time', () => {
    const s = duel('cinder', 'volta', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = s.players[1].life = 10;
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['voltaZap', 'guard', 'focus']]);
    expect(r.steps[0].sequence).toBeNull();
    expect(r.state.outcome).toEqual({ winner: null, draw: true });
  });

  it('a push from the first strike can carry the target out of its own attack', () => {
    // Slug (40) beats Ember Jab (25) and pushes Cinder a square, so the Jab misses.
    const s = duel('ferro', 'cinder', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['ferroSlug', 'guard', 'focus'], ['cinderJab', 'guard', 'focus']]);
    const step = r.steps[0];
    expect(step.sequence).toEqual([0, 1]);
    expect(step.midLives).toEqual([100, 60]);
    expect(step.players[1].final).toEqual({ r: 1, c: 3 });
    expect(step.players[0].hit).toBe('miss');
    expect(step.players[0].life).toBe(100);
    expect(step.players[1].life).toBe(60);
  });

  it('only applies when both fighters attack', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].sequence).toBeNull();
    expect(r.steps[0].players[1].hit).toBe('guard');
  });
});

describe('ammo (Ferro)', () => {
  const ferro = () => duel('ferro', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });

  it('a fired attack is spent and cannot be planned again', () => {
    const s = ferro();
    const r = resolveRound(s, [['ferroSnap', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    const next = r.state.players[0];
    expect(next.spent).toEqual(['ferroSnap']);
    expect(planError(next, ['ferroSnap', 'guard', 'focus'])).toMatch(/reload/i);
    expect(planError(next, ['ferroScatter', 'guard', 'focus'])).toBeNull();
  });

  it('Reload earlier in the plan makes spent attacks usable that same round', () => {
    const s = ferro();
    s.players[0].spent = ['ferroSnap', 'ferroSlug'];
    expect(planError(s.players[0], ['ferroSnap', 'ferroReload', 'guard'])).not.toBeNull();
    expect(planError(s.players[0], ['ferroReload', 'ferroSnap', 'guard'])).toBeNull();
    const r = resolveRound(s, [['ferroReload', 'ferroSnap', 'guard'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[0].reloaded).toBe(true);
    expect(r.steps[1].players[1].damageTaken).toBeGreaterThan(0);
    expect(r.state.players[0].spent).toEqual(['ferroSnap']);
  });

  it('a stunned Reload leaves the attacks spent, so the next attack fizzles', () => {
    // Marin is the stunner here: give her a stun card through a bonus.
    const s = duel('ferro', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 }, [], ['daze']);
    s.players[0].spent = ['ferroSnap'];
    // Focus (not Guard) in step 1, so Daze deals damage and its stun lands.
    const r = resolveRound(s, [['focus', 'ferroReload', 'ferroSnap'], ['daze', 'guard', 'focus']]);
    expect(r.steps[0].players[0].dazed).toBe(true);
    expect(r.steps[1].players[0].stunned).toBe(true);
    expect(r.steps[1].players[0].reloaded).toBe(false);
    expect(r.steps[2].players[0].active).toBe(false);
    expect(r.state.players[0].spent).toEqual(['ferroSnap']);
  });

  it('missing still spends the attack, and other fighters never run out', () => {
    const s = duel('ferro', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['ferroSnap', 'guard', 'focus'], ['marinSplash', 'guard', 'focus']]);
    expect(r.state.players[0].spent).toContain('ferroSnap');
    expect(r.state.players[1].spent).toEqual([]);
  });

  it('the AI only proposes legal plans while attacks are spent', () => {
    const s = ferro();
    s.players[0].spent = ['ferroSnap', 'ferroScatter', 'ferroSlug', 'ferroCannon'];
    const plans = enumeratePlans(s.players[0]);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(planError(s.players[0], p)).toBeNull();
    expect(plans.some((p) => p[0] === 'ferroReload' && p[1] === 'ferroCannon')).toBe(true);
  });
});
