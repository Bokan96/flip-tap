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
        "zephyr": 58,
        "basalt": 45,
        "volta": 59,
        "umbra": 54,
        "ferro": 44,
        "briar": 50,
        "vex": 41
      },
      "marin": {
        "cinder": 52,
        "zephyr": 46,
        "basalt": 36,
        "volta": 42,
        "umbra": 53,
        "ferro": 63,
        "briar": 58,
        "vex": 59
      },
      "zephyr": {
        "cinder": 43,
        "marin": 54,
        "basalt": 49,
        "volta": 43,
        "umbra": 55,
        "ferro": 44,
        "briar": 48,
        "vex": 49
      },
      "basalt": {
        "cinder": 55,
        "marin": 64,
        "zephyr": 51,
        "volta": 42,
        "umbra": 44,
        "ferro": 41,
        "briar": 48,
        "vex": 50
      },
      "volta": {
        "cinder": 41,
        "marin": 58,
        "zephyr": 57,
        "basalt": 58,
        "umbra": 44,
        "ferro": 45,
        "briar": 48,
        "vex": 60
      },
      "umbra": {
        "cinder": 46,
        "marin": 47,
        "zephyr": 45,
        "basalt": 56,
        "volta": 56,
        "ferro": 59,
        "briar": 37,
        "vex": 51
      },
      "ferro": {
        "cinder": 56,
        "marin": 38,
        "zephyr": 56,
        "basalt": 59,
        "volta": 55,
        "umbra": 41,
        "briar": 50,
        "vex": 44
      },
      "briar": {
        "cinder": 50,
        "marin": 43,
        "zephyr": 53,
        "basalt": 53,
        "volta": 52,
        "umbra": 63,
        "ferro": 50,
        "vex": 55
      },
      "vex": {
        "cinder": 59,
        "marin": 41,
        "zephyr": 51,
        "basalt": 50,
        "volta": 40,
        "umbra": 49,
        "ferro": 56,
        "briar": 45
      }
    }
  }
];
