import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import { fastSimulate, type FastResult } from './fastsim';
import { Rng } from './rng';
import { planEnergyTrace } from './rules';
import type { MatchState, Plan, PlayerState, Seat } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface DifficultyProfile {
  /** How many of the opponent's likely plans to test against. */
  opponentSamples: number;
  /** Softmax temperature over plan scores; higher = more random. */
  temperature: number;
  /** Weight of the worst case vs. the average case. */
  caution: number;
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { opponentSamples: 6, temperature: 18, caution: 0 },
  normal: { opponentSamples: 16, temperature: 5, caution: 0.25 },
  hard: { opponentSamples: 32, temperature: 1.5, caution: 0.35 },
};

/** Every legal plan for a player (ordered, affordable, unique cards). */
export function enumeratePlans(player: PlayerState): Plan[] {
  const out: Plan[] = [];
  const deck = player.deck;
  const slots = BALANCE.slotsPerRound;
  const cur: string[] = [];
  const rec = (energy: number) => {
    if (cur.length === slots) {
      out.push([...cur]);
      return;
    }
    for (const id of deck) {
      if (BALANCE.uniqueCardsPerPlan && cur.includes(id)) continue;
      const e = energy + getCard(id).cost;
      if (e < 0) continue;
      cur.push(id);
      rec(Math.min(e, player.energyMax));
      cur.pop();
    }
  };
  rec(player.energy);
  return out;
}

/** Score a simulated round from `seat`'s point of view. */
function evaluate(r: FastResult, seat: Seat): number {
  const other = seat === 0 ? 1 : 0;
  if (r.outcome === seat) return 1000;
  if (r.outcome === 2) return -150;
  if (r.outcome !== -1) return -1000;
  return r.life[seat] - r.life[other] + 0.2 * (r.energy[seat] - r.energy[other]);
}

function scorePlans(state: MatchState, seat: Seat, mine: Plan[], theirs: Plan[], caution: number): number[] {
  return mine.map((plan) => {
    let sum = 0;
    let worst = Infinity;
    for (const opp of theirs) {
      const r = seat === 0 ? fastSimulate(state, plan, opp) : fastSimulate(state, opp, plan);
      const v = evaluate(r, seat);
      sum += v;
      if (v < worst) worst = v;
    }
    const avg = sum / theirs.length;
    return (1 - caution) * avg + caution * worst;
  });
}

function sample<T>(items: T[], n: number, rng: Rng): T[] {
  if (items.length <= n) return items;
  return rng.shuffle([...items]).slice(0, n);
}

function softmaxPick(scores: number[], temperature: number, rng: Rng): number {
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Pick a plan for `seat`. Two levels of reasoning: first guess which plans the
 * opponent is likely to choose (by testing them against a sample of ours), then
 * pick our plan against those likely replies.
 */
export function choosePlan(state: MatchState, seat: Seat, difficulty: Difficulty, rng: Rng): Plan {
  const profile = PROFILES[difficulty];
  const other: Seat = seat === 0 ? 1 : 0;
  const mine = enumeratePlans(state.players[seat]);
  const theirs = enumeratePlans(state.players[other]);
  if (mine.length === 0) throw new Error('No legal plan available.');

  // Level 1: which opponent plans look strong against a random sample of ours?
  const probe = sample(mine, 12, rng);
  const theirScores = scorePlans(state, other, theirs, probe, 0);
  const ranked = theirs.map((p, i) => ({ p, s: theirScores[i] })).sort((a, b) => b.s - a.s);
  const likely = ranked.slice(0, Math.ceil(profile.opponentSamples * 0.75)).map((x) => x.p);
  const wildcards = sample(theirs, Math.floor(profile.opponentSamples * 0.25), rng);
  const replies = [...likely, ...wildcards];

  // Level 2: best plan against the likely replies.
  const scores = scorePlans(state, seat, mine, replies, profile.caution);
  return mine[softmaxPick(scores, profile.temperature, rng)];
}

/** Sanity helper for tests and UI. */
export function isAffordable(player: PlayerState, plan: Plan): boolean {
  return planEnergyTrace(player.energy, player.energyMax, plan) !== null;
}
