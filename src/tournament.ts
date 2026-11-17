import { BALANCE } from './content/balance';
import { BONUS_CARD_IDS, FIGHTERS } from './content/cards';
import { hashString, Rng } from './engine/rng';
import { ladder } from './meta/profile';

/** Rivals in a fixed order: every other fighter, starting after you in the roster. */
export function rivalsFor(fighterId: string): string[] {
  const i = FIGHTERS.findIndex((f) => f.id === fighterId);
  return [...FIGHTERS.slice(i + 1), ...FIGHTERS.slice(0, i)].map((f) => f.id);
}

/** The next rival on this fighter's ladder, or null once it's complete. */
export function currentRival(fighterId: string): string | null {
  const rivals = rivalsFor(fighterId);
  const { wins } = ladder(fighterId);
  return wins < rivals.length ? rivals[wins] : null;
}

/**
 * Later rivals bring more bonus cards (one per win so far, up to the slot limit). Each spot on a
 * fighter's ladder always brings the same cards, so a rival can be learned, and retrying a loss
 * can't fish for an easier draw.
 */
export function rivalBonus(fighterId: string, wins: number): string[] {
  return new Rng(hashString(`rival:${fighterId}:${wins}`)).shuffle([...BONUS_CARD_IDS]).slice(0, Math.min(wins, BALANCE.bonusSlots));
}
