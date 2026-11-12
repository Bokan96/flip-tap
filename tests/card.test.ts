import { describe, expect, it } from 'vitest';
import { BONUS_CARD_IDS, CARDS, FIGHTERS } from '../src/content/cards';
import { createMatch } from '../src/engine/setup';
import { cardGroup, groupedCardsHtml, handRowLength } from '../src/ui/card';

const rows = (html: string) => html.match(/class="group g-/g)?.length ?? 0;

describe('hand rows', () => {
  it('only the four basic steps are in Move; special moves join Special', () => {
    for (const id of ['up', 'down', 'left', 'right']) expect(cardGroup(id)).toBe('move');
    for (const id of ['vexSwap', 'phaseStep', 'leapLeft', 'leapRight']) expect(cardGroup(id)).toBe('special');
    for (const c of Object.values(CARDS)) {
      if (c.kind === 'attack' || c.kind === 'trap') expect(cardGroup(c.id)).toBe('attack');
    }
  });

  it('every deck is exactly three rows, even with three bonus cards', () => {
    const bonusSets = [[], ['leapLeft', 'leapRight', 'phaseStep'], ['overload', 'stormCall', 'leech'], ['bulwark', 'renew', 'surge']];
    for (const f of FIGHTERS) {
      for (const bonus of bonusSets) {
        const deck = createMatch({ fighterId: f.id, bonusCards: bonus }, { fighterId: 'marin' }).players[0].deck;
        const html = groupedCardsHtml(deck, (id) => `<b data-card="${id}"></b>`);
        expect(rows(html)).toBe(3);
        for (const id of deck) expect(html).toContain(`data-card="${id}"`);
        expect(handRowLength(deck)).toBeLessThanOrEqual(7);
      }
    }
  });

  it('the row length is the longest row, at least 4', () => {
    expect(handRowLength(['up', 'down', 'left', 'right', 'guard', 'focus'])).toBe(4);
    const ferro = createMatch({ fighterId: 'ferro', bonusCards: ['overload', 'stormCall', 'leech'] }, { fighterId: 'marin' }).players[0].deck;
    expect(handRowLength(ferro)).toBe(7);
    expect(BONUS_CARD_IDS.length).toBeGreaterThan(0);
  });
});
