/** Core rule numbers. Tweak here; the engine reads everything from this object. */
export const BALANCE = {
  rows: 3,
  cols: 4,
  slotsPerRound: 3,
  lifeMax: 100,
  energyMax: 100,
  energyPerRound: 15,
  /** [row, col] start squares for seat 0 and seat 1. */
  startPos: [
    { r: 1, c: 0 },
    { r: 1, c: 3 },
  ],
  /** Each card may appear at most once in a plan. */
  uniqueCardsPerPlan: true,
} as const;
