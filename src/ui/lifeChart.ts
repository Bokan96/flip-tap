import { STRINGS } from '../content/strings';

export interface LifeSeries {
  /** Legend and tooltip label, e.g. "Player 1 · Cinder". */
  name: string;
  /** Life at the start, then after each round. */
  values: number[];
  /** Line colour (a CSS colour or var()). */
  color: string;
}

export interface LifeChartData {
  series: [LifeSeries, LifeSeries];
  /** Top of the scale (the larger max life). */
  max: number;
  /** First round fatigue hurts in (shaded), if the match got that far. */
  fatigueFrom: number;
}

const SVG = 'http://www.w3.org/2000/svg';
const M = { left: 30, right: 32, top: 16, bottom: 22 };

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

function htmlEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const roundName = (k: number) => (k === 0 ? STRINGS.summary.start : STRINGS.round(k));

/**
 * Life over the rounds as a two-line chart: legend above, crosshair tooltip on hover, tap or
 * arrow keys, and the same numbers as a table underneath. Drawn at the container's real width
 * (and redrawn when it changes) so the text stays readable on phones.
 */
export function mountLifeChart(host: HTMLElement, data: LifeChartData): void {
  const rounds = data.series[0].values.length - 1;
  host.replaceChildren();
  host.classList.add('life-chart');

  const legend = htmlEl('div', 'chart-legend');
  for (const s of data.series) {
    const item = htmlEl('span', 'chart-key');
    const key = htmlEl('i', 'key-line');
    key.style.background = s.color;
    item.append(key, document.createTextNode(s.name));
    legend.appendChild(item);
  }

  const plot = htmlEl('div', 'chart-plot');
  const tip = htmlEl('div', 'chart-tip hidden');
  tip.setAttribute('aria-hidden', 'true');

  const table = htmlEl('details', 'chart-table');
  table.appendChild(htmlEl('summary', '', STRINGS.summary.showTable));
  const t = htmlEl('table', '');
  const head = htmlEl('tr', '');
  head.append(htmlEl('th', '', STRINGS.summary.roundCol), ...data.series.map((s) => htmlEl('th', '', s.name)));
  t.appendChild(htmlEl('thead', '')).appendChild(head);
  const body = t.appendChild(htmlEl('tbody', ''));
  for (let k = 0; k <= rounds; k++) {
    const tr = htmlEl('tr', '');
    tr.append(htmlEl('td', '', roundName(k)), ...data.series.map((s) => htmlEl('td', '', String(s.values[k]))));
    body.appendChild(tr);
  }
  table.appendChild(t);
  host.append(legend, plot, table);

  let svg: SVGSVGElement | null = null;
  let focusAt: number | null = null;
  let layout = { W: 0, H: 0, x: (_k: number) => 0, y: (_v: number) => 0 };

  const showAt = (k: number | null) => {
    focusAt = k;
    const hover = svg?.querySelector<SVGGElement>('.hover');
    if (!svg || !hover) return;
    if (k === null) {
      hover.classList.add('hidden');
      tip.classList.add('hidden');
      return;
    }
    const { x, y, W } = layout;
    hover.classList.remove('hidden');
    const line = hover.querySelector('line')!;
    line.setAttribute('x1', String(x(k)));
    line.setAttribute('x2', String(x(k)));
    hover.querySelectorAll('circle').forEach((c, i) => {
      c.setAttribute('cx', String(x(k)));
      c.setAttribute('cy', String(y(data.series[i].values[k])));
    });
    tip.replaceChildren(htmlEl('b', 'tip-title', roundName(k)));
    // Higher life first, so the rows read in the same order as the lines.
    const order = [0, 1].sort((a, b) => data.series[b].values[k] - data.series[a].values[k]);
    for (const i of order) {
      const s = data.series[i];
      const row = htmlEl('div', 'tip-row');
      const key = htmlEl('i', 'key-line');
      key.style.background = s.color;
      row.append(key, htmlEl('strong', '', String(s.values[k])), htmlEl('span', '', s.name));
      tip.appendChild(row);
    }
    tip.classList.remove('hidden');
    const tw = tip.offsetWidth;
    const left = x(k) + 12 + tw > W ? x(k) - 12 - tw : x(k) + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${M.top}px`;
  };

  const draw = () => {
    const W = Math.max(240, Math.round(plot.clientWidth));
    const H = W < 420 ? 170 : 200;
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    const x = (k: number) => M.left + (rounds ? (k / rounds) * innerW : innerW / 2);
    const y = (v: number) => M.top + (1 - v / data.max) * innerH;
    layout = { W, H, x, y };

    const s = svgEl('svg', { class: 'chart-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, tabindex: 0, role: 'img' });
    const last = data.series.map((sr) => sr.values[rounds]);
    s.setAttribute('aria-label', STRINGS.summary.chartLabel(rounds, data.series[0].name, last[0], data.series[1].name, last[1]));

    // Fatigue rounds, shaded.
    if (rounds >= data.fatigueFrom) {
      const x0 = x(data.fatigueFrom - 1);
      svgEl('rect', { class: 'fatigue-band', x: x0, y: M.top, width: x(rounds) - x0, height: innerH }, s);
      svgEl('text', { class: 'axis-note', x: x0 + 4, y: M.top - 5 }, s).textContent = STRINGS.summary.fatigue;
    }

    // Gridlines and y ticks at round numbers.
    const step = data.max > 160 ? 100 : 50;
    for (let v = 0; v <= data.max; v += step) {
      svgEl('line', { class: v === 0 ? 'baseline' : 'grid', x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }, s);
      svgEl('text', { class: 'tick y', x: M.left - 6, y: y(v) + 4 }, s).textContent = String(v);
    }
    // X ticks: every round when there's room, otherwise every 2nd or 5th.
    const every = rounds <= 12 || innerW / rounds >= 26 ? 1 : rounds <= 24 ? 2 : 5;
    for (let k = 1; k <= rounds; k++) {
      if (k % every && k !== rounds) continue;
      if (k !== rounds && rounds - k < every) continue; // keep the last label clear of its neighbour
      svgEl('text', { class: 'tick x', x: x(k), y: H - 6 }, s).textContent = String(k);
    }

    // Lines, then end dots (with a ring in the surface colour) and end values.
    data.series.forEach((sr) => {
      const d = sr.values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
      svgEl('path', { class: 'life-line', d }, s).style.stroke = sr.color;
    });
    const ends = data.series.map((sr) => y(sr.values[rounds]));
    const labelsFit = Math.abs(ends[0] - ends[1]) >= 14;
    data.series.forEach((sr, i) => {
      svgEl('circle', { class: 'end-dot', cx: x(rounds), cy: ends[i], r: 4 }, s).style.fill = sr.color;
      if (labelsFit) svgEl('text', { class: 'end-label', x: x(rounds) + 8, y: ends[i] + 4 }, s).textContent = String(sr.values[rounds]);
    });

    // Hover layer: a crosshair that snaps to the nearest round, with a dot on each line.
    const hover = svgEl('g', { class: 'hover hidden' }, s);
    svgEl('line', { class: 'crosshair', x1: 0, x2: 0, y1: M.top, y2: M.top + innerH }, hover);
    data.series.forEach((sr) => (svgEl('circle', { class: 'end-dot', r: 4, cx: 0, cy: 0 }, hover).style.fill = sr.color));
    const hit = svgEl('rect', { class: 'hit', x: 0, y: 0, width: W, height: H, fill: 'transparent' }, s);
    const nearest = (e: PointerEvent) => {
      const box = s.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      return Math.max(0, Math.min(rounds, Math.round(((px - M.left) / innerW) * rounds)));
    };
    hit.addEventListener('pointermove', (e) => showAt(nearest(e)));
    hit.addEventListener('pointerdown', (e) => showAt(nearest(e)));
    hit.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') showAt(null);
    });
    s.addEventListener('focus', () => showAt(focusAt ?? rounds));
    s.addEventListener('blur', () => showAt(null));
    s.addEventListener('keydown', (e) => {
      const k = focusAt ?? rounds;
      const next = e.key === 'ArrowLeft' ? k - 1 : e.key === 'ArrowRight' ? k + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rounds : null;
      if (next === null) return;
      e.preventDefault();
      showAt(Math.max(0, Math.min(rounds, next)));
    });

    svg?.remove();
    svg = s;
    plot.prepend(s);
    if (focusAt !== null) showAt(focusAt);
  };

  plot.appendChild(tip);
  draw();
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = plot.clientWidth;
    new ResizeObserver(() => {
      if (!plot.isConnected || Math.abs(plot.clientWidth - lastW) < 1) return;
      lastW = plot.clientWidth;
      draw();
    }).observe(plot);
  }
}
