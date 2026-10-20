import { getCard } from '../content/cards';
import { STRINGS } from '../content/strings';

const ARROWS: Record<string, string> = { '-1,0': '↑', '1,0': '↓', '0,-1': '←', '0,1': '→', '0,-2': '⇇', '0,2': '⇉' };

function miniPattern(pattern: [string, string, string], flip: boolean): string {
  const cells = pattern
    .flatMap((row) => (flip ? [...row].reverse() : [...row]))
    .map((v, i) => `<i class="${v === '1' ? 'on' : ''}${i === 4 ? ' me' : ''}"></i>`)
    .join('');
  return `<span class="mini-grid">${cells}</span>`;
}

/** HTML for one card. `facing` flips the pattern preview so it matches the board. */
export function cardHtml(id: string, opts: { facing?: 1 | -1; disabled?: boolean; selected?: boolean; small?: boolean } = {}): string {
  const c = getCard(id);
  let art = '';
  let stat = '';
  if (c.kind === 'attack' && c.pattern) {
    art = miniPattern(c.pattern, opts.facing === -1);
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
  const cls = ['card', `kind-${c.kind}`, opts.disabled && 'disabled', opts.selected && 'selected', opts.small && 'small', c.bonus && 'bonus']
    .filter(Boolean)
    .join(' ');
  return `<button class="${cls}" data-card="${c.id}" title="${c.name}${c.text ? ' · ' + c.text : ''}" ${opts.disabled ? 'aria-disabled="true"' : ''}>
    <span class="cost ${costCls}" title="Energy">${STRINGS.cardCost(c.cost)}</span>
    <span class="art">${art}</span>
    <span class="name">${c.name}</span>
    ${stat}
  </button>`;
}
