import type { ArenaDef } from '../content/arenas';
import { STRINGS } from '../content/strings';

/**
 * A tiny drawing of an arena for pickers: pillars as rock, thorns and springs in their hazard
 * colours, and each player's start square marked with a dot in their colour.
 */
export function arenaMiniHtml(a: ArenaDef): string {
  const blocked = new Set((a.blocked ?? []).map(([r, c]) => r * a.cols + c));
  const tiles = new Map((a.tiles ?? []).map((t) => [t.at[0] * a.cols + t.at[1], t.kind]));
  const start = a.start.map(([r, c]) => r * a.cols + c);
  const cells = Array.from({ length: a.rows * a.cols }, (_, i) => {
    const kind = tiles.get(i);
    const cls = blocked.has(i) ? 'blocked' : kind ? `tile-${kind}` : '';
    const seat = start.indexOf(i);
    const dot = seat >= 0 ? `<b class="start p${seat}"></b>` : '';
    const icon = kind ? STRINGS.tileIcons[kind] : '';
    return `<i class="${cls}">${dot || icon}</i>`;
  }).join('');
  return `<span class="arena-mini" style="--rows:${a.rows};--cols:${a.cols}" aria-hidden="true">${cells}</span>`;
}
