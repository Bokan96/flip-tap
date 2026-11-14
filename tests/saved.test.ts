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

  it('turns an old on/off hex into the value of the hex the opponent can cast', () => {
    const s = createMatch({ fighterId: 'briar' }, { fighterId: 'vex' });
    const old = (p: object, hexed: boolean) => {
      const { hex: _, ...rest } = p as { hex: number };
      return { ...rest, hexed };
    };
    // Saved before hexes carried a value: Briar hexed by Vex (Hex Bolt is worth 20), Vex not hexed.
    const players = [old(s.players[0], true), old(s.players[1], false)] as unknown as typeof s.players;
    saveMatch({ ...midMatch(), fighters: ['briar', 'vex'], state: { ...s, players }, lastPlans: null, log: { rounds: [] } });
    const back = loadSavedMatch()!;
    expect(back.state.players.map((p) => p.hex)).toEqual([20, 0]);
    expect('hexed' in back.state.players[0]).toBe(false);
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
