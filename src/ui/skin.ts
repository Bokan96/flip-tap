import { ASSETS, assetUrl } from '../content/assets';
import { STRINGS } from '../content/strings';

/** Apply page-wide skin settings: optional background images and the page title/description. */
export function applySkin(): void {
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

/** Read a colour token from theme.css (for effects drawn from code). */
export function themeColor(name: string, fallback = '#ffffff'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
