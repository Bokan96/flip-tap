import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { ARENAS } from '../src/content/arenas';
import { BALANCE } from '../src/content/balance';
import { CARDS, FIGHTERS, getCard } from '../src/content/cards';
import { applyTranslation, LANGUAGES } from '../src/content/i18n';
import { SR } from '../src/content/lang/sr';
import { MODIFIERS } from '../src/content/modifiers';
import { STRINGS } from '../src/content/strings';
import { contentStamp } from '../src/meta/replay';
import { cardSummary } from '../src/ui/glossary';

describe('Serbian translation', () => {
  it('names and describes every piece of content', () => {
    const c = SR.content;
    for (const id of Object.keys(CARDS)) expect(c.cards[id]?.name, id).toBeTruthy();
    for (const [id, card] of Object.entries(CARDS)) if (card.text) expect(c.cards[id].text, id).toBeTruthy();
    for (const f of FIGHTERS) expect(c.fighters[f.id], f.id).toMatchObject({ title: expect.any(String), blurb: expect.any(String), role: expect.any(String) });
    for (const a of ARENAS) expect(c.arenas[a.id]?.name, a.id).toBeTruthy();
    for (const m of MODIFIERS) expect(c.modifiers[m.id]?.name, m.id).toBeTruthy();
    for (const a of ACHIEVEMENTS) expect(c.achievements[a.id]?.name, a.id).toBeTruthy();
    // Nothing translated that doesn't exist (catches typos in ids).
    expect(Object.keys(c.cards).filter((id) => !CARDS[id])).toEqual([]);
  });

  it('only changes words, so replays and balance stay the same', () => {
    const stamp = contentStamp();
    const damage = CARDS.cinderJab.damage;
    applyTranslation(SR);
    expect(contentStamp()).toBe(stamp);
    expect(CARDS.cinderJab.damage).toBe(damage);
    expect(getCard('right').name).toBe('Korak desno');
    expect(FIGHTERS.find((f) => f.id === 'basalt')!.passive!.name).toBe('Stena');
    expect(STRINGS.lockIn).toBe('Potvrdi');
    // The tutorial names the cards and button it asks for by their translated names.
    expect(STRINGS.tutorial.r1b).toContain(getCard('right').name);
    expect(STRINGS.tutorial.r1c).toContain(getCard('cinderJab').name);
    expect(STRINGS.tutorial.r1d).toContain(STRINGS.lockIn);
    // Rules quote the live balance numbers.
    expect(STRINGS.rules.join(' ')).toContain(String(BALANCE.energyPerRound));
    // Every card still reads as a full sentence.
    for (const id of Object.keys(CARDS)) expect(cardSummary(id)).not.toMatch(/undefined|NaN/);
  });

  it('uses Serbian plural forms', () => {
    applyTranslation(SR);
    expect([1, 2, 5, 11, 12, 21, 22, 25].map((n) => STRINGS.replays.roundsN(n))).toEqual([
      '1 runda', '2 runde', '5 rundi', '11 rundi', '12 rundi', '21 runda', '22 runde', '25 rundi',
    ]);
    expect(STRINGS.descPush(1)).toContain('1 polje');
    expect(STRINGS.descPush(2)).toContain('2 polja');
  });

  it('is offered in settings next to English', () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(['en', 'sr']);
  });
});
