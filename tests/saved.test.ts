import { beforeEach, describe, expect, it } from 'vitest';
import { resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import { clearSavedMatch, loadSavedMatch, saveMatch, type SavedMatch } from '../src/meta/savedMatch';
import { memoryStorage, setStorageBackend } from '../src/meta/storage';

beforeEach(() => setStorageBackend(memoryStorage()));

function midMatch(): SavedMatch {
  const s0 = createMatch({ fighterId: 'ferro' }, { fighterId: 'marin' });
  const plans: [string[], string[]] = [['right', 'ferroSnap', 'guard'], ['left', 'focus', 'guard']];
  const result = resolveRound(s0, plans);
  return {
    version: 1,
    mode: 'cpu',
    fighters: ['ferro', 'marin'],
    difficulty: 'hard',
    context: null,
    state: result.state,
    lastPlans: plans,
    log: { rounds: [{ plans, result }] },
  };
}

describe('saved match', () => {
  it('round-trips through storage and can be played on', () => {
    saveMatch(midMatch());
    const back = loadSavedMatch()!;
    expect(back.state.round).toBe(2);
    expect(back.state.players[0].spent).toEqual(['ferroSnap']);
    expect(back.log.rounds).toHaveLength(1);
    // The restored state is a normal match state: the next round resolves.
    const next = resolveRound(back.state, [['ferroReload', 'ferroSnap', 'guard'], ['guard', 'focus', 'up']]);
    expect(next.state.round).toBe(3);
  });

  it('is dropped when finished, cleared or no longer matching the content', () => {
    const m = midMatch();
    saveMatch({ ...m, state: { ...m.state, outcome: { winner: 0 } } });
    expect(loadSavedMatch()).toBeNull();
    saveMatch({ ...m, fighters: ['nobody', 'marin'], state: { ...m.state, players: [{ ...m.state.players[0], fighterId: 'nobody' }, m.state.players[1]] } });
    expect(loadSavedMatch()).toBeNull();
    saveMatch(m);
    clearSavedMatch();
    expect(loadSavedMatch()).toBeNull();
  });
});
