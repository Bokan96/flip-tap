import { STRINGS } from './content/strings';
import { choosePlan } from './engine/ai';
import { Rng } from './engine/rng';
import { planError } from './engine/rules';
import { createMatch } from './engine/setup';
import type { MatchState, Plan, Seat } from './engine/types';
import type { PlanSource } from './net/transport';
import type { BattleHooks } from './ui/battle';

/*
 * Guided first match: the player (seat 0) against a scripted training dummy (seat 1).
 * Tips are contextual suggestions; the player is never forced to follow them.
 */

export const TUTORIAL = {
  player: 'cinder',
  dummy: 'marin',
  dummyLife: 70,
  /** The dummy's plan for rounds 1, 2, 3...; after the list it repeats from `loopFrom`. */
  dummyPlans: [
    ['left', 'focus', 'up'],
    ['down', 'marinSplash', 'guard'],
    ['focus', 'guard', 'marinSplash'],
    ['guard', 'marinSplash', 'focus'],
  ] as Plan[],
  loopFrom: 2,
};

export function createTutorialMatch(): MatchState {
  const state = createMatch({ fighterId: TUTORIAL.player }, { fighterId: TUTORIAL.dummy });
  state.players[1].life = TUTORIAL.dummyLife;
  // The script is built for these squares (the dummy steps left as you step right in round 1, so
  // "Step Right, then Ember Jab" lands), whatever the normal start is.
  state.players[0].pos = { r: 1, c: 0 };
  state.players[1].pos = { r: 1, c: state.arena.cols - 2 };
  return state;
}

export function scriptedPlan(round: number): Plan {
  const plans = TUTORIAL.dummyPlans;
  const i = round - 1;
  if (i < plans.length) return plans[i];
  const loop = plans.length - TUTORIAL.loopFrom;
  return plans[TUTORIAL.loopFrom + ((i - TUTORIAL.loopFrom) % loop)];
}

/** Plays the scripted plan for each round (or a simple CPU plan if it isn't legal). */
export class ScriptedPlanSource implements PlanSource {
  readonly kind = 'cpu' as const;

  async requestPlan(state: MatchState, seat: Seat): Promise<Plan> {
    await new Promise((r) => setTimeout(r, 400));
    const plan = scriptedPlan(state.round);
    if (!planError(state.players[seat], plan)) return [...plan];
    return choosePlan(state, seat, 'easy', new Rng(state.round));
  }
}

/** Coaching tips keyed to what happens in the match. */
export function tutorialHooks(): BattleHooks {
  const T = STRINGS.tutorial;
  let round = 0;
  const shown = new Set<string>();
  const once = (key: string) => {
    if (shown.has(key)) return false;
    shown.add(key);
    return true;
  };

  return {
    async planStart(view, r) {
      round = r;
      view.setHighlight(null);
      if (r === 1) {
        await view.coach(T.r1a);
        await view.coach(T.r1b);
        view.setHighlight('.hand [data-card="right"]');
      } else if (r === 2) {
        await view.coach(T.r2);
        view.setHighlight('.hand [data-card="up"], .hand [data-card="down"]');
      } else if (r === 3) {
        await view.coach(T.r3);
        view.setHighlight('.hand [data-card="focus"]');
      } else if (r === 4) {
        await view.coach(T.r4);
      }
    },

    planChanged(view, plan) {
      const full = plan.every(Boolean);
      if (full) return view.setHighlight('[data-act="lock"]');
      if (round !== 1) return view.setHighlight(null);
      if (plan.includes('right') && !plan.includes('cinderJab')) {
        view.setHighlight('.hand [data-card="cinderJab"]');
        if (once('r1c')) void view.coach(T.r1c);
      } else if (plan.includes('cinderJab')) {
        view.setHighlight('.hand [data-card="guard"]');
        if (once('r1d')) void view.coach(T.r1d);
      }
    },

    async roundEnd(view, r, result) {
      view.setHighlight(null);
      if (r === 1) {
        const landed = result.steps.some((s) => s.players[1].hit === 'hit' || s.players[1].hit === 'guard');
        await view.coach(landed ? T.r1hit : T.r1miss);
      } else if (r === 2) {
        const hit = result.steps[1]?.players[0].hit;
        if (hit === 'miss') await view.coach(T.r2dodged);
        else if (hit === 'hit' || hit === 'guard') await view.coach(T.r2hit);
      }
    },
  };
}
