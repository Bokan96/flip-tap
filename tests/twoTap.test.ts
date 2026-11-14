import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { FIGHTERS } from '../src/content/cards';
import { TWO_TAP } from '../src/content/variants';
import { choosePlan, PROFILES, SIM_PROFILE } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { Rng } from '../src/engine/rng';
import { canPlace, energyRecovery, planError, playerTrace, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchLog, MatchState, Plan, Pos } from '../src/engine/types';
import { contentStamp, decodeReplay, encodeReplay, replayFromMatch, runReplay } from '../src/meta/replay';

const IDLE: Plan = ['guard', 'up', 'down'];

const twoTap = (a = 'cinder', b = 'marin', arena = 'classic'): MatchState =>
  createMatch({ fighterId: a }, { fighterId: b }, {}, arena, 'twoTap');

/** A Two-tap match on the open 3×3 board with both fighters placed and full energy. */
function duel(a: string, b: string, pa: Pos, pb: Pos): MatchState {
  const s = twoTap(a, b, 'quarters');
  s.players[0].pos = pa;
  s.players[1].pos = pb;
  for (const p of s.players) p.energy = p.energyMax;
  return s;
}

describe('two-tap', () => {
  it('plays two cards a round and locks the third in for the next round', () => {
    const s = twoTap();
    expect(s.variant).toBe('twoTap');
    expect(s.players[0].carry).toEqual({ held: null });
    const r = resolveRound(s, [['guard', 'up', 'focus'], ['guard', 'down', 'left']]);
    expect(r.steps).toHaveLength(2);
    expect(r.state.round).toBe(2);
    expect(r.state.players.map((p) => p.carry)).toEqual([{ held: 'focus' }, { held: 'left' }]);
    const r2 = resolveRound(r.state, [['focus', 'down', 'guard'], ['left', 'up', 'guard']]);
    expect(r2.steps[0].players.map((p) => p.cardId)).toEqual(['focus', 'left']);
    expect(r2.state.players.map((p) => p.carry)).toEqual([{ held: 'guard' }, { held: 'guard' }]);
  });

  it('leaves classic matches alone', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' });
    expect(s.variant).toBeUndefined();
    expect(s.players[0].carry).toBeUndefined();
    expect(resolveRound(s, [IDLE, IDLE]).steps).toHaveLength(BALANCE.slotsPerRound);
  });

  it('only accepts plans that start with the locked-in card', () => {
    const s = resolveRound(twoTap(), [['guard', 'up', 'focus'], ['guard', 'down', 'left']]).state;
    const p = s.players[0];
    expect(planError(p, ['guard', 'down', 'focus'])).toMatch(/locked-in/);
    expect(planError(p, ['focus', 'focus', 'guard'])).toMatch(/once/);
    expect(planError(p, ['focus', 'down', 'guard'])).toBeNull();
    expect(canPlace(p, ['focus', '', ''], 1, 'up')).toBe(true);
    expect(canPlace(p, ['focus', '', ''], 1, 'focus')).toBe(false);
    expect(canPlace(p, ['', '', ''], 1, 'up')).toBe(false);
  });

  it('lets a locked-in card the fighter can no longer pay for fizzle instead of blocking the plan', () => {
    const s = resolveRound(twoTap(), [['guard', 'up', 'cinderBlaze'], ['guard', 'down', 'left']]).state;
    s.players[0].energy = 10;
    const plan: Plan = ['cinderBlaze', 'up', 'down'];
    expect(planError(s.players[0], plan)).toBeNull();
    expect(playerTrace(s.players[0], plan)![0]).toBe(10);
    const r = resolveRound(s, [plan, ['left', 'up', 'down']]);
    expect(r.steps[0].players[0].active).toBe(false);
    expect(r.steps[0].players[0].energy).toBe(10);
  });

  it('counts the round’s energy refill before the held-over card', () => {
    const p = twoTap().players[0];
    expect(p.energy).toBe(BALANCE.energyStart);
    expect(energyRecovery(p)).toBe(TWO_TAP.energyPerRound);
    // 50 − 45 leaves 5; the refill comes before the third card, which plays next round.
    const plan: Plan = ['cinderBlaze', 'guard', 'cinderJab'];
    expect(playerTrace(p, plan)).toEqual([5, 5, 5 + energyRecovery(p) - 15]);
    expect(planError(p, plan)).toBeNull();
  });

  it('carries a stun on a round’s last card over to the locked-in card', () => {
    const s = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 1 });
    const r = resolveRound(s, [['guard', 'cinderPillar', 'focus'], ['guard', 'focus', 'marinSplash']]);
    expect(r.steps[1].players[1].dazed).toBe(true);
    expect(r.state.players[1].dazed).toBe(TWO_TAP.carryDaze);
    const r2 = resolveRound(r.state, [['focus', 'guard', 'up'], ['marinSplash', 'guard', 'up']]);
    expect(r2.steps[0].players[1].stunned).toBe(TWO_TAP.carryDaze);
  });

  it('starts fatigue later, since rounds are shorter', () => {
    const s = twoTap();
    s.round = TWO_TAP.fatigueAfterRound;
    expect(resolveRound(s, [IDLE, IDLE]).fatigue).toBe(0);
    s.round = TWO_TAP.fatigueAfterRound + 1;
    expect(resolveRound(s, [IDLE, IDLE]).fatigue).toBe(BALANCE.fatigueDamage);
  });
});

describe('two-tap CPU', { timeout: 30000 }, () => {
  it('plays legal plans that start with its locked-in card, for every fighter', () => {
    FIGHTERS.forEach((f, i) => {
      // runMatch throws on an illegal plan, so getting through the rounds is the legality check.
      const rec = runMatch({ fighterId: f.id }, { fighterId: FIGHTERS[(i + 4) % FIGHTERS.length].id }, {
        profiles: [SIM_PROFILE, PROFILES.expert],
        seed: i + 1,
        maxRounds: 5,
        variant: 'twoTap',
      });
      rec.history.forEach((h, k) => {
        if (k) for (const seat of [0, 1]) expect(h.plans[seat][0]).toBe(rec.history[k - 1].plans[seat][2]);
      });
    });
  });

  it('can’t see the card its opponent holds face down', () => {
    const s = resolveRound(twoTap('volta', 'umbra'), [['guard', 'up', 'focus'], ['guard', 'down', 'left']]).state;
    const other = structuredClone(s);
    other.players[0].carry = { held: 'right' };
    for (const d of ['normal', 'expert'] as const) {
      expect(choosePlan(s, 1, d, new Rng(5))).toEqual(choosePlan(other, 1, d, new Rng(5)));
    }
  });
});

describe('two-tap replays', { timeout: 30000 }, () => {
  it('keep the variant and rebuild the same match', () => {
    const rec = runMatch({ fighterId: 'zephyr' }, { fighterId: 'basalt' }, { profiles: [SIM_PROFILE, SIM_PROFILE], seed: 3, variant: 'twoTap' });
    const log: MatchLog = { rounds: rec.history };
    const replay = replayFromMatch(rec.final, log, { mode: 'cpu', difficulty: 'hard' });
    expect(replay.variant).toBe('twoTap');
    const back = decodeReplay(encodeReplay(replay))!;
    expect(back).toEqual({ ...replay, stale: false });
    if (!rec.timedOut) expect(runReplay(back)!.states.at(-1)).toEqual(rec.final);
    // Two-tap's own numbers only stamp Two-tap replays.
    expect(contentStamp('twoTap')).not.toBe(contentStamp());
  });
});
