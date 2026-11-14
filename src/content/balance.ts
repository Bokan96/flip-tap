/** Core rule numbers. Tweak here; the engine reads everything from this object. */
export const BALANCE = {
  slotsPerRound: 3,
  lifeMax: 100,
  energyMax: 100,
  /** Fighters start a match with this much energy (life starts full). */
  energyStart: 50,
  energyPerRound: 15,
  /** From the round after this one, both fighters lose `fatigueDamage` life at the end of every round. */
  fatigueAfterRound: 7,
  fatigueDamage: 5,
  /** Extra damage of the hit that breaks a hex (plus the attacker's hexBonus). */
  hexDamage: 10,
  /** What arena squares do to a fighter ending a step on them (see content/arenas.ts). */
  tiles: { spikes: 10, well: 10 },
  /** Each card may appear at most once in a plan. */
  uniqueCardsPerPlan: true,
  /** How many bonus cards a player can bring into a match. */
  bonusSlots: 3,
} as const;
