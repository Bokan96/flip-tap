import { choosePlan, type Difficulty } from '../engine/ai';
import { Rng } from '../engine/rng';
import type { MatchState, Plan, Seat } from '../engine/types';

/**
 * Where a seat's plan comes from. The battle screen asks each seat for a plan every
 * round and never cares whether it was typed by a human, chosen by the CPU or
 * (later) received from a remote peer.
 */
export interface PlanSource {
  readonly kind: 'human' | 'cpu' | 'remote';
  requestPlan(state: MatchState, seat: Seat): Promise<Plan>;
}

export class CpuPlanSource implements PlanSource {
  readonly kind = 'cpu' as const;
  private rng: Rng;

  constructor(
    private difficulty: Difficulty,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  async requestPlan(state: MatchState, seat: Seat): Promise<Plan> {
    // Yield a frame so the "thinking" UI can paint before the search runs.
    await new Promise((r) => setTimeout(r, 30));
    return choosePlan(state, seat, this.difficulty, this.rng);
  }
}

/**
 * Network seam for online play (not implemented yet). Both peers run the same
 * deterministic engine, so only each round's plans need to be exchanged.
 * A PeerJS/WebRTC implementation would wrap a DataConnection and produce a
 * PlanSource of kind 'remote' for the opponent's seat.
 */
export interface MatchTransport {
  sendPlan(round: number, plan: Plan): void;
  onPlan(cb: (round: number, plan: Plan) => void): void;
  close(): void;
}
