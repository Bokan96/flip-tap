import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { BONUS_CARD_IDS, CARDS, FIGHTERS } from '../src/content/cards';
import { fastSimulate } from '../src/engine/fastsim';
import { runMatch } from '../src/engine/match';
import { SIM_PROFILE } from '../src/engine/ai';
import { Rng } from '../src/engine/rng';
import { displace, planError, resolveRound } from '../src/engine/rules';
import { createMatch, mergeMods } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';

const IDLE: Plan = ['guard', 'up', 'down'];

function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = [], bonusB: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB });
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
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
    expect(displace({ r: 0, c: 3 }, { r: 1, c: 1 }, 1, -5)).toEqual({ r: 0, c: 1 });
    expect(displace({ r: 0, c: 1 }, { r: 1, c: 1 }, 1, -1)).toEqual({ r: 0, c: 1 });
  });

  it('Riptide pushes one extra square', () => {
    const s = duel('marin', 'cinder', { r: 1, c: 0 }, { r: 1, c: 1 });
    const r = resolveRound(s, [['marinWall', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].final).toEqual({ r: 1, c: 3 });
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
    expect(a.life).toBe(80);
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
    expect(a.drained).toBe(5);
    expect(a.life).toBe(55);
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
    expect(r.state.players[0].energy).toBe(30 + BALANCE.energyPerRound + 7);
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
    expect(r.steps[0].players[1].damageTaken).toBe(25 + 10);
  });

  it('Bedrock and Capacitor raise the maximums', () => {
    const s = createMatch({ fighterId: 'basalt' }, { fighterId: 'volta' });
    expect(s.players[0].lifeMax).toBe(115);
    expect(s.players[0].life).toBe(115);
    expect(s.players[0].mods.immovable).toBe(true);
    expect(s.players[1].energyMax).toBe(120);
  });

  it('match modifiers stack with passives', () => {
    const s = createMatch({ fighterId: 'volta' }, { fighterId: 'cinder' }, { mods: { energyPerRound: 10, damageBonus: 5 }, startLife: 50 });
    expect(s.players[0].mods.energyPerRound).toBe(17);
    expect(s.players[1].mods.damageBonus).toBe(5);
    expect(s.players[1].life).toBe(50);
    expect(mergeMods({ immovable: true }, { immovable: false }).immovable).toBe(true);
  });
});

describe('fast simulator with every card and modifier', () => {
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
      );
      for (const p of s.players) {
        p.pos = { r: rng.int(BALANCE.rows), c: rng.int(BALANCE.cols) };
        p.life = 1 + rng.int(p.lifeMax);
        p.energy = rng.int(p.energyMax + 1);
        p.dazed = rng.int(5) === 0;
      }
      const plans: [Plan, Plan] = [randomPlan(rng, s, 0), randomPlan(rng, s, 1)];
      const real = resolveRound(s, plans);
      const fast = fastSimulate(s, plans[0], plans[1]);
      const last = real.steps[real.steps.length - 1].players;
      expect(fast.life).toEqual([last[0].life, last[1].life]);
      expect(fast.energy).toEqual([last[0].energy, last[1].energy]);
      expect(fast.pos).toEqual([last[0].final.r, last[0].final.c, last[1].final.r, last[1].final.c]);
      const o = real.state.outcome;
      expect(fast.outcome).toBe(o === null ? -1 : o.winner === null ? 2 : o.winner);
    }
  });
});

describe('content and match runner', () => {
  it('every effect card is well formed', () => {
    for (const c of Object.values(CARDS)) {
      if (c.push || c.stun || c.drain) expect(c.kind).toBe('attack');
      if (c.counter) expect(c.kind).toBe('guard');
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
    expect(step.players[0].life).toBe(100);
    expect(r.state.outcome).toEqual({ winner: 0 });
  });

  it('on equal damage the fighter with more life strikes first', () => {
    // Ember Jab and Tremor both deal 25.
    const s = duel('cinder', 'basalt', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = 20;
    s.players[1].life = 30;
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['basaltQuake', 'guard', 'focus']]);
    expect(r.steps[0].sequence).toEqual([1, 0]);
    expect(r.steps[0].players[0].interrupted).toBe(true);
    expect(r.state.outcome).toEqual({ winner: 1 });
  });

  it('equal damage and equal life still strike at the same time', () => {
    const s = duel('cinder', 'basalt', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[0].life = s.players[1].life = 10;
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['basaltQuake', 'guard', 'focus']]);
    expect(r.steps[0].sequence).toBeNull();
    expect(r.state.outcome).toEqual({ winner: null, draw: true });
  });

  it('a push from the first strike can carry the target out of its own attack', () => {
    // Tide Wall (30) beats Ember Jab (25) and pushes Cinder 2 squares (Riptide), so the Jab misses.
    const s = duel('marin', 'cinder', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['marinWall', 'guard', 'focus'], ['cinderJab', 'guard', 'focus']]);
    const step = r.steps[0];
    expect(step.sequence).toEqual([0, 1]);
    expect(step.midLives).toEqual([100, 70]);
    expect(step.players[1].final).toEqual({ r: 1, c: 3 });
    expect(step.players[0].hit).toBe('miss');
    expect(step.players[0].life).toBe(100);
  });

  it('only applies when both fighters attack', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const r = resolveRound(s, [['cinderJab', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].sequence).toBeNull();
    expect(r.steps[0].players[1].hit).toBe('guard');
  });
});
