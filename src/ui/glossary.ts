import { ARENAS } from '../content/arenas';
import { BASIC_CARD_IDS, BONUS_CARD_IDS, FIGHTERS, getCard } from '../content/cards';
import { STRINGS } from '../content/strings';
import { arenaMiniHtml } from './arenaPreview';
import { cardHtml, describeCard, passiveHtml } from './card';
import { portraitHtml } from './emblems';

export type GlossaryTab = 'fighters' | 'cards' | 'effects' | 'arenas';
export const GLOSSARY_TABS: GlossaryTab[] = ['fighters', 'cards', 'effects', 'arenas'];

/** Complexity as 1–3 filled stars. */
export function starsHtml(n: number): string {
  return `<span class="stars" title="${STRINGS.setup.complexity}">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
}

/** Everything a card does in words: what it is for, what it costs and any special effect. */
export function cardSummary(id: string): string {
  const c = getCard(id);
  const G = STRINGS.glossary;
  const parts: string[] = [];
  if (c.kind === 'move' && c.step) {
    const [dr, dc] = c.step;
    const n = Math.max(Math.abs(dr), Math.abs(dc));
    const dir = dr < 0 ? 'up' : dr > 0 ? 'down' : dc < 0 ? 'left' : 'right';
    parts.push(c.forward ? G.moveForward(n) : G.move(n, G.dirs[dir]));
  }
  if (c.kind === 'guard') parts.push(G.guard(c.guard ?? 0));
  if (c.kind === 'focus') parts.push(G.focus(c.cost));
  if (c.kind === 'attack') parts.push(G.attack(c.damage ?? 0));
  if (c.kind === 'heal') parts.push(G.heal(c.heal ?? 0));
  const extra = describeCard(id);
  if (extra) parts.push(extra);
  parts.push(c.cost < 0 ? G.cost(-c.cost) : c.cost === 0 ? G.free : '');
  return parts.filter(Boolean).join(' ');
}

/** Who can play a card: everyone, a fighter, or anyone who earned it. */
export function cardOwner(id: string): string {
  if (BASIC_CARD_IDS.includes(id)) return STRINGS.glossary.basicOwner;
  if (BONUS_CARD_IDS.includes(id)) return STRINGS.glossary.bonusOwner;
  const f = FIGHTERS.find((x) => x.signature.includes(id));
  return f ? STRINGS.glossary.fighterOwner(f.name) : '';
}

function cardRow(id: string): string {
  const c = getCard(id);
  return `<div class="gl-card">${cardHtml(id, { small: true, readonly: true })}
    <div><b>${c.name}</b><small>${STRINGS.kindNames[c.kind]}</small><p>${cardSummary(id)}</p></div></div>`;
}

function fightersHtml(): string {
  return FIGHTERS.map(
    (f) => `<article class="gl-fighter" style="--clr:${f.color}">
      <div class="detail-head">${portraitHtml(f, 'detail-emblem')}
        <div><b>${f.name}</b><i>${f.title}</i><div class="detail-tags"><span class="role-tag">${f.role}</span>${starsHtml(f.complexity)}</div></div>
      </div>
      <p class="detail-blurb">${f.blurb}</p>
      ${passiveHtml(f)}
      <div class="gl-hand">${f.signature.map((id) => cardHtml(id, { small: true, readonly: true })).join('')}</div>
    </article>`,
  ).join('');
}

/** Basic and bonus cards. Each fighter's own cards are on the Fighters tab. */
function cardsHtml(): string {
  const G = STRINGS.glossary;
  const section = (head: string, ids: string[], note = '') =>
    `<section class="gl-section"><h3>${head}</h3>${note ? `<p class="note">${note}</p>` : ''}<div class="gl-cards">${ids.map(cardRow).join('')}</div></section>`;
  return (
    section(G.basicCards, BASIC_CARD_IDS, G.basicNote) +
    section(G.bonusCards, BONUS_CARD_IDS, G.bonusNote)
  );
}

function effectsHtml(): string {
  return `<dl class="gl-terms">${STRINGS.glossary
    .terms()
    .map((t) => `<div><dt><i>${t.icon}</i>${t.name}</dt><dd>${t.text}</dd></div>`)
    .join('')}</dl>`;
}

function arenasHtml(): string {
  const tiles = (['blocked', 'spikes', 'well'] as const)
    .map((k) => `<div><dt><i class="tile-key ${k}">${k === 'blocked' ? '' : STRINGS.tileIcons[k]}</i>${STRINGS.glossary.tileNames[k]}</dt><dd>${STRINGS.glossary.tileTexts()[k]}</dd></div>`)
    .join('');
  const arenas = ARENAS.map((a) => `<div class="gl-arena">${arenaMiniHtml(a)}<div><b>${a.name}</b><p>${a.text}</p></div></div>`).join('');
  return `<dl class="gl-terms">${tiles}</dl><div class="gl-arenas">${arenas}</div>`;
}

export function glossaryTabHtml(tab: GlossaryTab): string {
  return tab === 'fighters' ? fightersHtml() : tab === 'cards' ? cardsHtml() : tab === 'effects' ? effectsHtml() : arenasHtml();
}

/** Card detail for the modal: the full-size card, its owner and every rule it carries. */
export function cardDetailHtml(id: string): string {
  const c = getCard(id);
  return `<div class="gl-detail">${cardHtml(id, { readonly: true })}
    <div><h2>${c.name}</h2><small>${STRINGS.kindNames[c.kind]} · ${cardOwner(id)}</small><p>${cardSummary(id)}</p></div></div>`;
}
