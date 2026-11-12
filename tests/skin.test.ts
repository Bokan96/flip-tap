import { afterEach, describe, expect, it } from 'vitest';
import { ASSETS, fighterArt } from '../src/content/assets';
import { getFighter } from '../src/content/cards';
import { cardHtml } from '../src/ui/card';
import { emblemHtml, portraitHtml, tokenArtHtml } from '../src/ui/emblems';

afterEach(() => {
  ASSETS.fighters = {};
  ASSETS.cards = {};
});

describe('reskin slots', () => {
  const cinder = getFighter('cinder');

  it('falls back to the built-in vector emblem; board pieces stay plain', () => {
    for (const html of [emblemHtml(cinder), portraitHtml(cinder)]) {
      expect(html).toContain('<svg');
      expect(html).not.toContain('<img');
    }
    expect(tokenArtHtml(cinder)).toBe('');
  });

  it('a plain string is the emblem and also fills the portrait, but not the board piece', () => {
    ASSETS.fighters.cinder = 'assets/fighters/cinder.png';
    expect(fighterArt('cinder')).toEqual({ emblem: 'assets/fighters/cinder.png' });
    for (const html of [emblemHtml(cinder), portraitHtml(cinder)]) expect(html).toContain('cinder.png');
    expect(tokenArtHtml(cinder)).toBe('');
    expect(emblemHtml(getFighter('marin'))).toContain('<svg');
  });

  it('portrait and token can each have their own picture', () => {
    ASSETS.fighters.cinder = { emblem: 'e.png', portrait: 'p.png', token: 't.png' };
    expect(emblemHtml(cinder)).toContain('e.png');
    expect(portraitHtml(cinder)).toContain('p.png');
    expect(tokenArtHtml(cinder)).toContain('t.png');
    expect(tokenArtHtml(cinder)).toContain('class="token-art"');
  });

  it('card art sits behind the card only when set', () => {
    ASSETS.cards.cinderJab = 'assets/cards/jab.png';
    expect(cardHtml('cinderJab')).toContain('class="card-art"');
    expect(cardHtml('cinderJab')).toContain('jab.png');
    expect(cardHtml('cinderRing')).not.toContain('card-art');
  });
});
