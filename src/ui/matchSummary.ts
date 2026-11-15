import { getCard, getFighter } from '../content/cards';
import { STRINGS } from '../content/strings';
import type { Highlight, MatchStats } from '../meta/matchStats';
import { mountLifeChart, type LifeSeries } from './lifeChart';

export interface SummaryInput {
  stats: MatchStats;
  /** Seat names, e.g. "Player 1" and "CPU". */
  names: [string, string];
  fighters: [string, string];
  /** When given, the highlights (biggest hit, best dodge) can be tapped to watch their round in `slot`. */
  onHighlight?: (round: number, slot: HTMLElement) => void;
}

/** Chart colour per seat: the player colours, a step darker so lines read well on the panel. */
const SEAT_COLOR = ['var(--chart-p0)', 'var(--chart-p1)'];
/** Cards listed per player before the rest are folded into "Other". */
const TOP_CARDS = 5;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "Player 1 · Cinder", or just "Briar" when the seat is already named after its fighter. */
export function seatLabel(name: string, fighterId: string): string {
  const f = getFighter(fighterId).name;
  return name === f ? f : `${name} · ${f}`;
}
const cardName = (id: string) => (id ? getCard(id).name : STRINGS.summary.other);

function who(seat: number, names: [string, string]): string {
  return `<span class="who-key"><i class="key-dot" style="background:${SEAT_COLOR[seat]}"></i>${esc(names[seat])}</span>`;
}

function tile(label: string, value: string, sub: string): string {
  return `<div class="stat-tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

/** A highlight with the round it happened in; with `watch`, a button that replays that round. */
function highlightTile(label: string, h: Highlight | null, names: [string, string], line: (card: string) => string, none: string, watch: boolean): string {
  if (!h) return tile(label, STRINGS.profile.none, none);
  const sub = `<span>${esc(line(cardName(h.card)))}</span>${who(h.seat, names)}<span class="tile-round">${watch ? '▶ ' : ''}${STRINGS.summary.inRound(h.round)}</span>`;
  if (!watch) return tile(label, String(h.damage), sub);
  return `<button class="stat-tile watch" data-round="${h.round}" title="${STRINGS.summary.watchRound}"><b>${h.damage}</b><span>${label}</span><small>${sub}</small></button>`;
}

function damageHtml(input: SummaryInput): string {
  const { stats, names, fighters } = input;
  const lists = stats.damageByCard.map((list) => {
    if (list.length <= TOP_CARDS + 1) return list;
    const rest = list.slice(TOP_CARDS).reduce((n, r) => n + r.damage, 0);
    return [...list.slice(0, TOP_CARDS), { card: '', damage: rest }];
  });
  // One scale for both players, so their bars compare.
  const max = Math.max(1, ...lists.flat().map((r) => r.damage));
  const groups = lists
    .map((list, seat) => {
      const rows = list.length
        ? list
            .map(
              (r) => `<div class="dmg-row" title="${esc(STRINGS.summary.damageTip(cardName(r.card), r.damage))}">
                <span class="dmg-name">${esc(cardName(r.card))}</span>
                <span class="dmg-track"><i class="dmg-bar" style="--p:${(r.damage / max).toFixed(3)};background:${SEAT_COLOR[seat]}"></i><b>${r.damage}</b></span>
              </div>`,
            )
            .join('')
        : `<p class="note">${STRINGS.summary.noDamage}</p>`;
      return `<div class="dmg-group">
          <div class="dmg-head"><span class="who-key"><i class="key-rect" style="background:${SEAT_COLOR[seat]}"></i>${esc(seatLabel(names[seat], fighters[seat]))}</span>
            <small>${STRINGS.summary.groupLine(stats.cardsPlayed[seat], stats.damageDealt[seat])}</small></div>
          ${rows}
        </div>`;
    })
    .join('');
  return `<h4>${STRINGS.summary.damageByCard}</h4><div class="dmg-groups">${groups}</div>`;
}

/** The match summary: highlight tiles, life chart and damage per card. */
export function renderSummary(host: HTMLElement, input: SummaryInput): void {
  const { stats, names, fighters, onHighlight } = input;
  const S = STRINGS.summary;
  const watch = !!onHighlight;
  host.innerHTML = `
    <div class="stat-grid summary-tiles">
      ${tile(S.rounds, String(stats.rounds), '')}
      ${highlightTile(S.biggestHit, stats.biggestHit, names, (c) => c, S.noHits, watch)}
      ${highlightTile(S.bestDodge, stats.bestDodge, names, S.dodged, S.noDodges, watch)}
    </div>
    <div class="highlight-replay"></div>
    <h4>${S.lifeTitle}</h4>
    <div class="life-chart-host"></div>
    ${damageHtml(input)}`;
  mountLifeChart(host.querySelector('.life-chart-host')!, {
    series: [0, 1].map((i) => ({
      name: seatLabel(names[i], fighters[i]),
      values: stats.lives[i],
      color: SEAT_COLOR[i],
    })) as [LifeSeries, LifeSeries],
    max: Math.max(...stats.lifeMax),
    fatigueFrom: stats.fatigueFrom,
  });
  const slot = host.querySelector<HTMLElement>('.highlight-replay')!;
  host.querySelectorAll<HTMLElement>('.stat-tile.watch').forEach((b) =>
    b.addEventListener('click', () => {
      host.querySelectorAll('.stat-tile.watch').forEach((x) => x.classList.toggle('on', x === b));
      onHighlight?.(Number(b.dataset.round), slot);
    }),
  );
}
