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
  it('the round-1 lesson (Step Right, Ember Jab, Guard) hits the dummy', () => {
    const s = createTutorialMatch();
    const r = resolveRound(s, [['right', 'cinderJab', 'guard'], scriptedPlan(1)]);
    expect(r.steps[1].players[1].hit).toBe('hit');
  });

  it('in round 2 the dummy’s Splash hits a player who stays in the middle row', () => {
    let s = createTutorialMatch();
    s = resolveRound(s, [['right', 'cinderJab', 'guard'], scriptedPlan(1)]).state;
    const r = resolveRound(s, [['guard', 'focus', 'left'], scriptedPlan(2)]);
    expect(r.steps[1].players[0].hit).not.toBe('miss');
    const dodge = resolveRound(s, [['up', 'focus', 'guard'], scriptedPlan(2)]);
    expect(dodge.steps[1].players[0].hit).toBe('miss');
  });

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

describe('attack styles', () => {
  it('every attack gets a style, guessed from its pattern when not set', async () => {
    const { fxKind } = await import('../src/ui/fx');
    const { CARDS } = await import('../src/content/cards');
    const kinds = ['slash', 'burst', 'wave', 'beam', 'quake'];
    for (const c of Object.values(CARDS)) if (c.kind === 'attack') expect(kinds).toContain(fxKind(c));
    expect(fxKind(CARDS.zephyrSpiral)).toBe('burst');
    expect(fxKind(CARDS.basaltQuake)).toBe('quake');
    expect(fxKind(CARDS.cinderPillar)).toBe('beam');
    expect(fxKind(CARDS.marinSplash)).toBe('wave');
    expect(fxKind(CARDS.zephyrShear)).toBe('slash');
    expect(fxKind(CARDS.cinderJab)).toBe('slash'); // set explicitly on the card
  });
});
