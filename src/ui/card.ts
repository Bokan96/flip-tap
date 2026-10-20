import { getCard } from '../content/cards';
import { STRINGS } from '../content/strings';

const ARROWS: Record<string, string> = { '-1,0': '↑', '1,0': '↓', '0,-1': '←', '0,1': '→', '0,-2': '⇇', '0,2': '⇉' };

export type CardGroup = 'move' | 'attack' | 'special';
const GROUP_ORDER: CardGroup[] = ['move', 'attack', 'special'];
const GROUP_SIZE = 4;

export function cardGroup(id: string): CardGroup {
  const kind = getCard(id).kind;
  return kind === 'move' ? 'move' : kind === 'attack' ? 'attack' : 'special';
}

function miniPattern(pattern: [string, string, string], facing: 1 | -1): string {
  const cells = pattern
    .flatMap((row) => (facing === -1 ? [...row].reverse() : [...row]))
    .map((v, i) => `<i class="${v === '1' ? 'on' : ''}${i === 4 ? ' me' : ''}"></i>`)
    .join('');
  return `<span class="mini-grid ${facing === -1 ? 'face-l' : 'face-r'}">${cells}</span>`;
}

export interface CardOpts {
  facing?: 1 | -1;
  disabled?: boolean;
  selected?: boolean;
  small?: boolean;
  /** Display only: no hover or click affordance. */
  readonly?: boolean;
}

/** HTML for one card. `facing` flips the pattern preview so it matches the board. */
export function cardHtml(id: string, opts: CardOpts = {}): string {
  const c = getCard(id);
  let art = '';
  let stat = '';
  if (c.kind === 'attack' && c.pattern) {
    art = miniPattern(c.pattern, opts.facing ?? 1);
    stat = `<span class="stat dmg" title="Damage">⚔ ${c.damage}</span>`;
  } else if (c.kind === 'move' && c.step) {
    art = `<span class="big-glyph">${ARROWS[c.step.join(',')] ?? '•'}</span>`;
  } else if (c.kind === 'guard') {
    art = '<span class="big-glyph">⛨</span>';
    stat = `<span class="stat grd" title="Guard">⛨ ${c.guard}</span>`;
  } else if (c.kind === 'focus') {
    art = '<span class="big-glyph">✦</span>';
  } else if (c.kind === 'heal') {
    art = '<span class="big-glyph">✚</span>';
    stat = `<span class="stat heal" title="Heal">✚ ${c.heal}</span>`;
  }
  const costCls = c.cost > 0 ? 'gain' : c.cost < 0 ? 'spend' : 'free';
  const cls = [
    'card',
    `kind-${c.kind}`,
    opts.disabled && 'disabled',
    opts.selected && 'selected',
    opts.small && 'small',
    opts.readonly && 'readonly',
    c.bonus && 'bonus',
  ]
    .filter(Boolean)
    .join(' ');
  const tag = opts.readonly ? 'div' : 'button';
  return `<${tag} class="${cls}" data-card="${c.id}" title="${c.name}${c.text ? ' · ' + c.text : ''}" ${opts.disabled ? 'aria-disabled="true"' : ''}>
    <span class="cost ${costCls}" title="Energy">${STRINGS.cardCost(c.cost)}</span>
    <span class="art">${art}</span>
    <span class="name">${c.name}</span>
    ${stat}
  </${tag}>`;
}

/** Cards laid out in labelled rows of 4: movement, attacks, specials. */
export function groupedCardsHtml(ids: string[], render: (id: string) => string): string {
  const groups: Record<CardGroup, string[]> = { move: [], attack: [], special: [] };
  for (const id of ids) groups[cardGroup(id)].push(id);
  return GROUP_ORDER.map((g) => {
    const cards = groups[g].map(render);
    const pad = Math.max(GROUP_SIZE, Math.ceil(cards.length / GROUP_SIZE) * GROUP_SIZE) - cards.length;
    for (let i = 0; i < pad; i++) cards.push('<span class="card placeholder"></span>');
    return `<div class="group g-${g}"><span class="group-label">${STRINGS.groupNames[g]}</span><div class="group-cards">${cards.join('')}</div></div>`;
  }).join('');
}
