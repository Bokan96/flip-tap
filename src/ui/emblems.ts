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

/** The fighters' emblem shapes. */
export const EMBLEM_KEYS: string[] = Object.keys(SHAPES);

/**
 * Icons for custom heroes, a set of their own so a hero never looks like one of the fighters.
 * Same style as SHAPES: drawn in the hero's colour with one light (or dark) accent.
 */
const HERO_SHAPES: Record<string, string> = {
  star: '<polygon points="50,7 61.2,37.6 93.7,38.8 68.1,58.9 77,90.2 50,72 23,90.2 31.9,58.9 6.3,38.8 38.8,37.6"/><polygon points="50,31 55.3,45.7 70.9,46.2 58.6,55.8 62.9,70.8 50,62 37.1,70.8 41.4,55.8 29.1,46.2 44.7,45.7" fill="rgba(255,255,255,.5)"/>',
  shield: '<path d="M50 6 L86 18 V46 C86 70 71 85 50 94 C29 85 14 70 14 46 V18 Z"/><path d="M50 18 L74 26 V46 C74 63 64 74 50 81 Z" fill="rgba(255,255,255,.45)"/>',
  crown: '<path d="M10 74 L15 28 L34 50 L50 16 L66 50 L85 28 L90 74 Z"/><rect x="12" y="79" width="76" height="11" rx="2"/><circle cx="50" cy="60" r="7" fill="rgba(255,255,255,.6)"/>',
  sword: '<polygon points="50,4 58,16 58,62 42,62 42,16"/><rect x="25" y="62" width="50" height="8" rx="2"/><rect x="45" y="70" width="10" height="17"/><circle cx="50" cy="91" r="6"/><rect x="48.5" y="17" width="3" height="42" fill="rgba(255,255,255,.6)"/>',
  eye: '<path d="M4 50 Q50 8 96 50 Q50 92 4 50 Z"/><circle cx="50" cy="50" r="17" fill="rgba(16,19,31,.85)"/><circle cx="57" cy="43" r="5" fill="rgba(255,255,255,.75)"/>',
  anchor:
    '<path fill-rule="evenodd" d="M50 5 A11 11 0 1 1 49.99 5 Z M50 11 A5 5 0 1 0 50.01 11 Z"/><rect x="46" y="26" width="8" height="58"/><rect x="31" y="33" width="38" height="7" rx="2"/><path d="M12 58 Q16 90 50 93 Q84 90 88 58 L78 62 Q74 80 50 83 Q26 80 22 62 Z"/><polygon points="6,62 20,50 24,68"/><polygon points="94,62 80,50 76,68"/><circle cx="50" cy="16" r="2.5" fill="rgba(255,255,255,.6)"/>',
  leaf: '<path d="M16 88 C12 50 40 16 88 10 C86 56 58 86 16 88 Z"/><path d="M20 86 L80 18 L83 21 L24 89 Z" fill="rgba(255,255,255,.5)"/>',
  sun: '<polygon points="97,50 78.4,44 78.4,56"/><polygon points="83.2,83.2 74.3,65.8 65.8,74.3"/><polygon points="50,97 56,78.4 44,78.4"/><polygon points="16.8,83.2 34.2,74.3 25.7,65.8"/><polygon points="3,50 21.6,56 21.6,44"/><polygon points="16.8,16.8 25.7,34.2 34.2,25.7"/><polygon points="50,3 44,21.6 56,21.6"/><polygon points="83.2,16.8 65.8,25.7 74.3,34.2"/><circle cx="50" cy="50" r="23"/><circle cx="50" cy="50" r="11" fill="rgba(255,255,255,.5)"/>',
  gear:
    '<path fill-rule="evenodd" d="M81.3,39.5 L93.5,43.1 L93.5,56.9 L81.3,60.5 L79.5,64.7 L85.6,75.9 L75.9,85.6 L64.7,79.5 L60.5,81.3 L56.9,93.5 L43.1,93.5 L39.5,81.3 L35.3,79.5 L24.1,85.6 L14.4,75.9 L20.5,64.7 L18.7,60.5 L6.5,56.9 L6.5,43.1 L18.7,39.5 L20.5,35.3 L14.4,24.1 L24.1,14.4 L35.3,20.5 L39.5,18.7 L43.1,6.5 L56.9,6.5 L60.5,18.7 L64.7,20.5 L75.9,14.4 L85.6,24.1 L79.5,35.3 Z M50 36 A14 14 0 1 0 50.01 36 Z"/><circle cx="50" cy="50" r="6" fill="rgba(255,255,255,.55)"/>',
  key: '<path fill-rule="evenodd" d="M28 30 A20 20 0 1 1 27.99 30 Z M28 41 A9 9 0 1 0 28.01 41 Z"/><rect x="44" y="45" width="48" height="10" rx="2"/><rect x="72" y="55" width="7" height="13"/><rect x="84" y="55" width="8" height="18"/><circle cx="28" cy="50" r="3.5" fill="rgba(255,255,255,.6)"/>',
  feather:
    '<path d="M50 5 C71 20 75 48 62 74 L54 70 L56 79 L50 95 L44 79 L46 70 L38 74 C25 48 29 20 50 5 Z"/><rect x="48.5" y="14" width="3" height="80" fill="rgba(255,255,255,.55)"/>',
  snowflake:
    '<rect x="46" y="4" width="8" height="92" rx="3"/><rect x="46" y="4" width="8" height="92" rx="3" transform="rotate(60 50 50)"/><rect x="46" y="4" width="8" height="92" rx="3" transform="rotate(120 50 50)"/><circle cx="50" cy="9" r="6"/><circle cx="50" cy="91" r="6"/><circle cx="14.5" cy="29.5" r="6"/><circle cx="85.5" cy="29.5" r="6"/><circle cx="14.5" cy="70.5" r="6"/><circle cx="85.5" cy="70.5" r="6"/><polygon points="50,38 60.4,44 60.4,56 50,62 39.6,56 39.6,44" fill="rgba(255,255,255,.55)"/>',
};

/** Every custom-hero icon, for the hero creator's icon picker. */
export const HERO_EMBLEM_KEYS: string[] = Object.keys(HERO_SHAPES);

function picture(f: FighterDef, path: string | undefined, cls: string): string {
  if (path) return `<img class="${cls}" src="${assetUrl(path)}" alt="${f.name}">`;
  const shape = SHAPES[f.emblem] ?? HERO_SHAPES[f.emblem] ?? SHAPES.hex;
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
