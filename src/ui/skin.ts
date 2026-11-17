import { ASSETS, assetUrl } from '../content/assets';
import { STRINGS } from '../content/strings';

/** Apply page-wide skin settings: optional background images and the page title/description. */
export function applySkin(): void {
  colors.clear();
  const root = document.documentElement.style;
  const image = (name: string, path?: string) => {
    if (path) root.setProperty(name, `url("${assetUrl(path)}")`);
  };
  image('--page-image', ASSETS.background);
  image('--board-image', ASSETS.board);
  image('--tile-image', ASSETS.tile);
  image('--card-back-image', ASSETS.cardBack);
  document.title = STRINGS.gameTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', STRINGS.pageDescription);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor('--bg', '#10131f'));
}

/** Colour tokens already read (theme.css doesn't change while the game runs). */
const colors = new Map<string, string>();

/**
 * Read a colour token from theme.css (for effects drawn from code). Each is read once: reading a
 * style makes the browser bring every style up to date right then, and hits read several.
 */
export function themeColor(name: string, fallback = '#ffffff'): string {
  let value = colors.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) colors.set(name, value);
  }
  return value || fallback;
}
