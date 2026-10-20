import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { CARDS, FIGHTERS } from '../src/content/cards';
import { choosePlan, enumeratePlans } from '../src/engine/ai';
import { fastSimulate } from '../src/engine/fastsim';
import { Rng } from '../src/engine/rng';
import { attackArea, canPlace, planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan } from '../src/engine/types';

const match = (a = 'cinder', b = 'marin', bonusA: string[] = [], bonusB: string[] = []) =>
  createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b, bonusCards: bonusB });

const IDLE: Plan = ['guard', 'up', 'down'];

describe('content', () => {
  it('every fighter signature card exists and patterns are 3x3', () => {
    for (const f of FIGHTERS) for (const id of f.signature) expect(CARDS[id]).toBeDefined();
    for (const c of Object.values(CARDS)) {
      if (c.kind === 'attack') {
        expect(c.pattern).toHaveLength(3);
        for (const row of c.pattern!) expect(row).toMatch(/^[01]{3}$/);
        expect(c.damage).toBeGreaterThan(0);
      }
    }
  });
});

describe('setup', () => {
  it('starts both fighters full at opposite ends', () => {
    const s = match();
    expect(s.players[0].pos).toEqual(BALANCE.startPos[0]);
    expect(s.players[1].pos).toEqual(BALANCE.startPos[1]);
    expect(s.players[0].life).toBe(100);
    expect(s.players[1].energy).toBe(100);
    expect(s.players[0].facing).toBe(1);
    expect(s.players[1].facing).toBe(-1);
  });
});

describe('plan validation', () => {
  it('rejects duplicates, missing slots, foreign cards and unaffordable plans', () => {
    const s = match();
    const p = s.players[0];
    expect(planError(p, ['up', 'up', 'down'])).toMatch(/once/);
    expect(planError(p, ['up', 'down'])).toMatch(/every slot/);
    expect(planError(p, ['up', 'down', 'marinSplash'])).toMatch(/not in deck/);
    p.energy = 50;
    expect(planError(p, ['cinderBlaze', 'cinderPillar', 'up'])).toMatch(/energy/);
    expect(planError(p, ['focus', 'cinderBlaze', 'up'])).toBeNull();
  });

  it('canPlace respects running energy totals', () => {
    const s = match();
    const p = s.players[0];
    p.energy = 20;
    expect(canPlace(p, ['', '', ''], 0, 'cinderBlaze')).toBe(false);
    p.energy = 40;
    expect(canPlace(p, ['focus', '', ''], 1, 'cinderBlaze')).toBe(true);
    expect(canPlace(p, ['', 'focus', ''], 0, 'cinderBlaze')).toBe(false);
  });

  it('resolveRound throws on illegal plans', () => {
    expect(() => resolveRound(match(), [['up', 'up', 'up'], IDLE])).toThrow();
  });
});

describe('attack areas', () => {
  it('mirrors patterns for a fighter facing left', () => {
    const jab = CARDS.cinderJab; // self + front
    expect(attackArea(jab, { r: 1, c: 1 }, 1)).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 2 },
    ]);
    expect(attackArea(jab, { r: 1, c: 1 }, -1)).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 0 },
    ]);
  });

  it('clips to the board', () => {
    expect(attackArea(CARDS.zephyrSpiral, { r: 0, c: 0 }, 1)).toHaveLength(4);
  });
});

describe('resolution', () => {
  function adjacent(): MatchState {
    const s = match('cinder', 'marin');
    s.players[0].pos = { r: 1, c: 1 };
    s.players[1].pos = { r: 1, c: 2 };
    return s;
  }

  it('hits apply damage and attack costs energy', () => {
    const r = resolveRound(adjacent(), [['cinderJab', 'up', 'down'], ['focus', 'up', 'down']]);
    expect(r.steps[0].players[1].hit).toBe('hit');
    expect(r.steps[0].players[1].damageTaken).toBe(25);
    expect(r.state.players[1].life).toBe(75);
    // 100 - 15 (jab) then +15 recovery at round end.
    expect(r.state.players[0].energy).toBe(100);
  });

  it('guard reduces damage', () => {
    const r = resolveRound(adjacent(), [['cinderJab', 'up', 'down'], ['guard', 'up', 'down']]);
    expect(r.steps[0].players[1].hit).toBe('guard');
    expect(r.state.players[1].life).toBe(100 - (25 - 15));
  });

  it('movement resolves before attacks so a step can dodge', () => {
    const r = resolveRound(adjacent(), [['cinderJab', 'up', 'down'], ['up', 'down', 'guard']]);
    expect(r.steps[0].players[1].hit).toBe('miss');
    expect(r.state.players[1].life).toBe(100);
  });

  it('movement is clamped to the board', () => {
    const s = match();
    const r = resolveRound(s, [['left', 'up', 'down'], IDLE]);
    expect(r.steps[0].players[0].to).toEqual({ r: 1, c: 0 });
  });

  it('heal restores life up to max', () => {
    const s = match('cinder', 'marin', ['renew']);
    s.players[0].life = 50;
    const r = resolveRound(s, [['renew', 'up', 'down'], IDLE]);
    expect(r.state.players[0].life).toBe(85);
  });

  it('KO ends the match and skips remaining slots', () => {
    const s = adjacent();
    s.players[1].life = 20;
    const r = resolveRound(s, [['cinderJab', 'up', 'down'], ['focus', 'up', 'down']]);
    expect(r.steps).toHaveLength(1);
    expect(r.state.outcome).toEqual({ winner: 0 });
    expect(() => resolveRound(r.state, [IDLE, IDLE])).toThrow(/over/);
  });

  it('double KO is a draw', () => {
    const s = adjacent();
    s.players[0].life = 10;
    s.players[1].life = 10;
    const r = resolveRound(s, [['cinderJab', 'up', 'down'], ['marinSplash', 'up', 'down']]);
    expect(r.state.outcome).toEqual({ winner: null, draw: true });
  });

  it('energy recovers at the end of a round, capped at max', () => {
    const s = match();
    s.players[0].energy = 30;
    const r = resolveRound(s, [IDLE, IDLE]);
    expect(r.state.players[0].energy).toBe(45);
    expect(r.state.players[1].energy).toBe(100);
    expect(r.state.round).toBe(2);
  });

  it('is deterministic and does not mutate the input state', () => {
    const s = adjacent();
    const snapshot = JSON.stringify(s);
    const plans: [Plan, Plan] = [['cinderJab', 'up', 'cinderRing'], ['marinSplash', 'guard', 'down']];
    const a = resolveRound(s, plans);
    const b = resolveRound(s, plans);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('fast simulator', () => {
  it('matches the real rules engine on random rounds', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 400; i++) {
      const a = rng.pick(FIGHTERS).id;
      const b = rng.pick(FIGHTERS).id;
      const s = match(a, b, ['bulwark', 'renew', 'leapLeft', 'overload'], ['surge', 'leapRight', 'stormCall']);
      for (const p of s.players) {
        p.pos = { r: rng.int(BALANCE.rows), c: rng.int(BALANCE.cols) };
        p.life = 1 + rng.int(100);
        p.energy = rng.int(101);
      }
      const plans: [Plan, Plan] = [rng.pick(enumeratePlans(s.players[0])), rng.pick(enumeratePlans(s.players[1]))];
      const real = resolveRound(s, plans);
      const fast = fastSimulate(s, plans[0], plans[1]);
      const last = real.steps[real.steps.length - 1].players;
      expect(fast.life).toEqual([last[0].life, last[1].life]);
      expect(fast.energy).toEqual([last[0].energy, last[1].energy]);
      const o = real.state.outcome;
      expect(fast.outcome).toBe(o === null ? -1 : o.winner === null ? 2 : o.winner);
    }
  });
});

describe('AI', () => {
  it('decides quickly even with a full bonus deck', () => {
    const bonus = ['bulwark', 'renew', 'leapLeft', 'leapRight', 'surge'];
    const s = match('cinder', 'marin', bonus, bonus);
    const t = performance.now();
    choosePlan(s, 1, 'hard', new Rng(1));
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('enumerates only legal plans', () => {
    const s = match();
    s.players[0].energy = 25;
    const plans = enumeratePlans(s.players[0]);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(planError(s.players[0], p)).toBeNull();
  });

  it('always returns a legal plan', () => {
    const rng = new Rng(7);
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = match('volta', 'umbra');
      s.players[1].energy = 5;
      expect(planError(s.players[1], choosePlan(s, 1, d, rng))).toBeNull();
    }
  });

  it('AI vs AI matches always finish without errors', () => {
    const rng = new Rng(42);
    const results = { 0: 0, 1: 0, draw: 0 };
    for (let g = 0; g < 30; g++) {
      const a = FIGHTERS[g % FIGHTERS.length].id;
      const b = FIGHTERS[(g + 1 + (g % 5)) % FIGHTERS.length].id;
      let s = match(a, b);
      while (!s.outcome) {
        expect(s.round).toBeLessThan(60);
        const plans: [Plan, Plan] = [choosePlan(s, 0, 'easy', rng), choosePlan(s, 1, 'easy', rng)];
        s = resolveRound(s, plans).state;
      }
      if (s.outcome.winner === null) results.draw++;
      else results[s.outcome.winner]++;
    }
    expect(results[0] + results[1] + results.draw).toBe(30);
  }, 120_000);

  it('a smarter AI beats a random-ish AI more often than not', () => {
    const rng = new Rng(3);
    let hardWins = 0;
    const games = 16;
    for (let g = 0; g < games; g++) {
      const f = FIGHTERS[g % FIGHTERS.length].id;
      let s = match(f, f);
      while (!s.outcome && s.round < 60) {
        s = resolveRound(s, [choosePlan(s, 0, 'hard', rng), choosePlan(s, 1, 'easy', rng)]).state;
      }
      if (s.outcome?.winner === 0) hardWins++;
    }
    expect(hardWins).toBeGreaterThan(games / 2);
  }, 120_000);
});
