import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { BONUS_CARD_IDS, FIGHTERS } from '../src/content/cards';
import { resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchLog, MatchState, Plan } from '../src/engine/types';
import { matchAchievements, profileAchievements, unlockAchievements } from '../src/meta/achievements';
import { dailyChallenge } from '../src/meta/daily';
import {
  dailyStreak,
  grantRandomBonus,
  ladder,
  loadout,
  profile,
  recordDaily,
  recordLadderWin,
  recordMatch,
  resetProfile,
  toggleLoadout,
} from '../src/meta/profile';
import { memoryStorage, setStorageBackend, type StorageBackend } from '../src/meta/storage';

let store: StorageBackend;
beforeEach(() => {
  store = memoryStorage();
  setStorageBackend(store);
  resetProfile();
});

/** One-round match log from a hand-made position. */
function oneRound(setup: (s: MatchState) => void, plans: [Plan, Plan], a = 'cinder', b = 'marin'): { log: MatchLog; state: MatchState } {
  const s = createMatch({ fighterId: a }, { fighterId: b });
  setup(s);
  const result = resolveRound(s, plans);
  return { log: { rounds: [{ plans, result }] }, state: result.state };
}

describe('profile', () => {
  it('migrates the old tournament save and tutorial flag', () => {
    store.setItem(
      'fliptap.tournament',
      JSON.stringify({
        cinder: { fighterId: 'cinder', wins: 5, bonus: ['surge', 'renew'] },
        marin: { fighterId: 'marin', wins: 2, bonus: ['renew', 'bulwark', 'notACard'] },
      }),
    );
    store.setItem('fliptap.tutorialDone', '1');
    const p = profile();
    expect(p.collection.sort()).toEqual(['bulwark', 'renew', 'surge']);
    expect(p.loadout).toHaveLength(BALANCE.bonusSlots);
    expect(ladder('cinder')).toEqual({ wins: 5, champion: true });
    expect(ladder('marin')).toEqual({ wins: 2, champion: false });
    expect(p.tutorialDone).toBe(true);
    // Saved as v2 and reloaded from storage.
    resetProfileCacheOnly();
    expect(profile().collection).toHaveLength(3);
  });

  it('limits the loadout to the bonus slots', () => {
    for (let i = 0; i < 5; i++) grantRandomBonus();
    expect(loadout()).toHaveLength(BALANCE.bonusSlots);
    const spare = profile().collection.find((id) => !loadout().includes(id))!;
    expect(toggleLoadout(spare)).toBe(false);
    expect(toggleLoadout(loadout()[0])).toBe(true);
    expect(toggleLoadout(spare)).toBe(true);
    expect(loadout()).toContain(spare);
  });

  it('grants each bonus card once', () => {
    const got = new Set<string>();
    for (let i = 0; i < BONUS_CARD_IDS.length; i++) got.add(grantRandomBonus()!);
    expect(got.size).toBe(BONUS_CARD_IDS.length);
    expect(grantRandomBonus()).toBeNull();
  });

  it('crowns a champion after the last rival', () => {
    for (let i = 0; i < 4; i++) expect(recordLadderWin('zephyr', 5).champion).toBe(false);
    expect(recordLadderWin('zephyr', 5).champion).toBe(true);
    expect(ladder('zephyr').champion).toBe(true);
  });

  it('tracks stats for the local player only', () => {
    const { log } = oneRound((s) => {
      s.players[0].pos = { r: 1, c: 1 };
      s.players[1].pos = { r: 1, c: 2 };
      s.players[1].life = 20;
    }, [['cinderJab', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    recordMatch({ mode: 'cpu', fighterId: 'cinder', outcome: { winner: 0 }, log });
    recordMatch({ mode: 'hotseat', fighterId: 'cinder', outcome: { winner: 1 }, log });
    const s = profile().stats;
    expect(s.matches).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.damageDealt).toBe(25);
    expect(s.byMode.hotseat.played).toBe(1);
    expect(s.cardPlays.cinderJab).toBe(1);
  });
});

describe('daily challenge', () => {
  it('is the same for everyone on a given day and never a mirror match', () => {
    expect(dailyChallenge('2026-11-11')).toEqual(dailyChallenge('2026-11-11'));
    const days = Array.from({ length: 40 }, (_, i) => dailyChallenge(`2026-12-${String((i % 28) + 1).padStart(2, '0')}`));
    for (const d of days) expect(d.fighter).not.toBe(d.rival);
    expect(new Set(days.map((d) => d.modifier.id)).size).toBeGreaterThan(1);
  });

  it('counts consecutive winning days', () => {
    recordDaily('win', '2026-11-01');
    recordDaily('loss', '2026-11-02');
    recordDaily('win', '2026-11-02');
    recordDaily('win', '2026-11-02');
    expect(dailyStreak('2026-11-02')).toBe(2);
    expect(dailyStreak('2026-11-03')).toBe(2);
    expect(dailyStreak('2026-11-04')).toBe(0);
    recordDaily('win', '2026-11-05');
    expect(dailyStreak('2026-11-05')).toBe(1);
    expect(profile().daily.best).toBe(2);
  });
});

describe('achievements', () => {
  it('first win and untouchable', () => {
    const { log, state } = oneRound((s) => {
      s.players[0].pos = { r: 1, c: 1 };
      s.players[1].pos = { r: 1, c: 2 };
      s.players[1].life = 40;
    }, [['cinderBlaze', 'guard', 'up'], ['focus', 'guard', 'up']]);
    const got = matchAchievements({ mode: 'cpu', difficulty: 'hard', outcome: state.outcome!, log });
    expect(got).toEqual(expect.arrayContaining(['firstWin', 'untouchable', 'hardWay']));
    expect(got).not.toContain('overkill');
    expect(matchAchievements({ mode: 'hotseat', difficulty: null, outcome: state.outcome!, log })).toEqual([]);
  });

  it('overkill and payback', () => {
    // Flare (40) on a hexed target: +10 for the hex, +10 for Vex's Malice.
    const crush = oneRound((s) => {
      s.players[0].pos = s.players[1].pos = { r: 1, c: 1 };
      s.players[1].hexed = true;
    }, [['vexFlare', 'guard', 'up'], ['focus', 'guard', 'up']], 'vex', 'marin');
    expect(matchAchievements({ mode: 'cpu', difficulty: 'easy', outcome: crush.state.outcome ?? { winner: null, draw: true }, log: crush.log })).toContain('overkill');

    const counter = oneRound((s) => {
      s.players[0].pos = { r: 1, c: 2 };
      s.players[1].pos = { r: 1, c: 1 };
      s.players[1].life = 15;
    }, [['basaltSpikes', 'guard', 'up'], ['cinderJab', 'guard', 'up']], 'basalt', 'cinder');
    expect(counter.state.outcome).toEqual({ winner: 0 });
    expect(matchAchievements({ mode: 'cpu', difficulty: 'easy', outcome: counter.state.outcome!, log: counter.log })).toContain('payback');
  });

  it('progress achievements unlock once', () => {
    for (const id of BONUS_CARD_IDS) profile().collection.push(id);
    for (const f of FIGHTERS) profile().tournaments[f.id] = { wins: 5, champion: true };
    expect(profileAchievements(profile())).toEqual(expect.arrayContaining(['collector', 'champion', 'grandChampion']));
    expect(unlockAchievements(null).map((a) => a.id)).toEqual(expect.arrayContaining(['collector', 'grandChampion']));
    expect(unlockAchievements(null)).toEqual([]);
  });
});

/** Drop the in-memory cache but keep what was saved. */
function resetProfileCacheOnly(): void {
  const saved = store.getItem('fliptap.profile.v2');
  resetProfile();
  if (saved) store.setItem('fliptap.profile.v2', saved);
}
