import { getCard } from '../content/cards';
import { STRINGS } from '../content/strings';

export type CardGroup = 'move' | 'attack' | 'special';
const GROUP_ORDER: CardGroup[] = ['move', 'attack', 'special'];
const GROUP_SIZE = 4;

export function cardGroup(id: string): CardGroup {
  const kind = getCard(id).kind;
  return kind === 'move' ? 'move' : kind === 'attack' ? 'attack' : 'special';
}

function attackGrid(pattern: [string, string, string], facing: 1 | -1): string {
  const cells = pattern
    .flatMap((row) => (facing === -1 ? [...row].reverse() : [...row]))
    .map((v, i) => `<i class="${v === '1' ? 'on' : ''}${i === 4 ? ' me' : ''}"></i>`)
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
    art = attackGrid(c.pattern, opts.facing ?? 1);
    stat = `<span class="stat dmg" title="Damage">⚔ ${c.damage}</span>`;
  } else if (c.kind === 'move' && c.step) {
    art = moveGrid(c.step);
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
  return `<${tag} class="${cls}" data-card="${c.id}" title="${c.name}" ${opts.disabled ? 'aria-disabled="true"' : ''}>
    <span class="cost ${costCls}" title="Energy">${STRINGS.cardCost(c.cost)}</span>
    <span class="art">${art}</span>
    <span class="name">${c.name}</span>
    ${stat}
  </${tag}>`;
}

function moveText([dr, dc]: [number, number]): string {
  const parts: string[] = [];
  if (dr) parts.push(STRINGS.descMove(Math.abs(dr), dr < 0 ? STRINGS.dirNames.up : STRINGS.dirNames.down));
  if (dc) parts.push(STRINGS.descMove(Math.abs(dc), dc < 0 ? STRINGS.dirNames.left : STRINGS.dirNames.right));
  return parts.join(' ');
}

/** Plain-language description built from the card's numbers (plus any extra note in `text`). */
export function describeCard(id: string): string {
  const c = getCard(id);
  let main = '';
  switch (c.kind) {
    case 'attack':
      main = STRINGS.descAttack(c.damage ?? 0) + (c.text ? ` ${c.text}` : '');
      break;
    case 'move':
      main = c.text ?? moveText(c.step ?? [0, 0]);
      break;
    case 'guard':
      main = c.text ?? STRINGS.descGuard(c.guard ?? 0);
      break;
    case 'focus':
      main = c.text ?? STRINGS.descFocus(c.cost);
      break;
    case 'heal':
      main = c.text ?? STRINGS.descHeal(c.heal ?? 0);
      break;
  }
  const cost = c.cost < 0 ? STRINGS.descCost(-c.cost) : c.cost === 0 ? STRINGS.descFree : '';
  return [main, cost, c.bonus ? STRINGS.descBonus : ''].filter(Boolean).join(' ');
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
