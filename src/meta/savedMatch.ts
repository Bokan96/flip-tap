import { arenaState } from '../content/arenas';
import { getCard, getFighter } from '../content/cards';
import type { Difficulty } from '../engine/ai';
import type { MatchLog, MatchState, Plan } from '../engine/types';
import { readJson, removeKey, writeJson } from './storage';

/**
 * The match in progress, saved at the start of every round's planning so an accidental reload
 * (or closing the app) can pick up where it left off. Plans for the current round are never
 * saved, so hot-seat secrets stay secret.
 */
export interface SavedMatch {
  version: 1;
  mode: 'cpu' | 'hotseat' | 'tournament' | 'daily';
  fighters: [string, string];
  difficulty: Difficulty | null;
  /** Tournament: the player's fighter. Daily: the challenge date. Otherwise null. */
  context: string | null;
  state: MatchState;
  lastPlans: [Plan, Plan] | null;
  log: MatchLog;
}

const KEY = 'fliptap.match';

export function saveMatch(m: SavedMatch): void {
  writeJson(KEY, m);
}

export function clearSavedMatch(): void {
  removeKey(KEY);
}

/** The saved match, or null if there is none (or it no longer fits the current content). */
export function loadSavedMatch(): SavedMatch | null {
  const m = readJson<SavedMatch>(KEY);
  if (!m || m.version !== 1 || !m.state || m.state.outcome) return null;
  try {
    m.state.arena ??= arenaState('quarters'); // saved before arenas existed (played on 3×4)
    m.state.players.forEach((p, i) => {
      getFighter(p.fighterId);
      p.deck.forEach(getCard);
      p.spent ??= [];
      // Saved when a hex was only on/off (its damage came from a passive): give it the strongest
      // hex the opponent's cards put on now. Saved before hexes existed: none.
      const old = p as typeof p & { hexed?: boolean };
      if (typeof p.hex !== 'number') {
        const foe = m.state.players[i === 0 ? 1 : 0];
        p.hex = old.hexed ? Math.max(0, ...foe.deck.map((id) => getCard(id).hex ?? 0)) : 0;
      }
      delete old.hexed;
    });
    return m;
  } catch {
    clearSavedMatch();
    return null;
  }
}
