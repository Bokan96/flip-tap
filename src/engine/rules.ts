import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import type {
  CardDef,
  Facing,
  MatchOutcome,
  MatchState,
  Plan,
  PlayerState,
  Pos,
  RoundResult,
  Seat,
  StepPlayerResult,
  StepResult,
} from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cloneState(s: MatchState): MatchState {
  return {
    round: s.round,
    outcome: s.outcome,
    players: s.players.map((p) => ({ ...p, pos: { ...p.pos }, deck: [...p.deck] })) as [PlayerState, PlayerState],
  };
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}

/** Squares an attack covers from `pos` while facing `facing`, clipped to the board. */
export function attackArea(card: CardDef, pos: Pos, facing: Facing): Pos[] {
  if (card.kind !== 'attack' || !card.pattern) return [];
  const out: Pos[] = [];
  card.pattern.forEach((row, i) => {
    for (let j = 0; j < 3; j++) {
      if (row[j] !== '1') continue;
      const r = pos.r + (i - 1);
      const c = pos.c + (j - 1) * facing;
      if (r >= 0 && r < BALANCE.rows && c >= 0 && c < BALANCE.cols) out.push({ r, c });
    }
  });
  return out;
}

export function movePos(pos: Pos, card: CardDef): Pos {
  if (!card.step) return { ...pos };
  return {
    r: clamp(pos.r + card.step[0], 0, BALANCE.rows - 1),
    c: clamp(pos.c + card.step[1], 0, BALANCE.cols - 1),
  };
}

export function faceTowards(me: Pos, them: Pos, current: Facing): Facing {
  if (them.c > me.c) return 1;
  if (them.c < me.c) return -1;
  return current;
}

/**
 * Energy left after each filled slot of a (possibly partial) plan. Empty slots ('' or undefined) cost nothing.
 * Returns null if the running total ever drops below zero.
 */
export function planEnergyTrace(startEnergy: number, energyMax: number, plan: Plan): number[] | null {
  const trace: number[] = [];
  let e = startEnergy;
  for (const id of plan) {
    if (id) {
      e += getCard(id).cost;
      if (e < 0) return null;
      e = Math.min(e, energyMax);
    }
    trace.push(e);
  }
  return trace;
}

/** Why a plan is not allowed, or null if it is legal. */
export function planError(player: PlayerState, plan: Plan): string | null {
  if (plan.length !== BALANCE.slotsPerRound) return 'Plan must fill every slot.';
  for (const id of plan) {
    if (!id) return 'Plan must fill every slot.';
    if (!player.deck.includes(id)) return `Card not in deck: ${id}`;
  }
  if (BALANCE.uniqueCardsPerPlan && new Set(plan).size !== plan.length) return 'Each card can be used once per round.';
  if (!planEnergyTrace(player.energy, player.energyMax, plan)) return 'Not enough energy for this plan.';
  return null;
}

/** Can `cardId` be placed into `slot` of a partial plan without breaking energy or uniqueness? */
export function canPlace(player: PlayerState, plan: Plan, slot: number, cardId: string): boolean {
  if (!player.deck.includes(cardId)) return false;
  if (BALANCE.uniqueCardsPerPlan && plan.some((id, i) => i !== slot && id === cardId)) return false;
  const next = [...plan];
  next[slot] = cardId;
  return planEnergyTrace(player.energy, player.energyMax, next) !== null;
}

function outcomeFor(players: [PlayerState, PlayerState]): MatchOutcome | null {
  const dead0 = players[0].life <= 0;
  const dead1 = players[1].life <= 0;
  if (dead0 && dead1) return { winner: null, draw: true };
  if (dead0) return { winner: 1 };
  if (dead1) return { winner: 0 };
  return null;
}

/** Resolve one slot for both players simultaneously. Mutates `state`. */
export function resolveStep(state: MatchState, cardIds: [string, string], slot: number): StepResult {
  const ps = state.players;
  const cards = [getCard(cardIds[0]), getCard(cardIds[1])] as const;
  const active = [ps[0].energy + cards[0].cost >= 0, ps[1].energy + cards[1].cost >= 0];
  const from = [{ ...ps[0].pos }, { ...ps[1].pos }];

  // 1. Movement (simultaneous).
  for (const i of [0, 1] as const) {
    if (active[i]) ps[i].pos = movePos(ps[i].pos, cards[i]);
  }
  for (const i of [0, 1] as const) {
    const o = i === 0 ? 1 : 0;
    ps[i].facing = faceTowards(ps[i].pos, ps[o].pos, ps[i].facing);
  }

  // 2. Hits, computed from post-movement positions.
  const areas = [0, 1].map((i) => (active[i] ? attackArea(cards[i], ps[i].pos, ps[i].facing) : [])) as [Pos[], Pos[]];
  const hit: StepPlayerResult['hit'][] = ['none', 'none'];
  const damage = [0, 0];
  for (const i of [0, 1] as const) {
    const o = i === 0 ? 1 : 0;
    const atk = cards[o];
    if (!active[o] || atk.kind !== 'attack') continue;
    if (!areas[o].some((p) => samePos(p, ps[i].pos))) {
      hit[i] = 'miss';
      continue;
    }
    const guard = active[i] ? (cards[i].guard ?? 0) : 0;
    hit[i] = guard > 0 ? 'guard' : 'hit';
    damage[i] = Math.max(0, (atk.damage ?? 0) - guard);
  }

  // 3. Self effects, then 4. clamp.
  const healed = [0, 0];
  for (const i of [0, 1] as const) {
    const p = ps[i];
    let life = p.life - damage[i];
    let energy = p.energy;
    if (active[i]) {
      healed[i] = cards[i].heal ?? 0;
      life += healed[i];
      energy += cards[i].cost;
    }
    p.life = clamp(life, 0, p.lifeMax);
    p.energy = clamp(energy, 0, p.energyMax);
  }

  // 5. KO check.
  state.outcome = outcomeFor(ps);

  const players = [0, 1].map((i) => ({
    cardId: cardIds[i],
    active: active[i],
    from: from[i],
    to: { ...ps[i].pos },
    facing: ps[i].facing,
    area: areas[i],
    hit: hit[i],
    damageTaken: damage[i],
    healed: healed[i],
    life: ps[i].life,
    energy: ps[i].energy,
  })) as [StepPlayerResult, StepPlayerResult];

  return { slot, players, outcome: state.outcome };
}

/** Resolve a whole round. Pure: returns a new state. Throws on illegal plans. */
export function resolveRound(state: MatchState, plans: [Plan, Plan]): RoundResult {
  if (state.outcome) throw new Error('Match is already over.');
  for (const seat of [0, 1] as Seat[]) {
    const err = planError(state.players[seat], plans[seat]);
    if (err) throw new Error(`Player ${seat + 1}: ${err}`);
  }
  const next = cloneState(state);
  const steps: StepResult[] = [];
  for (let slot = 0; slot < BALANCE.slotsPerRound; slot++) {
    steps.push(resolveStep(next, [plans[0][slot], plans[1][slot]], slot));
    if (next.outcome) break;
  }
  if (!next.outcome) {
    for (const p of next.players) p.energy = Math.min(p.energyMax, p.energy + BALANCE.energyPerRound);
    next.round += 1;
  }
  return { steps, state: next };
}
