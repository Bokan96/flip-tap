import { choosePlanWith, type AiProfile } from './ai';
import { Rng } from './rng';
import { resolveRound } from './rules';
import { createMatch, type MatchModifier, type SeatConfig } from './setup';
import type { MatchLog, MatchOutcome, MatchState, Plan } from './types';

export interface MatchRecord {
  /** A match that hits the round limit counts as a draw. */
  outcome: MatchOutcome;
  timedOut: boolean;
  rounds: number;
  history: MatchLog['rounds'];
  final: MatchState;
}

export interface RunOptions {
  profiles: [AiProfile, AiProfile];
  seed: number;
  maxRounds?: number;
  modifier?: MatchModifier;
  arenaId?: string;
}

/** Play a whole match between two AIs without any UI. Deterministic for a given seed. */
export function runMatch(p0: SeatConfig, p1: SeatConfig, opts: RunOptions): MatchRecord {
  const rng = new Rng(opts.seed);
  const maxRounds = opts.maxRounds ?? 40;
  let state = createMatch(p0, p1, opts.modifier, opts.arenaId);
  const history: MatchRecord['history'] = [];
  while (!state.outcome && state.round <= maxRounds) {
    const plans: [Plan, Plan] = [choosePlanWith(state, 0, opts.profiles[0], rng), choosePlanWith(state, 1, opts.profiles[1], rng)];
    const result = resolveRound(state, plans);
    history.push({ plans, result });
    state = result.state;
  }
  return {
    outcome: state.outcome ?? { winner: null, draw: true },
    timedOut: !state.outcome,
    rounds: history.length,
    history,
    final: state,
  };
}
