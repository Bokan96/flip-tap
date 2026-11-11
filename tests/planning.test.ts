import { describe, expect, it } from 'vitest';
import { choosePlan } from '../src/engine/ai';
import { Rng } from '../src/engine/rng';
import { autoFillPlan, partialPlanOk, planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import { createTutorialMatch, scriptedPlan, TUTORIAL } from '../src/tutorial';

const AUTO = ['guard', 'up', 'down', 'left', 'right', 'focus'];

describe('partial plans', () => {
  it('accepts gaps but rejects duplicates, foreign cards and energy debt', () => {
    const p = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' }).players[0];
    expect(partialPlanOk(p, ['', 'cinderJab', ''])).toBe(true);
    expect(partialPlanOk(p, ['up', '', 'up'])).toBe(false);
    expect(partialPlanOk(p, ['marinSplash', '', ''])).toBe(false);
    p.energy = 40;
    expect(partialPlanOk(p, ['cinderBlaze', '', ''])).toBe(false);
    expect(partialPlanOk(p, ['focus', 'cinderBlaze', ''])).toBe(true);
    // Swapping the order breaks the energy trace.
    expect(partialPlanOk(p, ['cinderBlaze', 'focus', ''])).toBe(false);
  });

  it('auto-fill completes any partial plan with free cards', () => {
    const p = createMatch({ fighterId: 'volta' }, { fighterId: 'marin' }).players[0];
    p.energy = 0;
    const filled = autoFillPlan(p, ['', '', ''], AUTO);
    expect(planError(p, filled)).toBeNull();
    expect(filled).toEqual(['guard', 'up', 'down']);
    p.energy = 60;
    const kept = autoFillPlan(p, ['', 'voltaClap', ''], AUTO);
    expect(kept[1]).toBe('voltaClap');
    expect(planError(p, kept)).toBeNull();
  });
});

describe('tutorial', () => {
  it('the dummy’s scripted plans stay legal whatever the player does', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = new Rng(seed);
      let s = createTutorialMatch();
      expect(s.players[1].life).toBe(TUTORIAL.dummyLife);
      while (!s.outcome && s.round <= 12) {
        const dummy = scriptedPlan(s.round);
        expect(planError(s.players[1], dummy)).toBeNull();
        s = resolveRound(s, [choosePlan(s, 0, 'easy', rng), dummy]).state;
      }
    }
  });
});
