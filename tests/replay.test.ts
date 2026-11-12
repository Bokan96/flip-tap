import { beforeEach, describe, expect, it } from 'vitest';
import { ARENAS } from '../src/content/arenas';
import { BONUS_CARD_IDS, CARDS, FIGHTERS } from '../src/content/cards';
import { MODIFIERS } from '../src/content/modifiers';
import { SIM_PROFILE } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchLog, MatchState, Plan } from '../src/engine/types';
import { matchStats, tradeRow } from '../src/meta/matchStats';
import { profile, recentMatches, recordRecent, RECENT_LIMIT, resetProfile } from '../src/meta/profile';
import {
  contentStamp,
  decodeReplay,
  encodeReplay,
  replayFromMatch,
  ReplayPlanSource,
  replayStart,
  runReplay,
  type Replay,
} from '../src/meta/replay';
import { memoryStorage, setStorageBackend } from '../src/meta/storage';
import { replayCodeFromHash } from '../src/ui/share';

/** An AI-vs-AI match turned into a replay, plus the real result to compare against. */
function playOut(seed: number, opts: { arena?: string; bonus?: [string[], string[]]; modifier?: string } = {}) {
  const f0 = FIGHTERS[seed % FIGHTERS.length].id;
  const f1 = FIGHTERS[(seed * 3 + 1) % FIGHTERS.length].id;
  const mod = opts.modifier ? MODIFIERS.find((m) => m.id === opts.modifier)!.modifier : undefined;
  const rec = runMatch(
    { fighterId: f0, bonusCards: opts.bonus?.[0] },
    { fighterId: f1, bonusCards: opts.bonus?.[1] },
    { profiles: [SIM_PROFILE, SIM_PROFILE], seed, modifier: mod, arenaId: opts.arena },
  );
  const log: MatchLog = { rounds: rec.history };
  const replay = replayFromMatch(rec.final, log, { mode: 'cpu', difficulty: 'hard', modifier: opts.modifier ?? null });
  return { rec, log, replay };
}

// These play whole AI matches, which takes a few seconds when the full suite runs in parallel.
describe('replays', { timeout: 30000 }, () => {
  it('rebuild the same match from the plans alone', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const arena = ARENAS[seed % ARENAS.length].id;
      const { rec, replay } = playOut(seed, { arena });
      if (rec.timedOut) continue;
      const run = runReplay(replay)!;
      expect(run).not.toBeNull();
      expect(run.outcome).toEqual(rec.final.outcome);
      expect(run.states.at(-1)).toEqual(rec.final);
    }
  });

  it('survive encoding and decoding', () => {
    const bonus: [string[], string[]] = [BONUS_CARD_IDS.slice(0, 3), BONUS_CARD_IDS.slice(3, 5)];
    const { replay } = playOut(7, { arena: 'pillars', bonus, modifier: 'glass' });
    const back = decodeReplay(encodeReplay(replay))!;
    expect(back).toEqual({ ...replay, stale: false });
    expect(runReplay(back)!.outcome).toEqual(runReplay(replay)!.outcome);
  });

  it('keep the mode, difficulty and daily date', () => {
    const { replay } = playOut(3);
    for (const [mode, difficulty] of [['hotseat', null], ['tournament', 'expert'], ['daily', 'hard']] as const) {
      const r: Replay = { ...replay, mode, difficulty, date: mode === 'daily' ? '2026-11-12' : null };
      expect(decodeReplay(encodeReplay(r))).toMatchObject({ mode, difficulty, date: r.date });
    }
  });

  it('are short enough for a link', () => {
    const { replay } = playOut(5, { bonus: [BONUS_CARD_IDS.slice(0, 3), BONUS_CARD_IDS.slice(3, 6)] });
    const long: Replay = { ...replay, rounds: Array.from({ length: 30 }, (_, k) => replay.rounds[k % replay.rounds.length]) };
    const code = encodeReplay(long);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    // 30 rounds plus three bonus cards each still fits comfortably in a chat message.
    expect(code.length).toBeLessThan(320);
  });

  it('reject damaged codes and unknown content', () => {
    const code = encodeReplay(playOut(2).replay);
    expect(decodeReplay('')).toBeNull();
    expect(decodeReplay('not a code!')).toBeNull();
    expect(decodeReplay(code.slice(0, 10))).toBeNull();
    // Version byte changed.
    expect(decodeReplay('Ag' + code.slice(2))).toBeNull();
    const unknown = { ...playOut(2).replay, fighters: ['nobody', 'cinder'] as [string, string] };
    expect(() => encodeReplay(unknown)).toThrow();
  });

  it('refuse to play plans that are no longer legal', () => {
    const { replay } = playOut(4);
    const broken: Replay = { ...replay, rounds: [[['up', 'up', 'up'], ['up', 'up', 'up']] as [Plan, Plan], ...replay.rounds] };
    expect(runReplay(broken)).toBeNull();
    // A match that never finishes is not a replay either.
    expect(runReplay({ ...replay, rounds: replay.rounds.slice(0, 1) })).toBeNull();
  });

  it('notice when the content has changed since recording', () => {
    const { replay } = playOut(6);
    const code = encodeReplay(replay);
    const vex = CARDS.vexHex;
    const old = vex.damage;
    vex.damage = (old ?? 0) + 5;
    try {
      expect(decodeReplay(code)!.stale).toBe(true);
    } finally {
      vex.damage = old;
    }
    expect(decodeReplay(code)!.stale).toBe(false);
    expect(contentStamp()).toBeGreaterThanOrEqual(0);
  });

  it('feed the battle screen the recorded plans round by round', async () => {
    const { replay } = playOut(8);
    const src = new ReplayPlanSource(replay.rounds);
    const state = { ...replayStart(replay), round: 2 } as MatchState;
    expect(await src.requestPlan(state, 1)).toEqual(replay.rounds[1][1]);
  });

  it('are found in #replay= links', () => {
    expect(replayCodeFromHash('#replay=AbC-_9')).toBe('AbC-_9');
    expect(replayCodeFromHash('#replay=')).toBeNull();
    expect(replayCodeFromHash('#other=1')).toBeNull();
  });
});

describe('match stats', { timeout: 30000 }, () => {
  it('track life, damage and highlights consistently', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { rec, log, replay } = playOut(seed);
      const s = matchStats(replayStart(replay), log);
      expect(s.rounds).toBe(rec.rounds);
      for (const i of [0, 1]) {
        expect(s.lives[i]).toHaveLength(rec.rounds + 1);
        expect(s.lives[i].at(-1)).toBe(rec.final.players[i].life);
        // Damage per card adds up to the seat's total.
        expect(s.damageByCard[i].reduce((n, r) => n + r.damage, 0)).toBe(s.damageDealt[i]);
        expect(s.cardsPlayed[i]).toBeLessThanOrEqual(rec.rounds * 3);
      }
      // Every hit and counter is counted (traps and burns on top).
      const hits = log.rounds.flatMap((r) => r.result.steps).reduce((n, st) => n + st.players[1].damageTaken + st.players[0].counterTaken, 0);
      expect(s.damageDealt[0]).toBeGreaterThanOrEqual(hits);
      if (s.biggestHit) expect(s.biggestHit.damage).toBe(Math.max(...log.rounds.flatMap((r) => r.result.steps.flatMap((st) => st.players.map((p) => p.damageTaken)))));
      expect(s.trades).toHaveLength(rec.rounds);
      expect([...tradeRow(s.trades)]).toHaveLength(rec.rounds);
    }
  });

  it('spot a dodge and credit the hit to the card', () => {
    const start = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' }, {}, 'quarters');
    // Face to face: Cinder jabs the row in front; Marin steps up out of it, then walks into the second jab.
    start.players[0].pos = { r: 1, c: 1 };
    start.players[1].pos = { r: 1, c: 2 };
    const plans: [Plan, Plan] = [
      ['cinderJab', 'up', 'guard'],
      ['up', 'focus', 'guard'],
    ];
    const result = resolveRound(start, plans);
    const s = matchStats(start, { rounds: [{ plans, result }] });
    expect(result.steps[0].players[1].hit).toBe('miss');
    expect(s.bestDodge).toMatchObject({ seat: 1, card: 'cinderJab', damage: 25, round: 1 });
    expect(s.cardsPlayed).toEqual([3, 3]);
    expect(s.trades).toEqual(['even']);
  });

  it('give each round a square for sharing', () => {
    expect(tradeRow(['win', 'loss', 'even'])).toBe('🟩🟥⬜');
  });
});

describe('recent matches', () => {
  beforeEach(() => {
    setStorageBackend(memoryStorage());
    resetProfile();
  });

  it('keep the newest few, newest first', () => {
    for (let i = 0; i < RECENT_LIMIT + 3; i++) recordRecent(`code${i}`, i);
    const list = recentMatches();
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toEqual({ code: `code${RECENT_LIMIT + 2}`, at: RECENT_LIMIT + 2 });
  });

  it('start empty for profiles saved before they existed', () => {
    const store = memoryStorage();
    setStorageBackend(store);
    const old = { version: 2, collection: ['riposte'], loadout: [], tournaments: {}, stats: {}, achievements: {}, daily: { lastWin: null, streak: 0, best: 0, results: {} }, tutorialDone: true };
    store.setItem('fliptap.profile.v2', JSON.stringify(old));
    expect(profile().recent).toEqual([]);
    expect(profile().collection).toEqual(['riposte']);
    recordRecent('abc', 1);
    expect(JSON.parse(store.getItem('fliptap.profile.v2')!).recent).toEqual([{ code: 'abc', at: 1 }]);
  });
});
