import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import { TWO_TAP } from '../content/variants';
import type {
  ArenaState,
  CardDef,
  Facing,
  MatchOutcome,
  MatchState,
  Mods,
  Plan,
  PlayerState,
  Pos,
  RoundResult,
  Seat,
  StepPlayerResult,
  StepResult,
  TileKind,
  Trap,
} from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cloneState(s: MatchState): MatchState {
  return {
    round: s.round,
    ...(s.variant ? { variant: s.variant } : {}),
    outcome: s.outcome,
    arena: { ...s.arena, blocked: [...s.arena.blocked], tiles: { ...s.arena.tiles }, traps: s.arena.traps.map((t) => ({ ...t })) },
    players: s.players.map((p) => ({
      ...p,
      pos: { ...p.pos },
      deck: [...p.deck],
      mods: { ...p.mods },
      spent: [...p.spent],
      ...(p.carry ? { carry: { ...p.carry } } : {}),
    })) as [
      PlayerState,
      PlayerState,
    ],
  };
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}

/** Is this square on the board and not blocked? */
export function isOpen(arena: ArenaState, r: number, c: number): boolean {
  return r >= 0 && r < arena.rows && c >= 0 && c < arena.cols && !arena.blocked.includes(r * arena.cols + c);
}

/** The square effect at `pos`, if any. */
export function tileAt(arena: ArenaState, pos: Pos): TileKind | null {
  return arena.tiles[pos.r * arena.cols + pos.c] ?? null;
}

/**
 * Squares an attack (or trap card) covers from `pos` while facing `facing`, clipped to open squares.
 * Pattern rows are 3 or 5 characters wide; the middle character is the user's column.
 */
export function attackArea(arena: ArenaState, card: CardDef, pos: Pos, facing: Facing): Pos[] {
  if ((card.kind !== 'attack' && card.kind !== 'trap') || !card.pattern) return [];
  const out: Pos[] = [];
  card.pattern.forEach((row, i) => {
    const half = (row.length - 1) / 2;
    for (let j = 0; j < row.length; j++) {
      if (row[j] !== '1') continue;
      const r = pos.r + (i - 1);
      const c = pos.c + (j - half) * facing;
      if (isOpen(arena, r, c)) out.push({ r, c });
    }
  });
  return out;
}

/**
 * Where a move card takes you: clamped to the board; a move onto a blocked square does nothing.
 * `facing` turns a forward move (card.forward) toward the side you face.
 */
export function movePos(arena: ArenaState, pos: Pos, card: CardDef, facing: Facing = 1): Pos {
  if (!card.step) return { ...pos };
  const dc = card.forward ? card.step[1] * facing : card.step[1];
  const r = clamp(pos.r + card.step[0], 0, arena.rows - 1);
  const c = clamp(pos.c + dc, 0, arena.cols - 1);
  return isOpen(arena, r, c) ? { r, c } : { ...pos };
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

/** Two-tap: the card this player locked in last round, which must play first this round. */
export function heldCard(player: PlayerState): string | null {
  return player.carry?.held || null;
}

/**
 * Two-tap: will the locked-in card actually play? It was legal when it was planned, but a stun,
 * a drained energy bar or an unreloaded shot since then makes it fizzle (it plays as inactive).
 */
export function heldPlays(player: PlayerState): boolean {
  const held = heldCard(player);
  if (!held) return false;
  return !player.dazed && player.energy + getCard(held).cost >= 0 && !isSpent(player, held);
}

/**
 * Energy left after each filled slot of a player's (possibly partial) plan, or null if it runs out.
 * Same as planEnergyTrace, except in Two-tap: a locked-in card that will fizzle costs nothing, and
 * the round's energy refill lands before the card held over for next round.
 */
export function playerTrace(player: PlayerState, plan: Plan): number[] | null {
  if (!player.carry) return planEnergyTrace(player.energy, player.energyMax, plan);
  const held = heldCard(player);
  const trace: number[] = [];
  let e = player.energy;
  for (let i = 0; i < plan.length; i++) {
    if (i === TWO_TAP.stepsPerRound) e = Math.min(player.energyMax, e + energyRecovery(player));
    const id = plan[i];
    const fizzles = i === 0 && held !== null && id === held && !heldPlays(player);
    if (id && !fizzles) {
      e += getCard(id).cost;
      if (e < 0) return null;
      e = Math.min(e, player.energyMax);
    }
    trace.push(e);
  }
  return trace;
}

/**
 * Ammo fighters can't plan a spent attack unless a Reload comes earlier in the same plan.
 * Always true for everyone else. (A Two-tap locked-in card is never checked: it fizzles instead.)
 */
export function ammoOk(player: PlayerState, plan: Plan): boolean {
  if (!player.mods.ammo) return true;
  const held = heldCard(player);
  let reloaded = false;
  for (let i = 0; i < plan.length; i++) {
    const id = plan[i];
    if (!id) continue;
    const c = getCard(id);
    if (c.kind === 'reload') reloaded = true;
    else if (c.kind === 'attack' && !reloaded && player.spent.includes(id) && !(i === 0 && id === held)) return false;
  }
  return true;
}

/** Planted attacks can't come after a move card in the same plan. */
export function plantedOk(plan: Plan): boolean {
  let moved = false;
  for (const id of plan) {
    if (!id) continue;
    const c = getCard(id);
    if (c.kind === 'move') moved = true;
    else if (c.planted && moved) return false;
  }
  return true;
}

/** Is this card a spent attack for this player right now? */
export function isSpent(player: PlayerState, cardId: string): boolean {
  return player.mods.ammo && player.spent.includes(cardId) && getCard(cardId).kind === 'attack';
}

/** Why a plan is not allowed, or null if it is legal. */
export function planError(player: PlayerState, plan: Plan): string | null {
  if (plan.length !== BALANCE.slotsPerRound) return 'Plan must fill every slot.';
  for (const id of plan) {
    if (!id) return 'Plan must fill every slot.';
    if (!player.deck.includes(id)) return `Card not in deck: ${id}`;
  }
  const held = heldCard(player);
  if (held && plan[0] !== held) return 'The locked-in card must play first.';
  if (BALANCE.uniqueCardsPerPlan && new Set(plan).size !== plan.length) return 'Each card can be used once per round.';
  if (!playerTrace(player, plan)) return 'Not enough energy for this plan.';
  if (!ammoOk(player, plan)) return 'That attack must be reloaded first.';
  if (!plantedOk(plan)) return 'That attack can’t follow a move this round.';
  return null;
}

/** Is a partially filled plan (empty slots allowed) still legal so far? */
export function partialPlanOk(player: PlayerState, plan: Plan): boolean {
  const used = plan.filter(Boolean);
  if (used.some((id) => !player.deck.includes(id))) return false;
  const held = heldCard(player);
  if (held && plan[0] !== held) return false;
  if (BALANCE.uniqueCardsPerPlan && new Set(used).size !== used.length) return false;
  if (!ammoOk(player, plan)) return false;
  if (!plantedOk(plan)) return false;
  return playerTrace(player, plan) !== null;
}

/** Can `cardId` be placed into `slot` of a partial plan without breaking energy or uniqueness? */
export function canPlace(player: PlayerState, plan: Plan, slot: number, cardId: string): boolean {
  const next = [...plan];
  next[slot] = cardId;
  return partialPlanOk(player, next);
}

/**
 * Fill the empty slots of a partial plan with free cards so it can be locked in
 * (used when the plan timer runs out). Prefers Guard, then movement, then Focus.
 */
export function autoFillPlan(player: PlayerState, plan: Plan, preference: string[]): Plan {
  const out = [...plan];
  const order = [...preference, ...player.deck];
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    const pick = order.find((id) => player.deck.includes(id) && canPlace(player, out, i, id));
    if (pick) out[i] = pick;
  }
  return out;
}

function outcomeFor(players: [PlayerState, PlayerState]): MatchOutcome | null {
  const dead0 = players[0].life <= 0;
  const dead1 = players[1].life <= 0;
  if (dead0 && dead1) return { winner: null, draw: true };
  if (dead0) return { winner: 1 };
  if (dead1) return { winner: 0 };
  return null;
}

/** Life a hit removes, after the attacker's and defender's modifiers (and a hex it breaks). Never below 0. */
export function hitDamage(
  card: CardDef,
  attacker: PlayerState,
  defender: PlayerState,
  defenderGuard: number,
  defenderMoved: boolean,
): number {
  const am = attacker.mods;
  const dm = defender.mods;
  let dmg = (card.damage ?? 0) + am.damageBonus;
  if (am.lowLifeThreshold > 0 && attacker.life <= am.lowLifeThreshold) dmg += am.lowLifeBonus;
  if (defenderMoved) dmg += am.vsMovedBonus + (card.vsMoved ?? 0) - dm.movedReduction;
  if (defender.hexed) dmg += BALANCE.hexDamage + am.hexBonus;
  dmg -= defenderGuard + dm.damageReduction;
  return Math.max(0, dmg);
}

/**
 * Where a push (n > 0) or pull (n < 0) leaves the target, one square at a time along its row.
 * Pushes go away from the attacker (along the attacker's facing when they share a column); pulls
 * never pass the attacker's column. Both stop at the edge or in front of a blocked square.
 */
export function displace(arena: ArenaState, target: Pos, attacker: Pos, attackerFacing: Facing, n: number): Pos {
  const dir = n > 0 ? (target.c === attacker.c ? attackerFacing : Math.sign(target.c - attacker.c)) : Math.sign(attacker.c - target.c);
  let steps = n > 0 ? n : Math.min(-n, Math.abs(attacker.c - target.c));
  let c = target.c;
  while (steps-- > 0 && isOpen(arena, target.r, c + dir)) c += dir;
  return { r: target.r, c };
}

/** Life a heal card restores, given the user's life after this step's hits. */
export function healAmount(card: CardDef, lifeAfterHits: number): number {
  if (!card.heal) return 0;
  if (card.healAtOrBelow !== undefined && lifeAfterHits > card.healAtOrBelow) return 0;
  return card.heal;
}

/** A card's push (or pull, if negative) plus the attacker's bonus squares. */
export function pushAmount(push: number, attackerMods: Mods): number {
  return push + Math.sign(push) * attackerMods.pushBonus;
}

/** Energy a player regains at the end of a round. */
export function energyRecovery(p: PlayerState): number {
  return (p.carry ? TWO_TAP.energyPerRound : BALANCE.energyPerRound) + p.mods.energyPerRound;
}

/** Cards that play each round: 2 in Two-tap (the third is held over), otherwise every slot. */
export function stepsPerRound(state: MatchState): number {
  return state.variant === 'twoTap' ? TWO_TAP.stepsPerRound : BALANCE.slotsPerRound;
}

/** Late in a match both fighters lose life every round after this one. */
export function fatigueAfterRound(state: MatchState): number {
  return state.variant === 'twoTap' ? TWO_TAP.fatigueAfterRound : BALANCE.fatigueAfterRound;
}

/** Life both fighters lose to fatigue at the end of each late round. */
export function fatigueDamage(state: MatchState): number {
  return state.variant === 'twoTap' ? TWO_TAP.fatigueDamage : BALANCE.fatigueDamage;
}

/**
 * Who strikes first when both fighters attack in the same step: the attack with the higher
 * damage value, or on a tie the fighter with more life. Returns null (simultaneous) if both tie.
 */
export function strikeOrder(c0: CardDef, c1: CardDef, life0: number, life1: number): [Seat, Seat] | null {
  const d0 = c0.damage ?? 0;
  const d1 = c1.damage ?? 0;
  if (d0 !== d1) return d0 > d1 ? [0, 1] : [1, 0];
  if (life0 !== life1) return life0 > life1 ? [0, 1] : [1, 0];
  return null;
}

/** Resolve one slot for both players simultaneously. Mutates `state`. */
export function resolveStep(state: MatchState, cardIds: [string, string], slot: number): StepResult {
  const ps = state.players;
  const cols = state.arena.cols;
  const cards = [getCard(cardIds[0]), getCard(cardIds[1])] as const;
  const stunned = [ps[0].dazed, ps[1].dazed];
  ps[0].dazed = ps[1].dazed = false;
  // A card does nothing if its player is stunned, can't afford it, or it's a spent attack
  // (possible when a stun cancelled the Reload planned before it).
  const active = [0, 1].map((i) => !stunned[i] && ps[i].energy + cards[i].cost >= 0 && !isSpent(ps[i], cardIds[i]));
  const from = [{ ...ps[0].pos }, { ...ps[1].pos }];

  // 1. Movement (simultaneous), then a swap if anyone played one, then face each other.
  for (const i of [0, 1] as const) {
    if (active[i]) ps[i].pos = movePos(state.arena, ps[i].pos, cards[i], ps[i].facing);
  }
  const swappers = [0, 1].filter((i) => active[i] && cards[i].swap);
  // An immovable fighter can't be swapped by the other side (but can swap itself).
  const swapped = swappers.length > 0 && [0, 1].every((i) => swappers.includes(i) || !ps[i].mods.immovable);
  if (swapped) [ps[0].pos, ps[1].pos] = [ps[1].pos, ps[0].pos];
  const moved = [0, 1].map((i) => !samePos(from[i], ps[i].pos));
  const to = [{ ...ps[0].pos }, { ...ps[1].pos }];
  for (const i of [0, 1] as const) {
    ps[i].facing = faceTowards(ps[i].pos, ps[i === 0 ? 1 : 0].pos, ps[i].facing);
  }

  const hit: StepPlayerResult['hit'][] = ['none', 'none'];
  const damage = [0, 0];
  const counter = [0, 0];
  const drained = [0, 0];
  const dazed = [false, false];
  const sapped = [0, 0];
  const recoil = [0, 0];
  const healed = [0, 0];
  const hexApplied = [false, false];
  const hexBroken = [false, false];
  const interrupted = [false, false];
  let areas: [Pos[], Pos[]] = [[], []];
  let midLives: [number, number] | null = null;
  const reface = () => {
    for (const i of [0, 1] as const) ps[i].facing = faceTowards(ps[i].pos, ps[i === 0 ? 1 : 0].pos, ps[i].facing);
  };
  /** A hit on `i` connected: it breaks a hex, or a damaging hexing attack hexes them. */
  const hexHit = (i: 0 | 1, atk: CardDef, dealt: number) => {
    if (ps[i].hexed) {
      ps[i].hexed = false;
      hexBroken[i] = true;
    } else if (atk.hex && dealt > 0) {
      ps[i].hexed = true;
      hexApplied[i] = true;
    }
  };
  /** The card's own effects on its user (energy, heal, recoil) plus energy sapped from them. */
  const selfEffects = (i: 0 | 1, lifeAfterHits: number) => {
    const p = ps[i];
    let life = lifeAfterHits;
    let energy = p.energy - sapped[i];
    if (active[i]) {
      recoil[i] = cards[i].recoil ?? 0;
      healed[i] = healAmount(cards[i], life);
      life += healed[i] - recoil[i];
      energy += cards[i].cost;
    }
    p.life = clamp(life, 0, p.lifeMax);
    p.energy = clamp(energy, 0, p.energyMax);
    p.dazed = dazed[i];
  };

  // 2. Attacks. If both fighters attack, they strike one after the other (see strikeOrder);
  //    otherwise everything happens at once.
  const bothAttack = active[0] && active[1] && cards[0].kind === 'attack' && cards[1].kind === 'attack';
  const sequence = bothAttack ? strikeOrder(cards[0], cards[1], ps[0].life, ps[1].life) : null;

  if (sequence) {
    sequence.forEach((o, k) => {
      const i = o === 0 ? 1 : 0;
      const atk = cards[o];
      if (ps[o].life <= 0) {
        // Knocked out by the first strike: this attack never happens.
        interrupted[o] = true;
        return;
      }
      areas[o] = attackArea(state.arena, atk, ps[o].pos, ps[o].facing);
      if (!areas[o].some((p) => samePos(p, ps[i].pos))) {
        hit[i] = 'miss';
      } else {
        // The defender is attacking too, so it has no guard or counter this step.
        hit[i] = 'hit';
        damage[i] = hitDamage(atk, ps[o], ps[i], 0, moved[i]);
        ps[i].life = clamp(ps[i].life - damage[i], 0, ps[i].lifeMax);
        if (atk.drain && damage[i] > 0) {
          drained[o] = Math.floor((damage[i] * atk.drain) / 100);
          ps[o].life = clamp(ps[o].life + drained[o], 0, ps[o].lifeMax);
        }
        if (atk.stun && damage[i] > 0) dazed[i] = true;
        if (atk.sap) sapped[i] = atk.sap;
        hexHit(i, atk, damage[i]);
        if (atk.push && !ps[i].mods.immovable) {
          ps[i].pos = displace(state.arena, ps[i].pos, ps[o].pos, ps[o].facing, pushAmount(atk.push, ps[o].mods));
          reface();
        }
      }
      if (k === 0) midLives = [ps[0].life, ps[1].life];
    });
    for (const i of [0, 1] as const) selfEffects(i, ps[i].life);
  } else {
    // Hits, computed from post-movement positions.
    areas = [0, 1].map((i) =>
      active[i] && cards[i].kind === 'attack' ? attackArea(state.arena, cards[i], ps[i].pos, ps[i].facing) : [],
    ) as [Pos[], Pos[]];
    const pushTo: (Pos | null)[] = [null, null];
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
      damage[i] = hitDamage(atk, ps[o], ps[i], guard, moved[i]);
      if (active[i] && cards[i].counter) counter[o] += cards[i].counter!;
      if (atk.drain && damage[i] > 0) drained[o] = Math.floor((damage[i] * atk.drain) / 100);
      if (atk.stun && damage[i] > 0) dazed[i] = true;
      if (atk.sap) sapped[i] = atk.sap;
      // Only touches ps[i].hexed, which the other side's damage (worked out next) doesn't read.
      hexHit(i, atk, damage[i]);
      if (atk.push && !ps[i].mods.immovable) pushTo[i] = displace(state.arena, ps[i].pos, ps[o].pos, ps[o].facing, pushAmount(atk.push, ps[o].mods));
    }

    // 3. Self effects, then clamp.
    for (const i of [0, 1] as const) selfEffects(i, ps[i].life - damage[i] - counter[i] + drained[i]);

    // 4. Push and pull (simultaneous), then face each other again.
    for (const i of [0, 1] as const) {
      if (pushTo[i]) ps[i].pos = pushTo[i]!;
    }
    reface();
  }

  // Attacks break the enemy traps they cover, before any trap can spring this step.
  const brokenTraps: number[] = [];
  for (const o of [0, 1] as const) {
    for (const sq of areas[o]) {
      const at = sq.r * cols + sq.c;
      const left = state.arena.traps.filter((t) => !(t.at === at && t.owner !== o));
      if (left.length < state.arena.traps.length && !brokenTraps.includes(at)) brokenTraps.push(at);
      state.arena.traps = left;
    }
  }

  // Square effects for whoever ends the step on one.
  const tile: (TileKind | null)[] = [null, null];
  for (const i of [0, 1] as const) {
    const p = ps[i];
    tile[i] = tileAt(state.arena, p.pos);
    if (tile[i] === 'spikes') p.life = clamp(p.life - BALANCE.tiles.spikes, 0, p.lifeMax);
    else if (tile[i] === 'well') p.energy = clamp(p.energy + BALANCE.tiles.well, 0, p.energyMax);
  }

  // Enemy traps spring on whoever ends the step on them (each trap fires once).
  const trapDamage = [0, 0];
  for (const i of [0, 1] as const) {
    const at = ps[i].pos.r * cols + ps[i].pos.c;
    const hits = state.arena.traps.filter((t) => t.at === at && t.owner !== i);
    if (!hits.length) continue;
    trapDamage[i] = hits.reduce((sum, t) => sum + t.damage, 0);
    ps[i].life = clamp(ps[i].life - trapDamage[i], 0, ps[i].lifeMax);
    state.arena.traps = state.arena.traps.filter((t) => !hits.includes(t));
  }

  // New traps go down last, so they can only spring from the next step on.
  for (const i of [0, 1] as const) {
    if (!active[i] || cards[i].kind !== 'trap') continue;
    const damage = (cards[i].trap ?? 0) + ps[i].mods.trapBonus;
    for (const sq of attackArea(state.arena, cards[i], ps[i].pos, ps[i].facing)) {
      const at = sq.r * cols + sq.c;
      // One trap per owner per square: a new one replaces the old.
      state.arena.traps = state.arena.traps.filter((t) => !(t.at === at && t.owner === i));
      state.arena.traps.push({ at, owner: i, damage, until: state.round + 1 });
    }
  }

  // Ammo: fired attacks are spent; Reload makes them all usable again.
  const reloaded = [false, false];
  for (const i of [0, 1] as const) {
    if (!active[i]) continue;
    if (cards[i].kind === 'reload') {
      reloaded[i] = true;
      ps[i].spent = [];
    } else if (ps[i].mods.ammo && cards[i].kind === 'attack' && !ps[i].spent.includes(cardIds[i])) {
      ps[i].spent.push(cardIds[i]);
    }
  }

  // 5. KO check.
  state.outcome = outcomeFor(ps);

  const players = [0, 1].map((i) => ({
    cardId: cardIds[i],
    active: active[i],
    stunned: stunned[i],
    from: from[i],
    to: to[i],
    final: { ...ps[i].pos },
    moved: moved[i],
    facing: ps[i].facing,
    area: areas[i],
    hit: hit[i],
    damageTaken: damage[i],
    counterTaken: counter[i],
    drained: drained[i],
    dazed: dazed[i],
    interrupted: interrupted[i],
    reloaded: reloaded[i],
    tile: tile[i],
    swapped,
    trapDamage: trapDamage[i],
    recoilTaken: recoil[i],
    energyLost: sapped[i],
    hexApplied: hexApplied[i],
    hexBroken: hexBroken[i],
    hexed: ps[i].hexed,
    healed: healed[i],
    life: ps[i].life,
    energy: ps[i].energy,
  })) as [StepPlayerResult, StepPlayerResult];

  return {
    slot,
    players,
    outcome: state.outcome,
    sequence,
    midLives,
    traps: state.arena.traps.map((t: Trap) => ({ ...t })),
    brokenTraps,
  };
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
  const count = stepsPerRound(state);
  for (let slot = 0; slot < count; slot++) {
    steps.push(resolveStep(next, [plans[0][slot], plans[1][slot]], slot));
    if (next.outcome) break;
  }
  // Two-tap: the card after the ones that played stays locked in and plays first next round.
  if (state.variant === 'twoTap') next.players.forEach((p, i) => (p.carry = { held: plans[i][count] ?? null }));
  // Fatigue: late in a match both fighters wear down every round.
  let fatigue = 0;
  if (!next.outcome && state.round > fatigueAfterRound(state)) {
    fatigue = fatigueDamage(state);
    for (const p of next.players) p.life = Math.max(0, p.life - fatigue);
    next.outcome = outcomeFor(next.players);
  }
  // A stun on the last card of a round is wasted, except in Two-tap, where it cancels the held card.
  if (state.variant !== 'twoTap' || !TWO_TAP.carryDaze) for (const p of next.players) p.dazed = false;
  // Traps last until the end of the round after the one they were set in.
  next.arena.traps = next.arena.traps.filter((t) => t.until > state.round);
  if (!next.outcome) {
    for (const p of next.players) p.energy = Math.min(p.energyMax, p.energy + energyRecovery(p));
    next.round += 1;
  }
  return { steps, state: next, fatigue };
}
