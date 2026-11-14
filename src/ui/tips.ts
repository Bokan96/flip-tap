import { STRINGS } from '../content/strings';

/*
 * Tap an icon for its meaning: a small note next to the icon (card badges, status chips, square
 * effects). One at a time; the next tap anywhere, or a few seconds, closes it.
 */

export interface TipContent {
  icon: string;
  name: string;
  text: string;
}

/** What a `data-tip` key means: an effect from the glossary, a square effect, or a spent shot. */
export function tipContent(key: string): TipContent | null {
  const G = STRINGS.glossary;
  const term = G.terms().find((t) => t.key === key);
  if (term) return term;
  const tiles = G.tileTexts();
  if (tiles[key]) return { icon: (STRINGS.tileIcons as Record<string, string>)[key] ?? '', name: G.tileNames[key], text: tiles[key] };
  if (key === 'spent') return { icon: '⟳', name: STRINGS.spentTag, text: STRINGS.spentText };
  return null;
}

let close: (() => void) | null = null;

/** Show what `key` means next to `anchor` (above it if there's room, otherwise below). */
export function showTip(key: string, anchor: HTMLElement): void {
  closeTip();
  const c = tipContent(key);
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'tip-pop';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = `<b>${c.icon ? `<i>${c.icon}</i> ` : ''}${c.name}</b><span>${c.text}</span>`;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const m = 8;
  const left = Math.max(m, Math.min(innerWidth - el.offsetWidth - m, r.left + r.width / 2 - el.offsetWidth / 2));
  const above = r.top - el.offsetHeight - m;
  el.style.left = `${left}px`;
  el.style.top = `${above >= m ? above : Math.min(innerHeight - el.offsetHeight - m, r.bottom + m)}px`;
  const timer = setTimeout(closeTip, 5000);
  const onDown = () => closeTip();
  // Registered after this tap has finished, so it doesn't close the note straight away.
  const arm = setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0);
  close = () => {
    clearTimeout(timer);
    clearTimeout(arm);
    document.removeEventListener('pointerdown', onDown, { capture: true });
    el.remove();
  };
}

export function closeTip(): void {
  close?.();
  close = null;
}
