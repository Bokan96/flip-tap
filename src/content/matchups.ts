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
        "marin": 59,
        "zephyr": 57,
        "basalt": 48,
        "volta": 60,
        "umbra": 48,
        "ferro": 40,
        "briar": 49,
        "vex": 43
      },
      "marin": {
        "cinder": 41,
        "zephyr": 56,
        "basalt": 36,
        "volta": 42,
        "umbra": 38,
        "ferro": 63,
        "briar": 58,
        "vex": 43
      },
      "zephyr": {
        "cinder": 43,
        "marin": 44,
        "basalt": 51,
        "volta": 51,
        "umbra": 48,
        "ferro": 43,
        "briar": 46,
        "vex": 57
      },
      "basalt": {
        "cinder": 53,
        "marin": 64,
        "zephyr": 49,
        "volta": 42,
        "umbra": 46,
        "ferro": 41,
        "briar": 48,
        "vex": 50
      },
      "volta": {
        "cinder": 40,
        "marin": 58,
        "zephyr": 49,
        "basalt": 58,
        "umbra": 51,
        "ferro": 45,
        "briar": 48,
        "vex": 48
      },
      "umbra": {
        "cinder": 52,
        "marin": 63,
        "zephyr": 52,
        "basalt": 54,
        "volta": 49,
        "ferro": 52,
        "briar": 42,
        "vex": 46
      },
      "ferro": {
        "cinder": 60,
        "marin": 38,
        "zephyr": 58,
        "basalt": 59,
        "volta": 55,
        "umbra": 48,
        "briar": 50,
        "vex": 53
      },
      "briar": {
        "cinder": 51,
        "marin": 43,
        "zephyr": 54,
        "basalt": 53,
        "volta": 52,
        "umbra": 58,
        "ferro": 50,
        "vex": 48
      },
      "vex": {
        "cinder": 57,
        "marin": 57,
        "zephyr": 43,
        "basalt": 50,
        "volta": 52,
        "umbra": 54,
        "ferro": 48,
        "briar": 52
      }
    }
  }
];
