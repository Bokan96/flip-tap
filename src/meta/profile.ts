import { BALANCE } from '../content/balance';
import { BONUS_CARD_IDS, CARDS } from '../content/cards';
import { DIFFICULTIES, type Difficulty } from '../engine/ai';
import { Rng, randomSeed } from '../engine/rng';
import type { MatchLog, MatchOutcome, Seat } from '../engine/types';
import { readJson, readRaw, removeKey, writeJson } from './storage';

/** Everything the game remembers about the player, saved as one versioned JSON blob. */
export interface Profile {
  version: 2;
  /** Bonus cards earned (shared by all fighters). */
  collection: string[];
  /** Equipped bonus cards, at most BALANCE.bonusSlots. */
  loadout: string[];
  /** Tournament ladder progress per fighter. `champion` stays once earned. */
  tournaments: Record<string, LadderRecord>;
  /** A tournament win's reward still to be chosen (1 of the offered cards), kept so a reload can't lose or re-roll it. */
  pendingReward: PendingReward | null;
  stats: Stats;
  /** Achievement id -> time it was unlocked. */
  achievements: Record<string, number>;
  daily: DailyRecord;
  tutorialDone: boolean;
  /** The last few finished matches as replay codes, newest first (see meta/replay.ts). */
  recent: RecentMatch[];
  /** First-time tips already shown in real matches (see ui/battle.ts). */
  tipsSeen: string[];
}

export interface LadderRecord {
  wins: number;
  champion: boolean;
  /** The hardest difficulty a whole ladder was beaten on (absent for older champions). */
  best?: Difficulty;
  /** The easiest difficulty used so far in the current run up the ladder. */
  run?: Difficulty;
}

export interface PendingReward {
  fighterId: string;
  /** Bonus cards to choose one from. */
  offer: string[];
}

/** Bonus cards a tournament win offers to choose from. */
export const REWARD_CHOICES = 3;

export interface RecentMatch {
  code: string;
  /** When it finished (ms since 1970). */
  at: number;
}

export const RECENT_LIMIT = 10;

export interface Stats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  byMode: Record<string, { played: number; won: number }>;
  byFighter: Record<string, { played: number; won: number }>;
  damageDealt: number;
  streak: number;
  bestStreak: number;
  cardPlays: Record<string, number>;
}

export interface DailyRecord {
  /** Date key (YYYY-MM-DD) of the last daily win. */
  lastWin: string | null;
  streak: number;
  best: number;
  results: Record<string, 'win' | 'loss' | 'draw'>;
  /** Matches started per day (date key -> count). */
  attempts: Record<string, number>;
  /** Day (date key) -> the attempt it was first won on. */
  wonIn: Record<string, number>;
}

export type MatchMode = 'cpu' | 'hotseat' | 'tournament' | 'daily' | 'tutorial';

const KEY = 'fliptap.profile.v2';
const V1_RIVALS = 5;
const OLD_TOURNAMENT_KEY = 'fliptap.tournament';
const OLD_TUTORIAL_KEY = 'fliptap.tutorialDone';

function emptyStats(): Stats {
  return { matches: 0, wins: 0, losses: 0, draws: 0, byMode: {}, byFighter: {}, damageDealt: 0, streak: 0, bestStreak: 0, cardPlays: {} };
}

function emptyProfile(): Profile {
  return {
    version: 2,
    collection: [],
    loadout: [],
    tournaments: {},
    pendingReward: null,
    stats: emptyStats(),
    achievements: {},
    daily: { lastWin: null, streak: 0, best: 0, results: {}, attempts: {}, wonIn: {} },
    tutorialDone: false,
    recent: [],
    tipsSeen: [],
  };
}

/** Build a v2 profile from the v1 tournament save and tutorial flag, if they exist. */
function migrate(): Profile {
  const p = emptyProfile();
  const old = readJson<Record<string, { fighterId: string; wins: number; bonus: string[] }>>(OLD_TOURNAMENT_KEY) ?? {};
  for (const t of Object.values(old)) {
    if (!t || typeof t.wins !== 'number') continue;
    for (const id of t.bonus ?? []) if (BONUS_CARD_IDS.includes(id) && !p.collection.includes(id)) p.collection.push(id);
    // v1 had 6 fighters, so 5 wins finished a ladder. Champions keep their badge; newer fighters
    // simply remain on their ladder.
    p.tournaments[t.fighterId] = { wins: t.wins, champion: t.wins >= V1_RIVALS };
  }
  p.loadout = p.collection.slice(0, BALANCE.bonusSlots);
  p.tutorialDone = readRaw(OLD_TUTORIAL_KEY) === '1';
  return p;
}

let cache: Profile | null = null;

export function profile(): Profile {
  if (cache) return cache;
  const saved = readJson<Profile>(KEY);
  if (saved && saved.version === 2) {
    // Fill in anything added since the save was written.
    const blank = emptyProfile();
    cache = { ...blank, ...saved, stats: { ...blank.stats, ...saved.stats }, daily: { ...blank.daily, ...saved.daily } };
  } else {
    cache = migrate();
    save();
  }
  return cache;
}

export function save(): void {
  if (cache) writeJson(KEY, cache);
}

/** Forget everything (also clears the cache, so tests can start fresh). */
export function resetProfile(): void {
  cache = null;
  removeKey(KEY);
  removeKey(OLD_TOURNAMENT_KEY);
  removeKey(OLD_TUTORIAL_KEY);
}

// ---------- tutorial ----------
export const isTutorialDone = () => profile().tutorialDone;
export function setTutorialDone(): void {
  profile().tutorialDone = true;
  save();
}

// ---------- first-time tips ----------
export const tipSeen = (id: string) => profile().tipsSeen.includes(id);
export function markTipSeen(id: string): void {
  if (tipSeen(id)) return;
  profile().tipsSeen.push(id);
  save();
}

// ---------- collection and loadout ----------
export const collection = () => profile().collection;
export const loadout = () => profile().loadout.filter((id) => profile().collection.includes(id));

/** Equip or unequip a bonus card. Returns false if all slots are full. */
export function toggleLoadout(id: string): boolean {
  const p = profile();
  if (p.loadout.includes(id)) p.loadout = p.loadout.filter((x) => x !== id);
  else if (p.loadout.length >= BALANCE.bonusSlots || !p.collection.includes(id)) return false;
  else p.loadout.push(id);
  save();
  return true;
}

/** Bonus cards the player doesn't own yet. */
const unowned = () => BONUS_CARD_IDS.filter((id) => !profile().collection.includes(id));

/** Add a bonus card to the collection (auto-equipped if a slot is free). Doesn't save. */
function addToCollection(card: string): void {
  const p = profile();
  if (p.collection.includes(card)) return;
  p.collection.push(card);
  if (p.loadout.length < BALANCE.bonusSlots) p.loadout.push(card);
}

/** Add a random bonus card the player doesn't own yet (auto-equipped if a slot is free). */
export function grantRandomBonus(rng = new Rng(randomSeed())): string | null {
  const pool = unowned();
  if (!pool.length) return null;
  const card = rng.pick(pool);
  addToCollection(card);
  save();
  return card;
}

// ---------- tournament ladder ----------
export function ladder(fighterId: string): LadderRecord {
  return profile().tournaments[fighterId] ?? { wins: 0, champion: false };
}

const rank = (d: Difficulty) => DIFFICULTIES.indexOf(d);
const easier = (a: Difficulty | undefined, b: Difficulty) => (a && rank(a) < rank(b) ? a : b);
const harder = (a: Difficulty | undefined, b: Difficulty) => (a && rank(a) > rank(b) ? a : b);

/**
 * Record a ladder win at `difficulty`. A finished ladder crowns the fighter champion, at the
 * easiest difficulty used on the way up (the champion badge keeps the hardest such run). The
 * reward: a choice of up to REWARD_CHOICES bonus cards not owned yet, kept as the pending reward
 * until one is claimed (`offer`); with only one card left it is simply given (`card`).
 */
export function recordLadderWin(
  fighterId: string,
  rivals: number,
  difficulty: Difficulty = 'normal',
  rng = new Rng(randomSeed()),
): { card: string | null; offer: string[]; champion: boolean } {
  const p = profile();
  const t = (p.tournaments[fighterId] ??= { wins: 0, champion: false });
  t.wins += 1;
  t.run = easier(t.run, difficulty);
  const finished = t.wins >= rivals;
  if (finished) {
    t.champion = true;
    t.best = harder(t.best, t.run);
  }
  const pool = unowned();
  let card: string | null = null;
  let offer: string[] = [];
  if (pool.length === 1) {
    card = pool[0];
    addToCollection(card);
  } else if (pool.length > 1) {
    offer = rng.shuffle([...pool]).slice(0, REWARD_CHOICES);
    p.pendingReward = { fighterId, offer };
  }
  save();
  return { card, offer, champion: finished };
}

/** The tournament reward waiting to be chosen, if any. */
export const pendingReward = (): PendingReward | null => profile().pendingReward;

/** Take one of the offered cards. False if it isn't on offer (or nothing is pending). */
export function claimReward(card: string): boolean {
  const p = profile();
  if (!p.pendingReward?.offer.includes(card)) return false;
  addToCollection(card);
  p.pendingReward = null;
  save();
  return true;
}

export function resetLadder(fighterId: string): void {
  const t = profile().tournaments[fighterId];
  if (t) {
    t.wins = 0;
    delete t.run;
  }
  save();
}

// ---------- stats ----------
export interface MatchEntry {
  mode: MatchMode;
  /** Fighter played by seat 0 (the local player in single-player modes). */
  fighterId: string;
  outcome: MatchOutcome;
  log: MatchLog;
}

/** Update stats after a match. Hot-seat and tutorial matches only count as played. */
export function recordMatch(e: MatchEntry): void {
  const s = profile().stats;
  const mode = (s.byMode[e.mode] ??= { played: 0, won: 0 });
  mode.played++;
  if (e.mode === 'hotseat' || e.mode === 'tutorial') return save();
  const seat: Seat = 0;
  const won = e.outcome.winner === seat;
  const draw = e.outcome.winner === null;
  s.matches++;
  if (won) s.wins++;
  else if (draw) s.draws++;
  else s.losses++;
  if (won) mode.won++;
  const f = (s.byFighter[e.fighterId] ??= { played: 0, won: 0 });
  f.played++;
  if (won) f.won++;
  s.streak = won ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  for (const r of e.log.rounds) {
    for (const id of r.plans[seat]) s.cardPlays[id] = (s.cardPlays[id] ?? 0) + 1;
    for (const step of r.result.steps) s.damageDealt += step.players[1].damageTaken + step.players[1].counterTaken;
  }
  save();
}

// ---------- recent matches ----------
export const recentMatches = (): RecentMatch[] => profile().recent;

/** Remember a finished match; only the newest RECENT_LIMIT are kept. */
export function recordRecent(code: string, at = Date.now()): void {
  const p = profile();
  p.recent = [{ code, at }, ...p.recent].slice(0, RECENT_LIMIT);
  save();
}

/** Most played card that still exists (cards can be retired between versions). */
export function favouriteCard(): string | null {
  const plays = Object.entries(profile().stats.cardPlays).filter(([id]) => CARDS[id]);
  if (!plays.length) return null;
  return plays.sort((a, b) => b[1] - a[1])[0][0];
}

// ---------- daily challenge ----------
export function dateKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

/** Current streak: still alive if the last win was today or yesterday. */
export function dailyStreak(today = dateKey()): number {
  const d = profile().daily;
  return d.lastWin === today || d.lastWin === previousDay(today) ? d.streak : 0;
}

/** A daily challenge match starts (a fresh one, not a resumed one): one more attempt that day. */
export function startDaily(today = dateKey()): void {
  const d = profile().daily;
  d.attempts[today] = (d.attempts[today] ?? 0) + 1;
  save();
}

/** The attempt the day's challenge was first won on (1 = first try), or null if it wasn't won. */
export function dailyWonIn(today = dateKey()): number | null {
  return profile().daily.wonIn[today] ?? null;
}

export function recordDaily(result: 'win' | 'loss' | 'draw', today = dateKey()): void {
  const d = profile().daily;
  if (result === 'win') {
    d.wonIn[today] ??= Math.max(1, d.attempts[today] ?? 1);
    if (d.results[today] !== 'win') {
      d.streak = d.lastWin === previousDay(today) ? d.streak + 1 : 1;
      d.lastWin = today;
      d.best = Math.max(d.best, d.streak);
    }
    d.results[today] = 'win';
  } else if (!d.results[today]) {
    d.results[today] = result;
  }
  save();
}
