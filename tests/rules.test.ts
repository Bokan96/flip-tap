import { describe, expect, it } from 'vitest';
import { enumeratePlans } from '../src/engine/ai';
import { planError, resolveRound, RULES } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan } from '../src/engine/types';
import { contentStamp } from '../src/meta/replay';

describe('rules version', () => {
  it('a new rules revision changes the content stamp, so older replays show as made with an older version', () => {
    const before = contentStamp();
    RULES.revision++;
    try {
      expect(contentStamp()).not.toBe(before);
    } finally {
      RULES.revision--;
    }
  });

  it('golden match: when this changes, the rules changed, so bump RULES.revision (and update this)', () => {
    // Volta vs Vex on the classic board: a Thunderclap stun on the last card (carried into the next
    // round, where it cancels an unaffordable Flare for free), both fighters attacking in the same
    // step, a hex, and a swap that leaves the swapped fighter facing away.
    let s: MatchState = createMatch({ fighterId: 'volta' }, { fighterId: 'vex' }, {}, 'classic');
    const rounds: [Plan, Plan][] = [
      [['focus', 'guard', 'voltaClap'], ['guard', 'focus', 'left']],
      [['voltaZap', 'guard', 'focus'], ['vexFlare', 'vexHex', 'guard']],
      [['voltaZap', 'focus', 'guard'], ['vexHex', 'vexSwap', 'focus']],
      [['voltaCircuit', 'voltaZap', 'guard'], ['vexCurse', 'guard', 'vexHex']],
    ];
    const trail: string[] = [];
    for (const plans of rounds) {
      if (s.outcome) break;
      const r = resolveRound(s, plans);
      for (const st of r.steps) {
        const [a, b] = st.players;
        const facing = `${a.facing > 0 ? '>' : '<'}${b.facing > 0 ? '>' : '<'}`;
        trail.push(`${a.life}/${b.life} e${a.energy}/${b.energy} first:${st.sequence?.join('') ?? '-'} ${facing}${a.stunned || b.stunned ? ' stunned' : ''}`);
      }
      s = r.state;
    }
    expect({ trail, lives: s.players.map((p) => p.life), round: s.round, outcome: s.outcome }).toMatchInlineSnapshot(`
      {
        "lives": [
          40,
          0,
        ],
        "outcome": {
          "winner": 0,
        },
        "round": 4,
        "trail": [
          "100/100 e65/50 first:- ><",
          "100/100 e65/65 first:- ><",
          "100/60 e15/65 first:- ><",
          "100/35 e30/80 first:- >< stunned",
          "95/35 e30/60 first:- ><",
          "95/35 e45/60 first:- ><",
          "55/10 e60/65 first:10 ><",
          "55/10 e75/60 first:- >>",
          "55/10 e75/75 first:- >>",
          "40/0 e90/50 first:10 <>",
        ],
      }
    `);
  });
});

describe('a stunned CPU', () => {
  it('plans one throwaway first card per choice of the other two, all legal', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'volta' }, {}, 'classic');
    const p = s.players[1];
    p.energy = 20;
    const free = enumeratePlans(p);
    p.dazed = true;
    const stunned = enumeratePlans(p);
    const suffixes = stunned.map((plan) => plan.slice(1).join('|'));
    expect(new Set(suffixes).size).toBe(stunned.length);
    for (const plan of stunned) expect(planError(p, plan)).toBeNull();
    // The cancelled card is a basic one (any card would do the same, so it might as well be cheap).
    expect(stunned.every((plan) => ['guard', 'focus', 'up', 'down', 'left', 'right'].includes(plan[0]))).toBe(true);
    expect(free.length).toBeGreaterThan(stunned.length);
    expect(stunned.some((plan) => plan[1] === 'voltaClap' || plan[2] === 'voltaClap')).toBe(false); // 50 energy: never affordable at 20
  });
});
