import type { CardDef } from '../engine/types';

/*
 * A rough "fair" energy cost for a card, from what it does. Fitted to the built-in cards (attacks land
 * within about 5 energy of their real cost on average), so the hero creator can tell a custom card that
 * is cheap for its power from one that is fair or pricey. It is only advice: custom cards can cost
 * anything.
 */

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

/** Squares a pattern covers (before the board clips it). */
export function squares(pattern: CardDef['pattern']): number {
  return pattern ? pattern.join('').split('').filter((x) => x === '1').length : 0;
}

/** The energy a card of this power would cost among the built-in cards (a multiple of 5). */
export function fairCost(c: CardDef): number {
  switch (c.kind) {
    case 'attack': {
      const d = c.damage ?? 0;
      // Damage is worth more spread over more squares; each effect adds (or recoil takes away) value.
      let v = d * (1 + 0.1 * (squares(c.pattern) - 1));
      v += (c.stun ? 8 : 0) + (c.root ? 6 : 0) + Math.abs(c.push ?? 0) + ((c.drain ?? 0) / 100) * d * 0.8 + (c.sap ?? 0) * 0.2;
      v += (c.hex ?? 0) * 0.3 + (c.vsMoved ?? 0) * 0.6 - (c.recoil ?? 0) * 0.5;
      // A step on the attack (lunge or hit-and-run) is worth a little more for each square.
      if (c.step) v += 5 + 5 * Math.max(0, Math.abs(c.step[0]) + Math.abs(c.step[1]) - 1);
      if (c.planted) v *= 0.75;
      return round5(0.53 * Math.pow(Math.max(0, v), 1.08));
    }
    case 'trap':
      return round5(5 + (c.trap ?? 0) * squares(c.pattern) * 0.08);
    case 'guard':
      return round5((c.guard ?? 0) * 0.2 + (c.counter ?? 0) * 0.5 + (c.blockSap ?? 0) * 0.3 - 4);
    case 'move': {
      const dist = c.step ? Math.abs(c.step[0]) + Math.abs(c.step[1]) : 0;
      return round5(Math.max(0, dist - 1) * 5 + (c.counter ?? 0) * 0.5 + (c.swap ? 10 : 0));
    }
    case 'heal':
      return round5((c.heal ?? 0) * 1.4 * (c.healAtOrBelow !== undefined ? 0.85 : 1));
    default:
      return Math.max(0, -c.cost);
  }
}

export type Fairness = 'cheap' | 'fair' | 'pricey';

/** How a card's cost compares with its fair cost (within 5 energy counts as fair). */
export function fairness(c: CardDef): Fairness {
  const diff = -c.cost - fairCost(c);
  return diff < -5 ? 'cheap' : diff > 5 ? 'pricey' : 'fair';
}
