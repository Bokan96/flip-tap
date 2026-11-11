import { choosePlan, type Difficulty } from './ai';
import type { RoundRecord } from './playerModel';
import { Rng } from './rng';
import type { MatchState, Seat } from './types';

/** A CPU decision request (see net/transport.ts). The search runs here so the page never freezes. */
export interface AiRequest {
  id: number;
  state: MatchState;
  seat: Seat;
  difficulty: Difficulty;
  history: RoundRecord[];
  seed: number;
}

// Typed by hand: the project's DOM types and the webworker lib can't be loaded together.
const scope = self as unknown as { onmessage: ((e: MessageEvent<AiRequest>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, state, seat, difficulty, history, seed } = e.data;
  try {
    scope.postMessage({ id, plan: choosePlan(state, seat, difficulty, new Rng(seed), history) });
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
