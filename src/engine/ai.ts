import { BALANCE } from '../content/balance';
import { getCard, getFighter } from '../content/cards';
import { TWO_TAP } from '../content/variants';
import { fastSimulate, type FastResult } from './fastsim';
import { readPlayer, type PlayerModel, type RoundRecord } from './playerModel';
import { Rng } from './rng';
import { energyRecovery, heldCard, heldPlays, playerTrace } from './rules';
import type { MatchState, Plan, PlayerState, Seat } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/**
 * How the CPU scores the position at the end of a simulated round, on top of both
 * fighters' life. Everything here is about what the next round will look like.
 */
export interface EvalWeights {
  /** Value of each point of energy (after next round's refill) up to `energySoft`… */
  energy: number;
  /** …and of each point above it. */
  energyHigh: number;
  energySoft: number;
  /** Ammo fighters: value of each attack still loaded. */
  ammo: number;
  /**
   * Share of a lasting trap's damage counted as value: the most dangerous trap next to the enemy
   * (they can only stand on one square, and they can see it), plus a quarter for one further away.
   */
  trap: number;
  /** Extra weight on each point of life below DANGER_LIFE (being one round from a KO). */
  danger: number;
  /** Share of a hex's extra damage counted as value (it only pays off on the next hit that lands). */
  hex: number;
}

/** Life below which a fighter is in KO range of most rounds. */
const DANGER_LIFE = 40;

/** Only life and energy count (the original, short-sighted scoring). */
const FLAT: EvalWeights = { energy: 0.2, energyHigh: 0.2, energySoft: 100, ammo: 0, trap: 0, danger: 0, hex: 0 };
/** Full look-ahead. */
const FULL: EvalWeights = { energy: 0.3, energyHigh: 0.1, energySoft: 50, ammo: 4, trap: 0.3, danger: 0.4, hex: 0.5 };
const HALF: EvalWeights = { energy: 0.25, energyHigh: 0.15, energySoft: 50, ammo: 2, trap: 0.15, danger: 0.2, hex: 0.25 };

export interface AiProfile {
  /** How many of our plans are used to guess the opponent's likely replies. */
  probe: number;
  /** How many of the opponent's likely plans to test against. */
  opponentSamples: number;
  /** Softmax temperature over plan scores; higher = more random. */
  temperature: number;
  /** Weight of the worst case vs. the average case. */
  caution: number;
  weights: EvalWeights;
  /**
   * Treat the round as a small simultaneous game between both sides' strongest plans (see
   * solveRound). Without `exploit`, play its equilibrium mix: hard to read, hard to exploit.
   */
  solve?: {
    /** Plans kept per side. */
    candidates: number;
    /** Share of the time we play the best reply to what we expect them to do, instead of the equilibrium. */
    exploit: number;
    /** How much we expect them to pick what looks best against our likely plans (vs. the equilibrium). */
    predict: number;
    /** Softmax temperature of that prediction (higher = less sure). */
    predictTemperature: number;
  };
  /** How far to lean on the opponent's habits from this match (0 = ignore them). */
  readPlayer: number;
  /** Let each fighter's personality nudge the scoring (off for balance simulations). */
  personality: boolean;
}

export const PROFILES: Record<Difficulty, AiProfile> = {
  easy: { probe: 12, opponentSamples: 6, temperature: 18, caution: 0, weights: FLAT, readPlayer: 0, personality: true },
  normal: { probe: 12, opponentSamples: 16, temperature: 5, caution: 0.25, weights: HALF, readPlayer: 0, personality: true },
  hard: { probe: 12, opponentSamples: 32, temperature: 1.5, caution: 0.35, weights: FULL, readPlayer: 0, personality: true },
  expert: {
    probe: 12,
    opponentSamples: 20,
    temperature: 1.5,
    caution: 0.3,
    weights: FULL,
    solve: { candidates: 32, exploit: 0.6, predict: 0.6, predictTemperature: 3 },
    readPlayer: 0.6,
    personality: true,
  },
};

/** Cheaper, fairly strong profile for balance simulations (not shown in the UI). */
export const SIM_PROFILE: AiProfile = {
  probe: 6,
  opponentSamples: 10,
  temperature: 4,
  caution: 0.25,
  weights: FULL,
  readPlayer: 0,
  personality: false,
};

/**
 * Every legal plan for a player (ordered, affordable, unique cards). In Two-tap the plan starts
 * with the player's locked-in card, and the energy refill comes before the held-over slot
 * (same as rules.playerTrace).
 */
export function enumeratePlans(player: PlayerState): Plan[] {
  const out: Plan[] = [];
  const deck = player.deck;
  const slots = BALANCE.slotsPerRound;
  const refillAt = player.carry ? TWO_TAP.stepsPerRound : -1;
  const cur: string[] = [];
  const rec = (energy: number, reloaded: boolean, moved: boolean) => {
    if (cur.length === slots) {
      out.push([...cur]);
      return;
    }
    if (cur.length === refillAt) energy = Math.min(player.energyMax, energy + energyRecovery(player));
    for (const id of deck) {
      if (BALANCE.uniqueCardsPerPlan && cur.includes(id)) continue;
      const card = getCard(id);
      // Ammo fighters can't fire a spent attack until a Reload earlier in the plan.
      if (!reloaded && card.kind === 'attack' && player.mods.ammo && player.spent.includes(id)) continue;
      // Planted attacks can't follow a move.
      if (moved && card.planted) continue;
      const e = energy + card.cost;
      if (e < 0) continue;
      cur.push(id);
      rec(Math.min(e, player.energyMax), reloaded || card.kind === 'reload', moved || card.kind === 'move');
      cur.pop();
    }
  };
  const held = heldCard(player);
  if (held) {
    const card = getCard(held);
    const plays = heldPlays(player);
    cur.push(held);
    rec(
      plays ? Math.min(player.energy + card.cost, player.energyMax) : player.energy,
      plays && card.kind === 'reload',
      card.kind === 'move',
    );
  } else rec(player.energy, false, false);
  return out;
}

/** Two-tap: the opponent as a fair CPU sees them, without the card they locked in face-down. */
function withoutHeld(p: PlayerState): PlayerState {
  return p.carry?.held ? { ...p, carry: { held: null } } : p;
}

/**
 * Two-tap: the opponent's plans as far as a fair CPU can tell. Their first card is the one they
 * hold face-down: it could be anything except the two cards they just played (a plan never repeats
 * a card). The history is trimmed the same way, so the habit model can't see the hidden card either.
 */
function hiddenHeld(state: MatchState, other: Seat, history: RoundRecord[]): { theirs: Plan[]; history: RoundRecord[] } | null {
  if (!heldCard(state.players[other])) return null;
  const all = enumeratePlans(withoutHeld(state.players[other]));
  const last = history[history.length - 1];
  if (!last) return { theirs: all, history };
  const shown = last.plans[other].slice(0, TWO_TAP.stepsPerRound);
  const fair = all.filter((p) => !shown.includes(p[0]));
  const plans = [...last.plans] as [Plan, Plan];
  plans[other] = shown;
  return { theirs: fair.length ? fair : all, history: [...history.slice(0, -1), { ...last, plans }] };
}

/**
 * Two-tap: their held card was picked last round, before anyone knew where the fighters would be
 * now, so it isn't their best card for this position. Score each of their plans by the average over
 * every card they might be holding (the plans sharing its last two cards), so the CPU prepares for
 * the cards they choose now rather than for a perfectly chosen hidden card. A tiny random nudge
 * spreads the picks over different held cards.
 */
function blurHeld(theirs: Plan[], scores: number[], rng: Rng): number[] {
  const key = (p: Plan) => `${p[1]}|${p[2]}`;
  const sum = new Map<string, [number, number]>();
  theirs.forEach((p, i) => {
    const e = sum.get(key(p)) ?? [0, 0];
    e[0] += scores[i];
    e[1]++;
    sum.set(key(p), e);
  });
  return theirs.map((p) => {
    const [total, n] = sum.get(key(p))!;
    return total / n + rng.next() * 1e-6;
  });
}

// ---------- scoring ----------

type Evaluator = (r: FastResult) => number;

interface Side {
  /** Attack cards in the deck (Ferro's loaded shots are counted against this). */
  attacks: number;
  regen: number;
  energyMax: number;
  ammo: boolean;
  /** Extra damage this side's next landed hit deals if the other side is hexed. */
  hexHit: number;
}

function side(p: PlayerState): Side {
  return {
    attacks: p.deck.filter((id) => getCard(id).kind === 'attack').length,
    regen: energyRecovery(p),
    energyMax: p.energyMax,
    ammo: p.mods.ammo,
    hexHit: BALANCE.hexDamage + p.mods.hexBonus,
  };
}

/** Score a simulated round from `seat`'s point of view. `aggression` > 0 values damage dealt over damage taken. */
function makeEvaluator(state: MatchState, seat: Seat, w: EvalWeights, aggression: number): Evaluator {
  const o = seat === 0 ? 1 : 0;
  const me = side(state.players[seat]);
  const them = side(state.players[o]);
  const cols = state.arena.cols;
  const selfW = 1 - aggression / 2;
  const oppW = 1 + aggression / 2;
  const lifeValue = (l: number) => l - w.danger * Math.max(0, DANGER_LIFE - l);
  const energyAfter = (s: Side, e: number) => Math.min(s.energyMax, e + s.regen);
  const energyValue = (e: number) => w.energy * Math.min(e, w.energySoft) + w.energyHigh * Math.max(0, e - w.energySoft);

  return (r: FastResult) => {
    if (r.outcome === seat) return 1000;
    if (r.outcome === 2) return -150;
    if (r.outcome !== -1) return -1000;
    let v = selfW * lifeValue(r.life[seat]) - oppW * lifeValue(r.life[o]);
    v += energyValue(energyAfter(me, r.energy[seat])) - energyValue(energyAfter(them, r.energy[o]));
    if (w.ammo) {
      if (me.ammo) v += w.ammo * (me.attacks - r.spent[seat]);
      if (them.ammo) v -= w.ammo * (them.attacks - r.spent[o]);
    }
    if (w.trap && r.traps.length) {
      const P = r.pos;
      const [mr, mc, tr, tc] = seat === 0 ? [P[0], P[1], P[2], P[3]] : [P[2], P[3], P[0], P[1]];
      // Best trap near / far from its victim, per owner: [mine near, mine far, theirs near, theirs far].
      let mn = 0, mf = 0, tn = 0, tf = 0;
      for (let k = 0; k < r.traps.length; k += 3) {
        const at = r.traps[k];
        const mine = r.traps[k + 1] === seat;
        const [vr, vc] = mine ? [tr, tc] : [mr, mc]; // the trap's victim
        const near = Math.max(Math.abs(Math.floor(at / cols) - vr), Math.abs((at % cols) - vc)) <= 1;
        const d = r.traps[k + 2];
        if (mine) near ? (mn = Math.max(mn, d)) : (mf = Math.max(mf, d));
        else near ? (tn = Math.max(tn, d)) : (tf = Math.max(tf, d));
      }
      v += w.trap * (mn + 0.25 * mf - tn - 0.25 * tf);
    }
    if (w.hex) {
      if (r.hexed[o]) v += w.hex * me.hexHit;
      if (r.hexed[seat]) v -= w.hex * them.hexHit;
    }
    return v;
  };
}

function personality(state: MatchState, seat: Seat, profile: AiProfile): { aggression: number; caution: number } {
  const ai = profile.personality ? getFighter(state.players[seat].fighterId).ai : undefined;
  return { aggression: ai?.aggression ?? 0, caution: ai?.caution ?? 0 };
}

function simulator(state: MatchState, seat: Seat) {
  return (mine: Plan, theirs: Plan) => (seat === 0 ? fastSimulate(state, mine, theirs) : fastSimulate(state, theirs, mine));
}

function scorePlans(state: MatchState, seat: Seat, mine: Plan[], theirs: Plan[], caution: number, evaluate: Evaluator): number[] {
  const sim = simulator(state, seat);
  return mine.map((plan) => {
    let sum = 0;
    let worst = Infinity;
    for (const opp of theirs) {
      const v = evaluate(sim(plan, opp));
      sum += v;
      if (v < worst) worst = v;
    }
    const avg = sum / theirs.length;
    return (1 - caution) * avg + caution * worst;
  });
}

// ---------- helpers ----------

function sample<T>(items: T[], n: number, rng: Rng): T[] {
  if (items.length <= n) return items;
  return rng.shuffle([...items]).slice(0, n);
}

/** Indices of the `n` highest scores. */
function topIndices(scores: number[], n: number): number[] {
  return scores
    .map((s, i) => [s, i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map((x) => x[1]);
}

function softmax(scores: number[], temperature: number): number[] {
  const max = Math.max(...scores);
  const w = scores.map((s) => Math.exp((s - max) / temperature));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

function pickFrom(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Approximate equilibrium of the zero-sum game `M` (rows: our plans, columns: theirs, values: our
 * score) by regret matching (CFR+ with linear averaging). Returns both sides' mixed strategies.
 */
export function solveMatrix(M: number[][], iterations = 400): [number[], number[]] {
  const n = M.length;
  const m = M[0].length;
  const rp = new Float64Array(n);
  const rq = new Float64Array(m);
  const sp = new Float64Array(n);
  const sq = new Float64Array(m);
  const p = new Float64Array(n);
  const q = new Float64Array(m);
  const ep = new Float64Array(n);
  const eq = new Float64Array(m);
  const strategy = (regret: Float64Array, out: Float64Array) => {
    let total = 0;
    for (let i = 0; i < regret.length; i++) total += regret[i];
    for (let i = 0; i < regret.length; i++) out[i] = total > 0 ? regret[i] / total : 1 / regret.length;
  };
  for (let t = 1; t <= iterations; t++) {
    strategy(rp, p);
    strategy(rq, q);
    let v = 0;
    eq.fill(0);
    for (let i = 0; i < n; i++) {
      const row = M[i];
      let e = 0;
      for (let j = 0; j < m; j++) {
        e += row[j] * q[j];
        eq[j] -= row[j] * p[i];
      }
      ep[i] = e;
      v += p[i] * e;
    }
    for (let i = 0; i < n; i++) {
      rp[i] = Math.max(0, rp[i] + ep[i] - v);
      sp[i] += t * p[i];
    }
    for (let j = 0; j < m; j++) {
      rq[j] = Math.max(0, rq[j] + eq[j] + v);
      sq[j] += t * q[j];
    }
  }
  const norm = (a: Float64Array) => {
    const total = a.reduce((x, y) => x + y, 0);
    return Array.from(a, (x) => x / total);
  };
  return [norm(sp), norm(sq)];
}

// ---------- choosing a plan ----------

/**
 * Pick a plan for `seat`. `history` (the match so far) lets stronger CPUs read the
 * opponent's habits.
 */
export function choosePlan(state: MatchState, seat: Seat, difficulty: Difficulty, rng: Rng, history: RoundRecord[] = []): Plan {
  return choosePlanWith(state, seat, PROFILES[difficulty], rng, history);
}

export function choosePlanWith(state: MatchState, seat: Seat, profile: AiProfile, rng: Rng, history: RoundRecord[] = []): Plan {
  const other: Seat = seat === 0 ? 1 : 0;
  const mine = enumeratePlans(state.players[seat]);
  const hidden = hiddenHeld(state, other, history);
  const theirs = hidden ? hidden.theirs : enumeratePlans(state.players[other]);
  if (hidden) history = hidden.history;
  const blur = (scores: number[]) => (hidden ? blurHeld(theirs, scores, rng) : scores);
  if (mine.length === 0) throw new Error('No legal plan available.');
  const persona = personality(state, seat, profile);
  const caution = Math.min(0.8, profile.caution + persona.caution);
  const evalMine = makeEvaluator(state, seat, profile.weights, persona.aggression);
  const evalTheirs = makeEvaluator(state, other, profile.weights, 0);
  const model = profile.readPlayer > 0 ? readPlayer(history, other, state) : null;

  if (profile.solve && mine.length > 1 && theirs.length > 1) {
    return solveRound(state, seat, profile, rng, { mine, theirs, caution, evalMine, evalTheirs, model, blur });
  }

  // Level 1: which opponent plans look strong against a random sample of ours?
  const probe = sample(mine, profile.probe, rng);
  const theirScores = blur(scorePlans(state, other, theirs, probe, 0, evalTheirs));
  const likely = topIndices(theirScores, Math.ceil(profile.opponentSamples * 0.75)).map((i) => theirs[i]);
  const wildcards = sample(theirs, Math.floor(profile.opponentSamples * 0.25), rng);
  const replies = [...likely, ...wildcards];

  // Level 2: best plan against the likely replies.
  const scores = scorePlans(state, seat, mine, replies, caution, evalMine);
  return mine[pickFrom(softmax(scores, profile.temperature), rng)];
}

interface SolveInput {
  mine: Plan[];
  theirs: Plan[];
  caution: number;
  evalMine: Evaluator;
  evalTheirs: Evaluator;
  model: PlayerModel | null;
  /** Two-tap: averages their scores over the card they hold face-down (identity otherwise). */
  blur: (scores: number[]) => number[];
}

/** Plans of theirs most typical of the player's habits. */
const HABIT_PLANS = 6;
/** Rounds of "double oracle": add each side's best reply to the other's mix and solve again. */
const REFINE = 2;

/**
 * Expert: narrow both sides down to their strongest plans, then play the equilibrium mix of
 * that small game, tilted toward exploiting the opponent's habits once they are known.
 */
function solveRound(state: MatchState, seat: Seat, profile: AiProfile, rng: Rng, input: SolveInput): Plan {
  const { mine, theirs, caution, evalMine, evalTheirs, model, blur } = input;
  const other: Seat = seat === 0 ? 1 : 0;
  const sim = simulator(state, seat);
  const R = profile.probe;
  const K = profile.solve!.candidates;

  // 1. Our plans against a random sample of theirs; 2. theirs against our best of those.
  const first = scorePlans(state, seat, mine, sample(theirs, R, rng), caution, evalMine);
  const probe = topIndices(first, R).map((i) => mine[i]);
  const theirScores = blur(scorePlans(state, other, theirs, probe, profile.caution, evalTheirs));
  const cols = new Set(topIndices(theirScores, K));
  if (model) {
    const habits = theirs.map((p) => model.weight(p));
    for (const j of topIndices(habits, HABIT_PLANS)) cols.add(j);
  }

  // 3. Every plan of ours against their candidates (the payoff matrix, one row per plan of ours).
  const colList = [...cols];
  const rows = mine.map((plan) => colList.map((j) => evalMine(sim(plan, theirs[j]))));
  const addColumns = (js: number[]) => {
    for (const j of js) {
      if (cols.has(j)) continue;
      cols.add(j);
      colList.push(j);
      mine.forEach((plan, i) => rows[i].push(evalMine(sim(plan, theirs[j]))));
    }
  };
  const rowScore = (q: number[]) => rows.map((row) => row.reduce((s, v, j) => s + v * q[j], 0));

  let rowList = topIndices(
    rows.map((row) => {
      const avg = row.reduce((a, b) => a + b, 0) / row.length;
      return (1 - caution) * avg + caution * Math.min(...row);
    }),
    K,
  );
  let p: number[] = [];
  let q: number[] = [];
  for (let round = 0; ; round++) {
    [p, q] = solveMatrix(rowList.map((i) => rows[i]));
    if (round === REFINE) break;
    // Their best replies to our mix, over all their plans (only our plans in the mix matter).
    const support = rowList.map((i, k) => [i, p[k]] as const).filter(([, w]) => w > 0.01);
    const reply = blur(theirs.map((plan) => -support.reduce((s, [i, w]) => s + w * evalMine(sim(mine[i], plan)), 0)));
    addColumns(topIndices(reply, 3));
    // Our best replies to their mix, over all our plans.
    const qFull = colList.map((_, k) => q[k] ?? 0);
    const ours = topIndices(rowScore(qFull), 3);
    rowList = [...new Set([...rowList, ...ours])];
  }

  // What we expect them to play: partly the equilibrium, partly "what looks best against our likely
  // plans" (how most players, and the other CPUs, choose), and partly their habits once known.
  const { exploit, predict, predictTemperature } = profile.solve!;
  const looksBest = softmax(colList.map((j) => theirScores[j]), predictTemperature);
  let expected = colList.map((_, k) => (1 - predict) * (q[k] ?? 0) + predict * looksBest[k]);
  if (model && profile.readPlayer > 0) {
    const c = profile.readPlayer * model.confidence;
    const habit = softmax(colList.map((j) => model.weight(theirs[j])), 1);
    expected = expected.map((x, k) => (1 - c) * x + c * habit[k]);
  }
  const best = softmax(
    rowList.map((i) => rows[i].reduce((s, v, k) => s + v * expected[k], 0)),
    profile.temperature,
  );
  // Mostly punish what we expect, but keep some of the equilibrium so we stay hard to read.
  const dist = p.map((w, k) => (1 - exploit) * w + exploit * best[k]);
  // Drop the long tail of barely-used plans: they're noise from the solver.
  const top = Math.max(...dist);
  const weights = dist.map((w) => (w < 0.03 && w < top ? 0 : w));
  return mine[rowList[pickFrom(weights, rng)]];
}

/** Sanity helper for tests and UI. */
export function isAffordable(player: PlayerState, plan: Plan): boolean {
  return playerTrace(player, plan) !== null;
}
