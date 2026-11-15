import { beforeEach, describe, expect, it } from 'vitest';
import { CARDS } from '../src/content/cards';
import { TWO_TAP } from '../src/content/variants';
import { energyRecovery, placeIssue, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';
import { markTipSeen, resetProfile, tipSeen } from '../src/meta/profile';
import { memoryStorage, setStorageBackend } from '../src/meta/storage';
import { beatCaption, beatStamp, endCaption, partLabel, roundTips, whyNotText } from '../src/ui/narrate';

const NAMES: [string, string] = ['P1', 'P2'];
const IDLE: Plan = ['guard', 'focus', 'up'];

/** A match on the 3×4 board with both fighters placed and at full energy. */
function duel(a: string, b: string, posA: Pos, posB: Pos, bonusA: string[] = []): MatchState {
  const s = createMatch({ fighterId: a, bonusCards: bonusA }, { fighterId: b }, {}, 'quarters');
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  for (const p of s.players) p.energy = p.energyMax;
  return s;
}

describe('why a card can’t be planned', () => {
  it('names each reason, in the same order the rules check them', () => {
    const cinder = duel('cinder', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 }).players[0];
    expect(placeIssue(cinder, ['guard', 'up', 'down'], -1, 'focus')).toEqual({ kind: 'full' });
    expect(placeIssue(cinder, ['guard', '', ''], 1, 'guard')).toEqual({ kind: 'used' });
    expect(placeIssue(cinder, ['guard', '', ''], 1, 'focus')).toBeNull();

    const ferro = duel('ferro', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 }).players[0];
    ferro.spent = ['ferroSnap'];
    expect(placeIssue(ferro, ['', '', ''], 0, 'ferroSnap')).toEqual({ kind: 'reload' });
    expect(placeIssue(ferro, ['ferroReload', '', ''], 1, 'ferroSnap')).toBeNull();

    const basalt = duel('basalt', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 }).players[0];
    expect(placeIssue(basalt, ['up', '', ''], 1, 'basaltCrush')).toEqual({ kind: 'planted' });
  });

  it('tells the card that costs too much from the one that starves a later card', () => {
    const p = duel('cinder', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 }).players[0];
    p.energy = 10;
    expect(placeIssue(p, ['', '', ''], 0, 'cinderBlaze')).toEqual({ kind: 'energy', need: 45, have: 10, step: 1 });
    p.energy = 30;
    // Ember Jab (15) fits, but then Fire Ring (20) in step 2 can't be paid.
    expect(placeIssue(p, ['', 'cinderRing', ''], 0, 'cinderJab')).toEqual({ kind: 'later', step: 2 });
    expect(whyNotText({ kind: 'later', step: 2 }, 'Ember Jab')).toContain('step 2');
    expect(whyNotText({ kind: 'energy', need: 45, have: 10, step: 1 }, 'Wildfire')).toContain('45');
  });

  it('counts Two-tap’s refill before the held-over card', () => {
    const s = createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' }, {}, 'classic', 'twoTap');
    const p = s.players[0];
    p.energy = 0;
    const refill = energyRecovery(p);
    expect(refill).toBe(TWO_TAP.energyPerRound);
    const issue = placeIssue(p, ['guard', 'up', ''], 2, 'cinderJab');
    if (refill >= 15) expect(issue).toBeNull();
    else expect(issue).toEqual({ kind: 'energy', need: 15, have: refill, step: 3 });
  });
});

describe('captions and stamps', () => {
  it('say what each card did', () => {
    // Vex hexes Marin with Hex Bolt while Marin focuses.
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    const step = resolveRound(s, [['vexHex', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0];
    expect(beatCaption(step, 0, NAMES)).toBe(`P1 · ${CARDS.vexHex.name}: hits P2 for 20, hexes (+20)`);
    expect(beatCaption(step, 1, NAMES)).toBe(`P2 · ${CARDS.focus.name}: gains 15⚡`);
    expect(beatStamp(step, 0)).toEqual({ kind: 'hit', text: '−20' });
    expect(beatStamp(step, 1)).toEqual({ kind: 'gain', text: '+15⚡' });
    expect(endCaption(step, NAMES)).toBeNull();
  });

  it('cover misses, blocks and the guard that blocked', () => {
    const far = duel('vex', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 });
    const miss = resolveRound(far, [['vexHex', 'guard', 'focus'], IDLE]).steps[0];
    expect(beatCaption(miss, 0, NAMES)).toContain('misses');
    expect(beatStamp(miss, 0)?.kind).toBe('miss');

    const near = duel('marin', 'vex', { r: 1, c: 1 }, { r: 1, c: 2 }, ['bulwark']);
    const blocked = resolveRound(near, [['bulwark', 'guard', 'focus'], ['vexHex', 'guard', 'focus']]).steps[0];
    expect(beatCaption(blocked, 1, NAMES)).toContain('P1 blocks it');
    expect(beatStamp(blocked, 1)?.kind).toBe('blocked');
    expect(beatStamp(blocked, 0)).toEqual({ kind: 'blocked', text: 'Blocked' });
  });

  it('tell a move from a move into a wall, and a trap springing at the end of a step', () => {
    // Briar's Snare traps the square in front; Marin steps onto it in step 2.
    const s = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 });
    const r = resolveRound(s, [['briarSnare', 'guard', 'focus'], ['focus', 'left', 'up']]);
    expect(beatCaption(r.steps[0], 0, NAMES)).toContain(CARDS.briarSnare.name);
    expect(beatStamp(r.steps[0], 0)?.kind).toBe('trap');
    expect(beatCaption(r.steps[1], 1, NAMES)).toContain('moves');
    expect(endCaption(r.steps[1], NAMES)).toBe(`P2 steps on a trap: −${CARDS.briarSnare.trap}`);
    // Step Up from the top row goes nowhere.
    const top = duel('cinder', 'marin', { r: 0, c: 0 }, { r: 1, c: 3 });
    expect(beatCaption(resolveRound(top, [['up', 'guard', 'focus'], IDLE]).steps[0], 0, NAMES)).toContain('can’t move there');
  });
});

describe('a hit’s bonus damage, shown on its own', () => {
  it('splits a hex and a low-life passive off the card’s own damage', () => {
    // Flare (40) on a target hexed for 20.
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[1].hex = 20;
    const step = resolveRound(s, [['vexFlare', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0];
    expect(step.players[1].damageParts).toEqual([{ kind: 'card', amount: 40 }, { kind: 'hex', amount: 20 }]);
    expect(step.players[1].damageTaken).toBe(60);
    expect(beatCaption(step, 0, NAMES, ['vex', 'marin'])).toContain('hits P2 for 60 (40 + 20 Hex)');

    // Cinder at 50 life: Kindle adds 10 to Ember Jab.
    const c = duel('cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    c.players[0].life = 50;
    const jab = resolveRound(c, [['cinderJab', 'guard', 'focus'], ['focus', 'guard', 'up']]).steps[0];
    expect(jab.players[1].damageParts).toEqual([{ kind: 'card', amount: CARDS.cinderJab.damage }, { kind: 'lowLife', amount: 10 }]);
    expect(partLabel('lowLife', 'cinder')).toBe('Kindle');
  });

  it('takes guard off the card’s own part first', () => {
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.players[1].hex = 20;
    const step = resolveRound(s, [['vexHex', 'guard', 'focus'], ['guard', 'focus', 'up']]).steps[0];
    // Hex Bolt 20 − Guard 15 = 5 from the card, then the hex's 20.
    expect(step.players[1].damageParts).toEqual([{ kind: 'card', amount: 5 }, { kind: 'hex', amount: 20 }]);
    expect(step.players[1].damageTaken).toBe(25);
  });
});

describe('first-time tips', () => {
  beforeEach(() => {
    setStorageBackend(memoryStorage());
    resetProfile();
  });

  it('a round calls for the tips of what happened in it', () => {
    const s = duel('vex', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    expect(roundTips(resolveRound(s, [['vexHex', 'guard', 'focus'], ['focus', 'guard', 'up']]))).toEqual(['hex']);
    const t = duel('briar', 'marin', { r: 1, c: 1 }, { r: 1, c: 3 });
    expect(roundTips(resolveRound(t, [['briarSnare', 'guard', 'focus'], IDLE]))).toContain('trap');
  });

  it('are remembered once seen', () => {
    expect(tipSeen('hex')).toBe(false);
    markTipSeen('hex');
    markTipSeen('hex');
    expect(tipSeen('hex')).toBe(true);
    expect(tipSeen('trap')).toBe(false);
  });
});
