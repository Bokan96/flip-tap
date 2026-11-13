import { BALANCE } from '../content/balance';
import { getCard } from '../content/cards';
import type { MatchLog, MatchState, Seat } from '../engine/types';

/** A single notable moment: who did it, with which card, how much and when. */
export interface Highlight {
  seat: Seat;
  card: string;
  damage: number;
  round: number;
}

export interface MatchStats {
  /** Life per seat: `lives[i][0]` at the start, `lives[i][k]` after round k. */
  lives: [number[], number[]];
  lifeMax: [number, number];
  rounds: number;
  /** Cards that actually resolved (stunned and unplayed ones don't count). */
  cardsPlayed: [number, number];
  /** Damage each seat dealt with each card (hits, counters and traps), largest first. */
  damageByCard: [{ card: string; damage: number }[], { card: string; damage: number }[]];
  damageDealt: [number, number];
  /** Per round, from seat 0's side: dealt more (win), less (loss) or the same (even). */
  trades: ('win' | 'loss' | 'even')[];
  biggestHit: Highlight | null;
  /** The strongest attack someone stepped out of the way of (`seat` is the dodger). */
  bestDodge: Highlight | null;
  /** Fatigue hurts from this round on. */
  fatigueFrom: number;
}

/** Summarise a finished (or unfinished) match. `start` is the state before round 1. */
export function matchStats(start: MatchState, log: MatchLog): MatchStats {
  const lives: [number[], number[]] = [[start.players[0].life], [start.players[1].life]];
  const cardsPlayed: [number, number] = [0, 0];
  const byCard: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
  const dealt: [number, number] = [0, 0];
  const trades: MatchStats['trades'] = [];
  let biggestHit: Highlight | null = null;
  let bestDodge: Highlight | null = null;
  // Trap damage lands steps after the card that set it.
  const lastTrap: (string | null)[] = [null, null];

  /** `card` is '' when the source isn't known (shown as "Other"). */
  const credit = (seat: Seat, card: string | null, n: number, round: number[]) => {
    if (n <= 0) return;
    const id = card ?? '';
    byCard[seat].set(id, (byCard[seat].get(id) ?? 0) + n);
    dealt[seat] += n;
    round[seat] += n;
  };

  log.rounds.forEach((r, k) => {
    const round = k + 1;
    const inRound = [0, 0];
    for (const step of r.result.steps) {
      const P = step.players;
      for (const i of [0, 1] as Seat[]) {
        const o: Seat = i === 0 ? 1 : 0;
        const mine = P[i];
        const card = getCard(mine.cardId);
        if (mine.active) cardsPlayed[i]++;
        // Traps from earlier cards (new ones only take effect from the next step).
        credit(i, lastTrap[i], P[o].trapDamage, inRound);
        if (mine.active && card.kind === 'trap') lastTrap[i] = mine.cardId;
        // Damage this seat's card did to the other seat this step.
        if (P[o].damageTaken > 0) {
          credit(i, mine.cardId, P[o].damageTaken, inRound);
          if (!biggestHit || P[o].damageTaken > biggestHit.damage) biggestHit = { seat: i, card: mine.cardId, damage: P[o].damageTaken, round };
        }
        credit(o, P[o].cardId, P[i].counterTaken, inRound);
        // A dodge: the other seat's attack missed because this seat moved out of the way.
        if (mine.hit === 'miss' && mine.moved) {
          const dmg = getCard(P[o].cardId).damage ?? 0;
          if (!bestDodge || dmg > bestDodge.damage) bestDodge = { seat: i, card: P[o].cardId, damage: dmg, round };
        }
      }
    }
    trades.push(inRound[0] > inRound[1] ? 'win' : inRound[0] < inRound[1] ? 'loss' : 'even');
    r.result.state.players.forEach((p, i) => lives[i].push(p.life));
  });

  const sorted = (m: Map<string, number>) =>
    [...m.entries()].filter(([, n]) => n > 0).map(([card, damage]) => ({ card, damage })).sort((a, b) => b.damage - a.damage);

  return {
    lives,
    lifeMax: [start.players[0].lifeMax, start.players[1].lifeMax],
    rounds: log.rounds.length,
    cardsPlayed,
    damageByCard: [sorted(byCard[0]), sorted(byCard[1])],
    damageDealt: dealt,
    trades,
    biggestHit,
    bestDodge,
    fatigueFrom: BALANCE.fatigueAfterRound + 1,
  };
}

/** One square per round for sharing: green = seat 0 dealt more, red = took more, white = even. */
export function tradeRow(trades: MatchStats['trades']): string {
  return trades.map((t) => (t === 'win' ? '🟩' : t === 'loss' ? '🟥' : '⬜')).join('');
}
