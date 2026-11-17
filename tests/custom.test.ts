import { beforeEach, describe, expect, it } from 'vitest';
import { CARDS, FIGHTERS, getCard, getFighter, isCustomFighter, registerCustom } from '../src/content/cards';
import { fairCost } from '../src/content/fairCost';
import { SIM_PROFILE } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { createMatch } from '../src/engine/setup';
import type { CardDef } from '../src/engine/types';
import {
  cleanCard,
  cleanHero,
  cleanName,
  customData,
  deleteCard,
  heroEmblem,
  heroFighter,
  resetCustomCache,
  saveCard,
  saveHero,
  type CustomHero,
} from '../src/meta/custom';
import { contentStamp } from '../src/meta/replay';
import { memoryStorage, setStorageBackend } from '../src/meta/storage';
import { customFor } from '../src/net/transport';
import { emblemHtml, HERO_EMBLEM_KEYS } from '../src/ui/emblems';

const bolt: CardDef = { id: 'cc-bolt', name: 'Bolt', kind: 'attack', cost: -20, damage: 30, pattern: ['000', '011', '000'], stun: true };
const hero: CustomHero = { id: 'ch-test', name: 'Testa', emblem: 'star', color: '#3da5ff', cards: ['cc-bolt', 'cinderJab', 'vexSwap', 'leech'] };

beforeEach(() => {
  setStorageBackend(memoryStorage());
  resetCustomCache();
  registerCustom([], []);
});

describe('cleaning what the hero creator saves', () => {
  it('keeps names safe for the page', () => {
    expect(cleanName('<b>Ćira</b> "x"')).toBe('bĆirab x');
    expect(cleanName('  Iron   Wolf  ')).toBe('Iron Wolf');
    expect(cleanName('a'.repeat(40))).toHaveLength(16);
  });

  it('keeps only the fields a card kind allows, in range', () => {
    expect(cleanCard(bolt)).toEqual(bolt);
    expect(cleanCard({ ...bolt, damage: 999, cost: -333 })).toMatchObject({ damage: 100, cost: -100 });
    expect(cleanCard({ ...bolt, pattern: ['000', '000', '000'] })).toBeNull(); // no squares
    expect(cleanCard({ ...bolt, id: 'cinderJab' })).toBeNull(); // not a custom id
    const guard = cleanCard({ id: 'cc-wall', name: 'Wall', kind: 'guard', cost: -10, guard: 30, stun: true, damage: 50, blockSap: 10 })!;
    expect(guard).toEqual({ id: 'cc-wall', name: 'Wall', kind: 'guard', cost: -10, guard: 30, blockSap: 10 });
    const swap = cleanCard({ id: 'cc-blink', name: 'Blink', kind: 'move', cost: -5, swap: true, step: [0, 2] })!;
    expect(swap.step).toBeUndefined();
    expect(swap.swap).toBe(true);
  });

  it('needs 4 different usable cards for a hero', () => {
    const ids = new Set(['cc-bolt']);
    expect(cleanHero(hero, ids)).toEqual(hero);
    expect(cleanHero({ ...hero, cards: ['cc-bolt', 'cinderJab', 'vexSwap'] }, ids)).toBeNull();
    expect(cleanHero({ ...hero, cards: ['cc-bolt', 'cinderJab', 'vexSwap', 'guard'] }, ids)).toBeNull(); // a basic card
    expect(cleanHero({ ...hero, cards: ['cc-bolt', 'cinderJab', 'cinderJab', 'leech'] }, ids)).toBeNull();
    expect(cleanHero(hero, new Set())).toBeNull(); // its custom card is gone
    expect(cleanHero({ ...hero, color: 'red;}', emblem: 'nope' }, ids)).toMatchObject({ color: '#ff6b3d', emblem: HERO_EMBLEM_KEYS[0] });
  });

  it('gives heroes their own icons, never a fighter emblem', () => {
    const ids = new Set(['cc-bolt']);
    const fighterEmblems = new Set(FIGHTERS.map((f) => f.emblem));
    expect(HERO_EMBLEM_KEYS.length).toBeGreaterThanOrEqual(12);
    expect(HERO_EMBLEM_KEYS.filter((k) => fighterEmblems.has(k))).toEqual([]);
    // A hero saved with a fighter's emblem (before heroes had their own) gets a matching hero icon.
    expect(cleanHero({ ...hero, emblem: 'bolt' }, ids)?.emblem).toBe('star');
    expect(cleanHero({ ...hero, emblem: 'flame' }, ids)?.emblem).toBe('sun');
    for (const f of FIGHTERS) expect(HERO_EMBLEM_KEYS).toContain(heroEmblem(f.emblem));
    // Every hero icon has its own drawing (none falls back to the default hexagon).
    const drawn = HERO_EMBLEM_KEYS.map((k) => emblemHtml(heroFighter({ ...hero, emblem: k })));
    expect(new Set([...drawn, emblemHtml(heroFighter({ ...hero, emblem: 'hex' }))]).size).toBe(drawn.length + 1);
  });
});

describe('custom heroes in play', () => {
  it('are found by id but stay out of the built-in lists and the replay check', () => {
    const stamp = contentStamp();
    const fighters = FIGHTERS.length;
    registerCustom([bolt], [heroFighter(hero)]);
    expect(getCard('cc-bolt')).toBe(bolt);
    expect(getFighter('ch-test').signature).toEqual(hero.cards);
    expect(isCustomFighter('ch-test')).toBe(true);
    expect(isCustomFighter('cinder')).toBe(false);
    expect(FIGHTERS).toHaveLength(fighters);
    expect(CARDS['cc-bolt']).toBeUndefined();
    expect(contentStamp()).toBe(stamp);
  });

  it('travel to the CPU worker with the match that uses them', () => {
    registerCustom([bolt], [heroFighter(hero)]);
    const s = createMatch({ fighterId: 'ch-test' }, { fighterId: 'marin' });
    expect(customFor(s)).toEqual({ cards: [bolt], fighters: [getFighter('ch-test')] });
    expect(customFor(createMatch({ fighterId: 'cinder' }, { fighterId: 'marin' }))).toBeUndefined();
  });

  it('play a whole match against the CPU', () => {
    registerCustom([bolt], [heroFighter(hero)]);
    const rec = runMatch({ fighterId: 'ch-test' }, { fighterId: 'basalt' }, { seed: 3, profiles: [SIM_PROFILE, SIM_PROFILE] });
    expect(rec.rounds).toBeGreaterThan(0);
    expect(rec.final.players[0].deck).toEqual(expect.arrayContaining(['cc-bolt', 'cinderJab', 'vexSwap', 'leech']));
  });

  it('are saved, loaded back, and a card in use can’t be deleted', () => {
    expect(saveHero(hero)).toBeNull(); // its custom card doesn't exist yet
    expect(saveCard(bolt)).toEqual(bolt);
    expect(saveHero(hero)).toEqual(hero);
    resetCustomCache();
    expect(customData()).toEqual({ heroes: [hero], cards: [bolt] });
    expect(deleteCard('cc-bolt')).toBe(false);
  });
});

describe('fair cost', () => {
  it('lands near the built-in attacks’ real costs', () => {
    const attacks = Object.values(CARDS).filter((c) => c.kind === 'attack');
    const err = attacks.reduce((n, c) => n + Math.abs(fairCost(c) + c.cost), 0) / attacks.length;
    expect(err).toBeLessThan(8);
    expect(fairCost(CARDS.guard)).toBe(0);
  });
});
