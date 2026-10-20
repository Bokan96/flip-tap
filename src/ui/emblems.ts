import { ASSETS, assetUrl } from '../content/assets';
import type { FighterDef } from '../engine/types';

/** Simple original geometric emblems used as placeholder fighter art. */
const SHAPES: Record<string, string> = {
  flame: '<path d="M50 8 C62 30 78 38 74 62 C71 80 60 90 50 90 C40 90 29 80 26 62 C23 44 38 40 40 24 C46 34 48 40 50 44 C54 32 54 20 50 8Z"/><path d="M50 52 C56 60 60 66 58 74 C56 82 44 82 42 74 C40 66 46 60 50 52Z" fill="rgba(255,255,255,.55)"/>',
  wave: '<path d="M8 58 C20 40 32 40 44 58 C56 76 68 76 80 58 C86 50 90 48 92 48 L92 70 C80 92 60 92 48 74 C36 56 24 60 8 78Z"/><circle cx="62" cy="30" r="10" fill="rgba(255,255,255,.55)"/>',
  swirl: '<path d="M50 14 A36 36 0 1 1 14 50 L28 50 A22 22 0 1 0 50 28Z"/><circle cx="50" cy="50" r="9" fill="rgba(255,255,255,.55)"/>',
  hex: '<polygon points="50,8 86,29 86,71 50,92 14,71 14,29"/><polygon points="50,30 68,40 68,60 50,70 32,60 32,40" fill="rgba(255,255,255,.4)"/>',
  bolt: '<polygon points="58,6 22,56 46,56 38,94 78,40 54,40"/>',
  moon: '<path d="M62 10 A40 40 0 1 0 90 62 A30 30 0 1 1 62 10Z"/><circle cx="70" cy="34" r="5" fill="rgba(255,255,255,.55)"/>',
};

export function emblemHtml(f: FighterDef, cls = 'emblem'): string {
  const img = ASSETS.fighters[f.id];
  if (img) return `<img class="${cls}" src="${assetUrl(img)}" alt="${f.name}">`;
  const shape = SHAPES[f.emblem] ?? SHAPES.hex;
  return `<svg class="${cls}" viewBox="0 0 100 100" fill="${f.color}" role="img" aria-label="${f.name}">${shape}</svg>`;
}
