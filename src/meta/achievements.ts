import { ACHIEVEMENTS, type AchievementDef } from '../content/achievements';
import { BONUS_CARD_IDS, FIGHTERS } from '../content/cards';
import type { Difficulty } from '../engine/ai';
import type { MatchLog, MatchOutcome } from '../engine/types';
import { profile, save, type MatchMode, type Profile } from './profile';

/** What happened in a finished match, from the local player's (seat 0) point of view. */
export interface MatchFacts {
  mode: MatchMode;
  /** CPU difficulty, or null when there was no CPU. */
  difficulty: Difficulty | null;
  outcome: MatchOutcome;
  log: MatchLog;
}

const ME = 0;
const THEM = 1;

/** Achievements earned by this match. Hot-seat and the tutorial don't count. */
export function matchAchievements(m: MatchFacts): string[] {
  if (m.mode === 'hotseat' || m.mode === 'tutorial') return [];
  const out: string[] = [];
  const won = m.outcome.winner === ME;
  const steps = m.log.rounds.flatMap((r) => r.result.steps);
  const last = steps[steps.length - 1];
  const perRound = (test: (s: (typeof steps)[number]) => boolean) => m.log.rounds.some((r) => r.result.steps.filter(test).length >= 3);

  if (won) out.push('firstWin');
  if (won && steps.every((s) => s.players[ME].damageTaken + s.players[ME].counterTaken === 0)) out.push('untouchable');
  if (perRound((s) => s.players[ME].hit === 'miss')) out.push('cleanRead');
  if (perRound((s) => s.players[THEM].hit === 'hit' || s.players[THEM].hit === 'guard')) out.push('bully');
  if (steps.some((s) => s.players[THEM].damageTaken + s.players[THEM].counterTaken >= 60)) out.push('overkill');
  if (won && last && last.players[ME].life <= 10) out.push('lastStand');
  if (steps.reduce((sum, s) => sum + s.players[ME].drained, 0) >= 50) out.push('thief');
  if (won && last && last.players[THEM].counterTaken > 0) out.push('payback');
  if (won && m.difficulty === 'hard') out.push('hardWay');
  return out;
}

/** Achievements that depend on long-term progress rather than a single match. */
export function profileAchievements(p: Profile): string[] {
  const out: string[] = [];
  const champions = FIGHTERS.filter((f) => p.tournaments[f.id]?.champion).length;
  if (champions > 0) out.push('champion');
  if (champions === FIGHTERS.length) out.push('grandChampion');
  if (p.daily.best >= 3) out.push('dailyHabit');
  if (BONUS_CARD_IDS.every((id) => p.collection.includes(id))) out.push('collector');
  return out;
}

/** Unlock anything newly earned and return it (for the "achievement unlocked" toasts). */
export function unlockAchievements(m: MatchFacts | null): AchievementDef[] {
  const p = profile();
  const earned = [...(m ? matchAchievements(m) : []), ...profileAchievements(p)];
  const fresh = earned.filter((id) => !p.achievements[id]);
  for (const id of fresh) p.achievements[id] = Date.now();
  if (fresh.length) save();
  return ACHIEVEMENTS.filter((a) => fresh.includes(a.id));
}
