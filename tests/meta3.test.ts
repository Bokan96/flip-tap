import { beforeEach, describe, expect, it } from 'vitest';
import { BONUS_CARD_IDS, FIGHTERS } from '../src/content/cards';
import type { MatchupTable } from '../src/content/matchups';
import { threatArea } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { Pos } from '../src/engine/types';
import { dailyChallenge, fairPairs } from '../src/meta/daily';
import {
  claimReward,
  dailyWonIn,
  grantRandomBonus,
  ladder,
  pendingReward,
  profile,
  recordDaily,
  recordLadderWin,
  resetLadder,
  resetProfile,
  REWARD_CHOICES,
  startDaily,
} from '../src/meta/profile';
import { memoryStorage, setStorageBackend, type StorageBackend } from '../src/meta/storage';
import { rivalBonus } from '../src/tournament';

let store: StorageBackend;
beforeEach(() => {
  store = memoryStorage();
  setStorageBackend(store);
  resetProfile();
});

/** Drop the in-memory profile and read it back from storage, as after a reload. */
function reload(): void {
  const saved = store.getItem('fliptap.profile.v2');
  resetProfile();
  if (saved) store.setItem('fliptap.profile.v2', saved);
}

describe('tournament', () => {
  it('each ladder spot always brings the same rival cards', () => {
    expect(rivalBonus('cinder', 2)).toEqual(rivalBonus('cinder', 2));
    expect(rivalBonus('cinder', 0)).toEqual([]);
    expect(rivalBonus('cinder', 5)).toHaveLength(3);
    const spots = FIGHTERS.flatMap((f) => [1, 2, 3].map((w) => rivalBonus(f.id, w).join()));
    expect(new Set(spots).size).toBeGreaterThan(spots.length / 2);
  });

  it('a win offers a choice of bonus cards, kept until one is taken', () => {
    const r = recordLadderWin('zephyr', 8, 'hard');
    expect(r.card).toBeNull();
    expect(r.offer).toHaveLength(REWARD_CHOICES);
    expect(new Set(r.offer).size).toBe(REWARD_CHOICES);
    expect(pendingReward()).toEqual({ fighterId: 'zephyr', offer: r.offer });
    // Survives a reload, unchanged.
    reload();
    expect(pendingReward()?.offer).toEqual(r.offer);
    // Only an offered card can be taken.
    const other = BONUS_CARD_IDS.find((id) => !r.offer.includes(id))!;
    expect(claimReward(other)).toBe(false);
    expect(claimReward(r.offer[1])).toBe(true);
    expect(profile().collection).toEqual([r.offer[1]]);
    expect(profile().loadout).toEqual([r.offer[1]]);
    expect(pendingReward()).toBeNull();
    expect(claimReward(r.offer[0])).toBe(false);
  });

  it('gives the last card left, and nothing once the collection is complete', () => {
    for (let i = 0; i < BONUS_CARD_IDS.length - 1; i++) grantRandomBonus();
    const last = recordLadderWin('zephyr', 8);
    expect(last.card).not.toBeNull();
    expect(last.offer).toEqual([]);
    expect(pendingReward()).toBeNull();
    expect(profile().collection).toHaveLength(BONUS_CARD_IDS.length);
    const none = recordLadderWin('zephyr', 8);
    expect(none.card).toBeNull();
    expect(none.offer).toEqual([]);
  });

  it('the champion star keeps the hardest difficulty a whole ladder was won on', () => {
    // A run counts at the easiest difficulty used in it.
    for (let i = 0; i < 4; i++) recordLadderWin('volta', 5, i === 2 ? 'normal' : 'expert');
    expect(recordLadderWin('volta', 5, 'expert').champion).toBe(true);
    expect(ladder('volta').best).toBe('normal');
    // A harder run later raises it; an easier one doesn't lower it.
    resetLadder('volta');
    for (let i = 0; i < 5; i++) recordLadderWin('volta', 5, 'hard');
    expect(ladder('volta').best).toBe('hard');
    resetLadder('volta');
    for (let i = 0; i < 5; i++) recordLadderWin('volta', 5, 'easy');
    expect(ladder('volta')).toMatchObject({ champion: true, best: 'hard' });
  });
});

describe('daily challenge', () => {
  const table = (from: string): MatchupTable => {
    const ids = FIGHTERS.map((f) => f.id);
    // Pretend only pairings where the first fighter comes earlier in the roster are fair.
    const scores = Object.fromEntries(ids.map((a, i) => [a, Object.fromEntries(ids.filter((b) => b !== a).map((b) => [b, ids.indexOf(b) > i ? 50 : 80]))]));
    return { from, band: [40, 60], scores };
  };

  it('days before the first matchup table keep the draw they always had', () => {
    const tables = [table('2027-01-01')];
    for (const d of ['2026-11-11', '2026-12-31']) expect(dailyChallenge(d, tables)).toEqual(dailyChallenge(d, []));
    expect(fairPairs('2026-12-31', tables)).toEqual([]);
  });

  it('from a table’s date on, only pairings inside its band are drawn', () => {
    const tables = [table('2027-01-01')];
    const ids = FIGHTERS.map((f) => f.id);
    const days = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
    const seen = new Set<string>();
    for (const d of days) {
      const c = dailyChallenge(d, tables);
      expect(ids.indexOf(c.fighter)).toBeLessThan(ids.indexOf(c.rival));
      seen.add(`${c.fighter}-${c.rival}`);
    }
    expect(seen.size).toBeGreaterThan(20); // still plenty of variety
  });

  it('remembers which attempt won the day', () => {
    startDaily('2026-11-20');
    recordDaily('loss', '2026-11-20');
    startDaily('2026-11-20');
    recordDaily('win', '2026-11-20');
    startDaily('2026-11-20');
    recordDaily('win', '2026-11-20'); // a later win doesn't change it
    expect(dailyWonIn('2026-11-20')).toBe(2);
    startDaily('2026-11-21');
    recordDaily('win', '2026-11-21');
    expect(dailyWonIn('2026-11-21')).toBe(1);
    expect(dailyWonIn('2026-11-22')).toBeNull();
  });

  it('an older profile without attempts still loads', () => {
    store.setItem('fliptap.profile.v2', JSON.stringify({ version: 2, daily: { lastWin: null, streak: 0, best: 0, results: {} } }));
    reload();
    startDaily('2026-11-20');
    expect(profile().daily.attempts['2026-11-20']).toBe(1);
  });
});

describe('enemy reach', () => {
  const has = (list: Pos[], r: number, c: number) => list.some((q) => q.r === r && q.c === c);

  it('marks what affordable attacks hit now, and more after one step', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'volta' }, {}, 'classic');
    const volta = s.players[1];
    volta.pos = { r: 1, c: 3 };
    volta.facing = -1;
    volta.energy = 10; // Zap (10) and Static Field / Short Circuit (10), not Thunderclap (50)
    const { now, reach } = threatArea(s, 1);
    expect(has(now, 1, 2)).toBe(true); // Zap: the square in front
    expect(has(now, 1, 4)).toBe(true); // Static Field covers all around
    // After a step up, Zap would hit (0, 2), which isn't covered from where Volta stands.
    expect(has(now, 0, 2) || has(reach, 0, 2)).toBe(true);
    // Nothing is in both lists.
    expect(reach.some((q) => has(now, q.r, q.c))).toBe(false);
    // Out of energy: no reach at all.
    volta.energy = 0;
    expect(threatArea(s, 1)).toEqual({ now: [], reach: [] });
  });

  it('leaves out Ferro’s spent shots', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'ferro' }, {}, 'classic');
    const ferro = s.players[1];
    ferro.energy = 100;
    const all = threatArea(s, 1).now.length;
    ferro.spent = ferro.deck.filter((id) => id.startsWith('ferro') && id !== 'ferroReload');
    expect(threatArea(s, 1).now.length).toBeLessThan(all);
  });
});
