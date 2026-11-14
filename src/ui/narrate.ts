import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import { STRINGS } from '../content/strings';
import { samePos, type PlaceIssue } from '../engine/rules';
import type { RoundResult, Seat, StepResult } from '../engine/types';

/*
 * Words for what happens in a match: the caption for each card as the reveal and recap play it,
 * the stamp it leaves on the played card, why a card can't be planned, and which first-time tips
 * a round calls for. Pure functions of the step results, so they can be tested without a page.
 */

/** One line on what `seat`'s card did this step, e.g. "Vex · Hex Bolt: hits Briar for 20, hexes (+20)". */
export function beatCaption(step: StepResult, seat: Seat, names: [string, string]): string {
  const N = STRINGS.narrate;
  const o = seat === 0 ? 1 : 0;
  const p = step.players[seat];
  const rival = step.players[o];
  const c = getCard(p.cardId);
  const line = (what: string) => N.card(names[seat], c.name, what);
  if (p.stunned) return line(N.stunned);
  if (!p.active) return line(N.fizzle);
  switch (c.kind) {
    case 'move': {
      if (c.swap) return line(p.swapped ? N.swaps : N.noSwap);
      // Where this move alone took them (a swap later in the step moves them again).
      const dest = p.swapped ? rival.to : p.to;
      return line(samePos(dest, p.from) ? N.stuck : N.moves);
    }
    case 'guard':
      return line(c.counter ? N.guardsCounter(c.guard ?? 0, c.counter) : N.guards(c.guard ?? 0));
    case 'focus':
      return line(N.focus(c.cost));
    case 'reload':
      return line(N.reload);
    case 'heal':
      return line(p.healed > 0 ? N.heals(p.healed) : N.noHeal(c.healAtOrBelow ?? 0));
    case 'trap':
      return line(N.traps);
    case 'attack': {
      if (p.interrupted) return line(N.late);
      const parts: string[] = [];
      if (rival.hit === 'miss') parts.push(N.misses);
      else if (rival.hit === 'guard' && rival.damageTaken === 0) parts.push(N.guarded(names[o]));
      else parts.push(rival.hit === 'guard' ? N.hitsGuard(names[o], rival.damageTaken) : N.hits(names[o], rival.damageTaken));
      if (rival.hit === 'hit' || rival.hit === 'guard') {
        if (rival.dazed) parts.push(N.stuns);
        if (c.push && !samePos(rival.to, rival.final)) parts.push(c.push > 0 ? N.pushes : N.pulls);
        if (rival.hexBroken) parts.push(N.breaksHex);
        else if (rival.hexApplied) parts.push(N.hexes(rival.hex));
        if (p.drained > 0) parts.push(N.drains(p.drained));
        if (rival.energyLost > 0) parts.push(N.saps(rival.energyLost));
        if (p.counterTaken > 0) parts.push(N.counter(p.counterTaken));
      }
      if (p.recoilTaken > 0) parts.push(N.recoil(p.recoilTaken));
      return line(parts.join(', '));
    }
  }
}

/** What happened at the end of the step (thorns, springs, traps springing), or null if nothing. */
export function endCaption(step: StepResult, names: [string, string]): string | null {
  const N = STRINGS.narrate;
  const parts: string[] = [];
  step.players.forEach((p, i) => {
    if (p.tile === 'spikes') parts.push(N.thorns(names[i], BALANCE.tiles.spikes));
    else if (p.tile === 'well') parts.push(N.spring(names[i], BALANCE.tiles.well));
    if (p.trapDamage > 0) parts.push(N.trapSprung(names[i], p.trapDamage));
  });
  return parts.length ? parts.join(' · ') : null;
}

export type StampKind = 'hit' | 'guarded' | 'blocked' | 'miss' | 'late' | 'fizzle' | 'gain' | 'heal' | 'trap';

/**
 * The outcome stamped on `seat`'s played card, or null for none (moves, a stunned card, which
 * already says so, and a guard nobody hit). A guard card's stamp comes from the attack it met.
 */
export function beatStamp(step: StepResult, seat: Seat): { kind: StampKind; text: string } | null {
  const S = STRINGS.stamps;
  const p = step.players[seat];
  const rival = step.players[seat === 0 ? 1 : 0];
  const c = getCard(p.cardId);
  if (p.stunned) return null;
  if (!p.active) return { kind: 'fizzle', text: S.fizzle };
  switch (c.kind) {
    case 'attack':
      if (p.interrupted) return { kind: 'late', text: S.late };
      if (rival.hit === 'miss') return { kind: 'miss', text: S.miss };
      if (rival.hit === 'guard' && rival.damageTaken === 0) return { kind: 'blocked', text: S.blocked };
      return { kind: rival.hit === 'guard' ? 'guarded' : 'hit', text: `−${rival.damageTaken}` };
    case 'guard': {
      if (p.hit !== 'guard') return null;
      const counter = rival.counterTaken > 0 ? ` ${STRINGS.effectIcons.counter}${rival.counterTaken}` : '';
      return { kind: 'blocked', text: (p.damageTaken === 0 ? S.blocked : `⛨${c.guard}`) + counter };
    }
    case 'focus':
      return { kind: 'gain', text: `+${c.cost}⚡` };
    case 'reload':
      return { kind: 'gain', text: '⟳' };
    case 'heal':
      return p.healed > 0 ? { kind: 'heal', text: `+${p.healed}♥` } : { kind: 'fizzle', text: S.noHeal };
    case 'trap':
      return { kind: 'trap', text: STRINGS.effectIcons.trap };
    default:
      return null;
  }
}

/** Why a card can't go into the plan, in words (null when there is nothing useful to say). */
export function whyNotText(issue: PlaceIssue, card: string): string | null {
  const W = STRINGS.whyNot;
  switch (issue.kind) {
    case 'full':
      return W.full;
    case 'used':
      return W.used(card);
    case 'reload':
      return W.reload(card);
    case 'planted':
      return W.planted(card);
    case 'energy':
      return W.energy(card, issue.need, issue.have, issue.step);
    case 'later':
      return W.later(card, issue.step);
    default:
      return null;
  }
}

/** First-time tips a round calls for, in the order they happened to matter (see STRINGS.firstTips). */
export function roundTips(result: RoundResult): string[] {
  const steps = result.steps;
  const players = steps.flatMap((s) => s.players);
  const tips: string[] = [];
  if (steps.some((s) => s.traps.length > 0)) tips.push('trap');
  if (players.some((p) => p.hexApplied)) tips.push('hex');
  if (players.some((p) => p.dazed)) tips.push('stun');
  if (players.some((p) => !samePos(p.to, p.final))) tips.push('push');
  if (steps.some((s) => s.sequence)) tips.push('first');
  if (result.fatigue > 0) tips.push('fatigue');
  return tips;
}
