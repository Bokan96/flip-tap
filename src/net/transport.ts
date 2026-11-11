import { choosePlan, type Difficulty } from '../engine/ai';
import type { AiRequest } from '../engine/aiWorker';
import { historyFromLog } from '../engine/playerModel';
import { Rng } from '../engine/rng';
import type { MatchLog, MatchState, Plan, Seat } from '../engine/types';

/**
 * Where a seat's plan comes from. The battle screen asks each seat for a plan every
 * round and never cares whether it was typed by a human, chosen by the CPU or
 * (later) received from a remote peer.
 */
export interface PlanSource {
  readonly kind: 'human' | 'cpu' | 'remote';
  /** `log` is the match so far (the CPU reads the opponent's habits from it). */
  requestPlan(state: MatchState, seat: Seat, log?: MatchLog): Promise<Plan>;
}

// ---------- CPU search in a background worker ----------

type Pending = { resolve: (plan: Plan) => void; reject: (err: Error) => void };
/** undefined = not started yet, null = unavailable (no Worker support, or it failed to load). */
let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();
let nextId = 1;

function aiWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('../engine/aiWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; plan?: Plan; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.plan) p.resolve(e.data.plan);
      else p.reject(new Error(e.data.error ?? 'CPU failed'));
    };
    w.onerror = () => {
      // Fall back to the main thread for good (e.g. the worker file couldn't load offline).
      w.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error('CPU worker failed'));
      pending.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function inWorker(w: Worker, req: Omit<AiRequest, 'id'>): Promise<Plan> {
  const id = nextId++;
  return new Promise<Plan>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id });
  });
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

  async requestPlan(state: MatchState, seat: Seat, log?: MatchLog): Promise<Plan> {
    const req = { state, seat, difficulty: this.difficulty, history: historyFromLog(log, state), seed: this.rng.int(2 ** 31) };
    const w = aiWorker();
    if (w) {
      try {
        return await inWorker(w, req);
      } catch {
        /* fall through to the main thread */
      }
    }
    // Yield a frame so the "thinking" UI can paint before the search runs.
    await new Promise((r) => setTimeout(r, 30));
    return choosePlan(req.state, req.seat, req.difficulty, new Rng(req.seed), req.history);
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
