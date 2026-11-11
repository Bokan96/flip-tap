import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/content/arenas';
import { BONUS_CARD_IDS, CARDS, FIGHTERS } from '../src/content/cards';
import { choosePlan, DIFFICULTIES, enumeratePlans, PROFILES, solveMatrix } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { fastSimulate } from '../src/engine/fastsim';
import { historyFromLog, readPlayer, type RoundRecord } from '../src/engine/playerModel';
import { Rng } from '../src/engine/rng';
import { isOpen, planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchLog, Plan } from '../src/engine/types';
import { CpuPlanSource } from '../src/net/transport';

describe('equilibrium solver', () => {
  it('plays rock-paper-scissors evenly', () => {
    const [p, q] = solveMatrix([
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ], 2000);
    for (const x of [...p, ...q]) expect(x).toBeCloseTo(1 / 3, 1);
  });

  it('never plays a dominated plan', () => {
    const [p] = solveMatrix([
      [5, 5, 5],
      [1, 2, 3],
    ]);
    expect(p[0]).toBeGreaterThan(0.99);
  });
});

describe('reading the player', () => {
  it('learns favourite cards per step, with recent rounds counting more', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' });
    const habit: Plan = ['up', 'marinSplash', 'guard'];
    const history: RoundRecord[] = [];
    for (let i = 0; i < 6; i++) history.push({ plans: [['guard', 'focus', 'up'], habit], life: [100, 100] });
    const model = readPlayer(history, 1, s)!;
    expect(model.confidence).toBe(1);
    expect(model.weight(habit)).toBeGreaterThan(model.weight(['marinSplash', 'up', 'guard']));
    expect(model.weight(['marinSplash', 'up', 'guard'])).toBeGreaterThan(model.weight(['down', 'left', 'focus']));
    expect(readPlayer(history.slice(0, 1), 1, s)).toBeNull();
  });

  it('notices what someone does when their life is low', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' });
    const history: RoundRecord[] = [
      { plans: [IDLE, ['marinSplash', 'up', 'down']], life: [100, 100] },
      { plans: [IDLE, ['marinSplash', 'up', 'down']], life: [100, 80] },
      { plans: [IDLE, ['guard', 'focus', 'left']], life: [100, 30] },
    ];
    s.players[1].life = 25;
    const low = readPlayer(history, 1, s)!;
    s.players[1].life = 90;
    const high = readPlayer(history, 1, s)!;
    const guardPlan: Plan = ['guard', 'focus', 'left'];
    const attackPlan: Plan = ['marinSplash', 'up', 'down'];
    expect(low.weight(guardPlan) - low.weight(attackPlan)).toBeGreaterThan(high.weight(guardPlan) - high.weight(attackPlan));
  });

  it('builds its history from the match log', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' });
    const log: MatchLog = { rounds: [] };
    let state = s;
    for (const plans of [[IDLE, IDLE], [IDLE, ['marinSplash', 'guard', 'up']]] as [Plan, Plan][]) {
      const result = resolveRound(state, plans);
      log.rounds.push({ plans, result });
      state = result.state;
    }
    const h = historyFromLog(log, state);
    expect(h).toHaveLength(2);
    expect(h[0].life).toEqual([100, 100]);
    expect(h[1].life).toEqual([log.rounds[0].result.state.players[0].life, log.rounds[0].result.state.players[1].life]);
  });
});

const IDLE: Plan = ['guard', 'up', 'down'];

describe('CPU', () => {
  it('always picks a legal plan, at every difficulty, in odd positions', () => {
    const rng = new Rng(77);
    for (let i = 0; i < 24; i++) {
      const s = createMatch(
        { fighterId: rng.pick(FIGHTERS).id, bonusCards: rng.shuffle([...BONUS_CARD_IDS]).slice(0, 3) },
        { fighterId: rng.pick(FIGHTERS).id, bonusCards: rng.shuffle([...BONUS_CARD_IDS]).slice(0, 3) },
        {},
        rng.pick(ARENAS).id,
      );
      s.round = 1 + rng.int(14);
      for (const p of s.players) {
        do p.pos = { r: rng.int(s.arena.rows), c: rng.int(s.arena.cols) };
        while (!isOpen(s.arena, p.pos.r, p.pos.c));
        p.life = 1 + rng.int(p.lifeMax);
        p.energy = rng.int(p.energyMax + 1);
        if (p.mods.ammo) p.spent = p.deck.filter((id) => CARDS[id].kind === 'attack' && rng.int(2) === 0);
      }
      const d = DIFFICULTIES[i % DIFFICULTIES.length];
      const history: RoundRecord[] = [0, 1, 2].map(() => ({ plans: [IDLE, IDLE], life: [100, 100] }));
      const plan = choosePlan(s, 1, d, rng, history);
      expect(planError(s.players[1], plan), `${d}: ${plan}`).toBeNull();
    }
  }, 60_000);

  it('Expert punishes a player who keeps playing the same plan', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' });
    s.players[0].pos = { r: 1, c: 1 };
    s.players[1].pos = { r: 1, c: 2 };
    s.round = 7;
    const habit: Plan = ['marinSplash', 'guard', 'up'];
    // How good each of Cinder's plans is against that plan, as a percentile rank.
    const plans = enumeratePlans(s.players[0]);
    const value = (p: Plan) => {
      const r = fastSimulate(s, p, habit);
      return r.outcome === 0 ? 1000 : r.life[0] - r.life[1];
    };
    const sorted = plans.map(value).sort((a, b) => b - a);
    const cutoff = sorted[Math.floor(sorted.length * 0.1)];
    const history: RoundRecord[] = Array.from({ length: 6 }, () => ({ plans: [IDLE, habit], life: [100, 100] }));
    const rate = (h: RoundRecord[]) => {
      const rng = new Rng(11);
      let good = 0;
      for (let k = 0; k < 20; k++) if (value(choosePlan(s, 0, 'expert', rng, h)) >= cutoff) good++;
      return good;
    };
    const withHabits = rate(history);
    expect(withHabits).toBeGreaterThanOrEqual(10);
    expect(withHabits).toBeGreaterThan(rate([]));
  }, 60_000);

  it('Expert beats Hard in a seeded mini-tournament', () => {
    const rng = new Rng(21);
    let expert = 0;
    let hard = 0;
    for (let g = 0; g < 8; g++) {
      const fighters = [rng.pick(FIGHTERS).id, rng.pick(FIGHTERS).id];
      const flip = g % 2 === 1; // Expert takes both seats in turn
      const rec = runMatch(
        { fighterId: fighters[0] },
        { fighterId: fighters[1] },
        { profiles: flip ? [PROFILES.hard, PROFILES.expert] : [PROFILES.expert, PROFILES.hard], seed: rng.int(2 ** 31) },
      );
      const w = rec.outcome.winner;
      if (w !== null) (w === (flip ? 1 : 0) ? expert++ : hard++);
    }
    expect(expert).toBeGreaterThan(hard);
  }, 120_000);

  it('Expert decides within the time budget with full bonus decks', () => {
    const s = createMatch({ fighterId: 'ferro', bonusCards: ['leapLeft', 'leapRight', 'surge'] }, { fighterId: 'vex', bonusCards: ['bulwark', 'tripwire', 'phaseStep'] });
    const rng = new Rng(3);
    choosePlan(s, 1, 'expert', rng); // warm up
    const times: number[] = [];
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      choosePlan(s, 1, 'expert', rng);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    // ~250 ms on a desktop; generous so slow machines don't fail the suite.
    expect(times[1]).toBeLessThan(800);
  }, 30_000);

  it('the CPU plan source works without a worker (Node) and is repeatable', async () => {
    const s = createMatch({ fighterId: 'volta' }, { fighterId: 'umbra' });
    const a = await new CpuPlanSource('expert', 5).requestPlan(s, 1, { rounds: [] });
    const b = await new CpuPlanSource('expert', 5).requestPlan(s, 1, { rounds: [] });
    expect(planError(s.players[1], a)).toBeNull();
    expect(a).toEqual(b);
  });
});
