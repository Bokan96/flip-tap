import { BONUS_CARD_IDS, FIGHTERS } from './content/cards';
import { Rng, randomSeed } from './engine/rng';

export interface TournamentProgress {
  fighterId: string;
  wins: number;
  bonus: string[];
}

const KEY = 'fliptap.tournament';

/** Rivals in a fixed order: every other fighter, starting after you in the roster. */
export function rivalsFor(fighterId: string): string[] {
  const i = FIGHTERS.findIndex((f) => f.id === fighterId);
  return [...FIGHTERS.slice(i + 1), ...FIGHTERS.slice(0, i)].map((f) => f.id);
}

export function loadAll(): Record<string, TournamentProgress> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, TournamentProgress>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function loadProgress(fighterId: string): TournamentProgress {
  return loadAll()[fighterId] ?? { fighterId, wins: 0, bonus: [] };
}

export function saveProgress(p: TournamentProgress): void {
  const all = loadAll();
  all[p.fighterId] = p;
  saveAll(all);
}

export function resetProgress(fighterId: string): void {
  const all = loadAll();
  delete all[fighterId];
  saveAll(all);
}

export function isChampion(p: TournamentProgress): boolean {
  return p.wins >= rivalsFor(p.fighterId).length;
}

/** Record a win and grant a random unowned bonus card. Returns the new card id, if any. */
export function recordWin(p: TournamentProgress): string | null {
  p.wins += 1;
  const pool = BONUS_CARD_IDS.filter((id) => !p.bonus.includes(id));
  const card = pool.length ? new Rng(randomSeed()).pick(pool) : null;
  if (card) p.bonus.push(card);
  saveProgress(p);
  return card;
}

/** The rival gets as many random bonus cards as you have wins. */
export function rivalBonus(p: TournamentProgress): string[] {
  return new Rng(randomSeed()).shuffle([...BONUS_CARD_IDS]).slice(0, p.wins);
}
