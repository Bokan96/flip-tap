import { assetUrl, fighterArt } from '../content/assets';
import type { FighterDef } from '../engine/types';

/** Simple original geometric emblems used as placeholder fighter art. */
const SHAPES: Record<string, string> = {
  flame: '<path d="M50 8 C62 30 78 38 74 62 C71 80 60 90 50 90 C40 90 29 80 26 62 C23 44 38 40 40 24 C46 34 48 40 50 44 C54 32 54 20 50 8Z"/><path d="M50 52 C56 60 60 66 58 74 C56 82 44 82 42 74 C40 66 46 60 50 52Z" fill="rgba(255,255,255,.55)"/>',
  wave: '<path d="M8 58 C20 40 32 40 44 58 C56 76 68 76 80 58 C86 50 90 48 92 48 L92 70 C80 92 60 92 48 74 C36 56 24 60 8 78Z"/><circle cx="62" cy="30" r="10" fill="rgba(255,255,255,.55)"/>',
  swirl: '<path d="M50 14 A36 36 0 1 1 14 50 L28 50 A22 22 0 1 0 50 28Z"/><circle cx="50" cy="50" r="9" fill="rgba(255,255,255,.55)"/>',
  hex: '<polygon points="50,8 86,29 86,71 50,92 14,71 14,29"/><polygon points="50,30 68,40 68,60 50,70 32,60 32,40" fill="rgba(255,255,255,.4)"/>',
  bolt: '<polygon points="58,6 22,56 46,56 38,94 78,40 54,40"/>',
  crosshair:
    '<path fill-rule="evenodd" d="M50 12 A38 38 0 1 1 49.99 12 Z M50 24 A26 26 0 1 0 50.01 24 Z"/><rect x="46" y="2" width="8" height="26"/><rect x="46" y="72" width="8" height="26"/><rect x="2" y="46" width="26" height="8"/><rect x="72" y="46" width="26" height="8"/><circle cx="50" cy="50" r="7" fill="rgba(255,255,255,.6)"/>',
  thorn:
    '<path d="M16 88 C28 64 42 54 56 42 C66 33 74 23 80 10 L88 14 C82 30 73 41 62 50 C49 61 36 70 26 92 Z"/><polygon points="43,54 30,42 49,48"/><polygon points="60,45 63,28 68,43"/><polygon points="32,68 17,66 30,74"/><polygon points="74,30 88,32 76,36"/>',
  mask: '<path d="M8 30 Q50 8 92 30 Q90 70 50 88 Q10 70 8 30 Z"/><ellipse cx="33" cy="44" rx="11" ry="7" fill="rgba(16,19,31,.85)"/><ellipse cx="67" cy="44" rx="11" ry="7" fill="rgba(16,19,31,.85)"/><path d="M34 64 Q50 76 66 64" fill="none" stroke="rgba(16,19,31,.85)" stroke-width="5" stroke-linecap="round"/>',
  moon: '<path d="M62 10 A40 40 0 1 0 90 62 A30 30 0 1 1 62 10Z"/><circle cx="70" cy="34" r="5" fill="rgba(255,255,255,.55)"/>',
};

function picture(f: FighterDef, path: string | undefined, cls: string): string {
  if (path) return `<img class="${cls}" src="${assetUrl(path)}" alt="${f.name}">`;
  const shape = SHAPES[f.emblem] ?? SHAPES.hex;
  return `<svg class="${cls}" viewBox="0 0 100 100" fill="${f.color}" role="img" aria-label="${f.name}">${shape}</svg>`;
}

/** Small fighter icon (ASSETS.fighters[id].emblem, else the vector emblem). */
export function emblemHtml(f: FighterDef, cls = 'emblem'): string {
  return picture(f, fighterArt(f.id).emblem, cls);
}

/** Large fighter picture for select/VS/result screens (portrait, else emblem, else vector). */
export function portraitHtml(f: FighterDef, cls = 'emblem'): string {
  const art = fighterArt(f.id);
  return picture(f, art.portrait ?? art.emblem, cls);
}

/**
 * Picture inside the board token: only an explicit `token` image from a reskin. By default the
 * pieces are plain diamonds in the player's colour (no fighter emblem on the board).
 */
export function tokenArtHtml(f: FighterDef): string {
  const token = fighterArt(f.id).token;
  return token ? picture(f, token, 'token-art') : '';
}
