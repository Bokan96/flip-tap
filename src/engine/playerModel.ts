import type { MatchLog, MatchState, Plan, Seat } from './types';

/** One past round as the CPU remembers it. */
export interface RoundRecord {
  plans: [Plan, Plan];
  /** Both fighters' life at the start of the round. */
  life: [number, number];
}

/** Compact match history for the CPU (small enough to send to a worker every round). */
export function historyFromLog(log: MatchLog | undefined, state: MatchState): RoundRecord[] {
  if (!log) return [];
  let life: [number, number] = [state.players[0].lifeMax, state.players[1].lifeMax];
  return log.rounds.map((r) => {
    const rec: RoundRecord = { plans: r.plans, life };
    const ps = r.result.state.players;
    life = [ps[0].life, ps[1].life];
    return rec;
  });
}

/** What the CPU has learned about one player's habits during this match. */
export interface PlayerModel {
  /** How much the habits can be trusted, 0..1 (grows with the rounds seen). */
  confidence: number;
  /** Log-likelihood-style weight of the player choosing `plan` now (higher = more typical). */
  weight(plan: Plan): number;
}

/** Recent rounds count more: people change their habits. */
const DECAY = 0.85;
/** "Low" life, where many players start guarding and healing. */
const LOW = 0.4;
/** Rounds of history before the model can be fully trusted. */
const FULL_TRUST = 6;
/** Average gain (in nats per card) over guessing at random that counts as "very predictable". */
const PREDICTABLE = 0.8;

/**
 * Read `seat`'s habits from the match so far: which cards they like in each step,
 * which cards they like overall, and what they do when their life is low.
 */
export function readPlayer(history: RoundRecord[], seat: Seat, state: MatchState): PlayerModel | null {
  if (history.length < 2) return null;
  const lifeMax = state.players[seat].lifeMax;
  const perSlot = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const overall = new Map<string, number>();
  const whenLow = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, w: number) => m.set(id, (m.get(id) ?? 0) + w);
  let lowRounds = 0;
  history.forEach((h, i) => {
    const w = DECAY ** (history.length - 1 - i);
    const low = h.life[seat] <= lifeMax * LOW;
    if (low) lowRounds++;
    h.plans[seat].forEach((id, slot) => {
      if (perSlot[slot]) add(perSlot[slot], id, w);
      add(overall, id, w);
      if (low) add(whenLow, id, w);
    });
  });
  const nowLow = lowRounds > 0 && state.players[seat].life <= lifeMax * LOW;
  return {
    confidence: Math.min(1, history.length / FULL_TRUST) * Math.min(1, predictability(history, seat, state.players[seat].deck) / PREDICTABLE),
    weight(plan: Plan): number {
      let w = 0;
      plan.forEach((id, slot) => {
        const n = (perSlot[slot]?.get(id) ?? 0) + 0.5 * (overall.get(id) ?? 0) + (nowLow ? 2 * (whenLow.get(id) ?? 0) : 0);
        w += Math.log(1 + n);
      });
      return w;
    },
  };
}

/**
 * How well "they play the cards they usually play in that step" would have predicted this player's
 * past rounds, compared with guessing at random: the average log gain per card (0 = no better than
 * chance). Varied players (and the other CPUs) score near 0, so their "habits" are ignored.
 */
export function predictability(history: RoundRecord[], seat: Seat, deck: string[]): number {
  const perSlot = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const overall = new Map<string, number>();
  let gain = 0;
  let cards = 0;
  history.forEach((h, i) => {
    const plan = h.plans[seat];
    if (i >= 1) {
      plan.forEach((id, slot) => {
        const counts = perSlot[slot];
        if (!counts) return;
        const n = (c: string) => 1 + (counts.get(c) ?? 0) + 0.5 * (overall.get(c) ?? 0);
        const total = deck.reduce((sum, c) => sum + n(c), 0);
        gain += Math.log((n(id) / total) * deck.length);
        cards++;
      });
    }
    plan.forEach((id, slot) => {
      perSlot[slot]?.set(id, (perSlot[slot].get(id) ?? 0) + 1);
      overall.set(id, (overall.get(id) ?? 0) + 1);
    });
  });
  return cards ? Math.max(0, gain / cards) : 0;
}
