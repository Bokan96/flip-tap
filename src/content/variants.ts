/** Rule variants a match can be played with. A match without one plays the classic rules. */
export type Variant = 'twoTap';

export const VARIANTS: readonly Variant[] = ['twoTap'];

/**
 * Two-tap: round 1 is planned as usual (3 cards), but each round only the first two cards play.
 * The third stays face-down and locked in, and plays first next round, so every later round
 * plans 2 new cards behind it. Rounds are shorter, so the energy refill and the fatigue clock are
 * scaled to keep about the same pace per step as the classic rules.
 */
export const TWO_TAP = {
  /** Cards that play each round; the next slot is held over to the next round. */
  stepsPerRound: 2,
  energyPerRound: 10,
  fatigueAfterRound: 10,
  fatigueDamage: 5,
  /** A stun on a round's last card carries over and cancels the held card. */
  carryDaze: true,
};
