import { ASSETS, assetUrl } from '../content/assets';
import { BASIC_CARD_IDS, getCard } from '../content/cards';
import { STRINGS } from '../content/strings';
import type { FighterDef } from '../engine/types';

export type CardGroup = 'move' | 'attack' | 'special';
const GROUP_ORDER: CardGroup[] = ['move', 'attack', 'special'];
/** Rows shorter than this are padded with empty spots so the columns line up. */
const GROUP_SIZE = 4;

/** Which hand row a card goes in. Only the four basic steps are "Move"; special moves join "Special". */
export function cardGroup(id: string): CardGroup {
  const kind = getCard(id).kind;
  if (kind === 'move') return BASIC_CARD_IDS.includes(id) ? 'move' : 'special';
  return kind === 'attack' || kind === 'trap' ? 'attack' : 'special';
}

function attackGrid(pattern: [string, string, string], facing: 1 | -1, cls = 'on'): string {
  const cells = pattern
    .flatMap((row) => (facing === -1 ? [...row].reverse() : [...row]))
    .map((v, i) => `<i class="${v === '1' ? cls : ''}${i === 4 ? ' me' : ''}"></i>`)
    .join('');
  return `<span class="mini-grid ${facing === -1 ? 'face-l' : 'face-r'}">${cells}</span>`;
}

/** Grid centred on the user with the destination square marked; widens for multi-square steps. */
function moveGrid([dr, dc]: [number, number]): string {
  const halfR = Math.max(1, Math.abs(dr));
  const halfC = Math.max(1, Math.abs(dc));
  const rows = halfR * 2 + 1;
  const cols = halfC * 2 + 1;
  let cells = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const me = r === halfR && c === halfC;
      const target = r === halfR + dr && c === halfC + dc;
      cells += `<i class="${me ? 'me' : ''}${target ? ' move' : ''}"></i>`;
    }
  }
  return `<span class="mini-grid${cols > 3 ? ' wide' : ''}" style="--gc:${cols}">${cells}</span>`;
}

type Effect = keyof typeof STRINGS.effectIcons;

/** The special effects on a card, in display order. */
export function cardEffects(id: string): Effect[] {
  const c = getCard(id);
  const out: Effect[] = [];
  if (c.push && c.push > 0) out.push('push');
  if (c.push && c.push < 0) out.push('pull');
  if (c.stun) out.push('stun');
  if (c.counter) out.push('counter');
  if (c.drain) out.push('drain');
  if (c.burn) out.push('burn');
  if (c.kind === 'trap') out.push('trap');
  if (c.swap) out.push('swap');
  return out;
}

export interface CardOpts {
  facing?: 1 | -1;
  disabled?: boolean;
  selected?: boolean;
  small?: boolean;
  /** Display only: no hover or click affordance. */
  readonly?: boolean;
  /** Ammo fighters: an attack that was fired and needs a Reload. */
  spent?: boolean;
}

/** HTML for one card. `facing` flips the pattern preview so it matches the board. */
export function cardHtml(id: string, opts: CardOpts = {}): string {
  const c = getCard(id);
  let art = '';
  let stat = '';
  if (c.kind === 'attack' && c.pattern) {
    art = attackGrid(c.pattern, opts.facing ?? 1);
    stat = `<span class="stat dmg" title="${STRINGS.cardTips.damage}">⚔ ${c.damage}</span>`;
  } else if (c.kind === 'trap' && c.pattern) {
    art = attackGrid(c.pattern, opts.facing ?? 1, 'trap');
    stat = `<span class="stat trap" title="${STRINGS.cardTips.trap}">${STRINGS.effectIcons.trap} ${c.trap}</span>`;
  } else if (c.kind === 'move' && c.swap) {
    art = `<span class="big-glyph">${STRINGS.effectIcons.swap}</span>`;
  } else if (c.kind === 'move' && c.step) {
    art = moveGrid(c.step);
  } else if (c.kind === 'guard') {
    art = '<span class="big-glyph">⛨</span>';
    stat = `<span class="stat grd" title="${STRINGS.cardTips.guard}">⛨ ${c.guard}${c.counter ? ` ${STRINGS.effectIcons.counter} ${c.counter}` : ''}</span>`;
  } else if (c.kind === 'focus') {
    art = '<span class="big-glyph">✦</span>';
  } else if (c.kind === 'heal') {
    art = '<span class="big-glyph">✚</span>';
    stat = `<span class="stat heal" title="${STRINGS.cardTips.heal}">✚ ${c.heal}</span>`;
  } else if (c.kind === 'reload') {
    art = '<span class="big-glyph">⟳</span>';
  }
  const costCls = c.cost > 0 ? 'gain' : c.cost < 0 ? 'spend' : 'free';
  const effects = cardEffects(id);
  const badges = effects.length
    ? `<span class="badges">${effects.map((e) => `<i class="fx-${e}" title="${STRINGS.effectNames[e]}">${STRINGS.effectIcons[e]}</i>`).join('')}</span>`
    : '';
  const cls = [
    'card',
    `kind-${c.kind}`,
    opts.disabled && 'disabled',
    opts.selected && 'selected',
    opts.small && 'small',
    opts.readonly && 'readonly',
    opts.spent && 'spent',
    c.bonus && 'bonus',
  ]
    .filter(Boolean)
    .join(' ');
  const tag = opts.readonly ? 'div' : 'button';
  return `<${tag} class="${cls}" data-card="${c.id}" title="${c.name}" ${opts.disabled ? 'aria-disabled="true"' : ''}>
    ${ASSETS.cards[c.id] ? `<span class="card-art" style="background-image:url('${assetUrl(ASSETS.cards[c.id])}')"></span>` : ''}
    <span class="cost ${costCls}" title="${STRINGS.cardTips.energy}">${STRINGS.cardCost(c.cost)}</span>${badges}
    <span class="art">${art}</span>
    <span class="name">${c.name}</span>
    ${stat}${opts.spent ? `<span class="spent-tag">${STRINGS.spentTag}</span>` : ''}
  </${tag}>`;
}

/**
 * Words for a card's special effects only (push, pull, stun, counter, drain and any extra note).
 * Damage, cost and movement are already shown on the card itself. Empty if the card has none.
 */
export function describeCard(id: string): string {
  const c = getCard(id);
  const parts: string[] = [];
  if (c.push && c.push > 0) parts.push(STRINGS.descPush(c.push));
  if (c.push && c.push < 0) parts.push(STRINGS.descPull(-c.push));
  if (c.stun) parts.push(STRINGS.descStun);
  if (c.counter) parts.push(STRINGS.descCounter(c.counter));
  if (c.drain) parts.push(STRINGS.descDrain(c.drain));
  if (c.burn) parts.push(STRINGS.descBurn(c.burn));
  if (c.kind === 'trap') parts.push(STRINGS.descTrap(c.trap ?? 0));
  if (c.swap) parts.push(STRINGS.descSwap);
  if (c.kind === 'reload') parts.push(STRINGS.descReload);
  if (c.text) parts.push(c.text);
  return parts.join(' ');
}

/** One-line description of a fighter's passive ability. */
export function passiveHtml(f: FighterDef): string {
  if (!f.passive) return '';
  return `<p class="passive"><b>${STRINGS.passive}: ${f.passive.name}</b> ${f.passive.text}</p>`;
}

/** The longest hand row for this deck (at least 4): cards shrink so that many fit across. */
export function handRowLength(ids: string[]): number {
  const n: Record<CardGroup, number> = { move: 0, attack: 0, special: 0 };
  for (const id of ids) n[cardGroup(id)]++;
  return Math.max(GROUP_SIZE, n.move, n.attack, n.special);
}

/**
 * Cards in exactly three labelled rows (movement, attacks, specials) that never wrap. The container
 * should get `--row-n: handRowLength(ids)` so long rows shrink their cards instead of wrapping.
 */
export function groupedCardsHtml(ids: string[], render: (id: string) => string): string {
  const groups: Record<CardGroup, string[]> = { move: [], attack: [], special: [] };
  for (const id of ids) groups[cardGroup(id)].push(id);
  return GROUP_ORDER.map((g) => {
    const cards = groups[g].map(render);
    while (cards.length < GROUP_SIZE) cards.push('<span class="card placeholder"></span>');
    return `<div class="group g-${g}"><span class="group-label">${STRINGS.groupNames[g]}</span><div class="group-cards">${cards.join('')}</div></div>`;
  }).join('');
}
