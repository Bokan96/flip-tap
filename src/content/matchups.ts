/**
 * How even each fighter pairing is, from the balance simulations (`DAILY=YYYY-MM-DD npm run balance`
 * appends a table; see sim/balance.sim.ts). The daily challenge only draws pairings inside a table's
 * band, using the newest table whose `from` date has come, so earlier days keep their challenge.
 */
export interface MatchupTable {
  /** First daily challenge date (YYYY-MM-DD) this table applies to. */
  from: string;
  /** Scores (row fighter's %, wins + half of draws) allowed for a daily pairing, inclusive. */
  band: [number, number];
  /** scores[a][b]: fighter a's score against fighter b, in %. */
  scores: Record<string, Record<string, number>>;
}

export const MATCHUP_TABLES: MatchupTable[] = [
  {
    "from": "2026-11-20",
    "band": [
      40,
      60
    ],
    "scores": {
      "cinder": {
        "marin": 48,
        "zephyr": 51,
        "basalt": 45,
        "volta": 59,
        "umbra": 52,
        "ferro": 44,
        "briar": 50,
        "vex": 41
      },
      "marin": {
        "cinder": 52,
        "zephyr": 56,
        "basalt": 36,
        "volta": 42,
        "umbra": 38,
        "ferro": 63,
        "briar": 58,
        "vex": 59
      },
      "zephyr": {
        "cinder": 49,
        "marin": 44,
        "basalt": 51,
        "volta": 51,
        "umbra": 45,
        "ferro": 43,
        "briar": 46,
        "vex": 63
      },
      "basalt": {
        "cinder": 55,
        "marin": 64,
        "zephyr": 49,
        "volta": 42,
        "umbra": 48,
        "ferro": 41,
        "briar": 48,
        "vex": 50
      },
      "volta": {
        "cinder": 41,
        "marin": 58,
        "zephyr": 49,
        "basalt": 58,
        "umbra": 51,
        "ferro": 45,
        "briar": 48,
        "vex": 60
      },
      "umbra": {
        "cinder": 48,
        "marin": 63,
        "zephyr": 55,
        "basalt": 53,
        "volta": 49,
        "ferro": 53,
        "briar": 42,
        "vex": 44
      },
      "ferro": {
        "cinder": 56,
        "marin": 38,
        "zephyr": 58,
        "basalt": 59,
        "volta": 55,
        "umbra": 47,
        "briar": 50,
        "vex": 44
      },
      "briar": {
        "cinder": 50,
        "marin": 43,
        "zephyr": 54,
        "basalt": 53,
        "volta": 52,
        "umbra": 58,
        "ferro": 50,
        "vex": 55
      },
      "vex": {
        "cinder": 59,
        "marin": 41,
        "zephyr": 38,
        "basalt": 50,
        "volta": 40,
        "umbra": 56,
        "ferro": 56,
        "briar": 45
      }
    }
  }
];
