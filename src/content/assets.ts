/*
 * Optional art and sound overrides. Drop files into /public/assets and point to them here
 * (paths are relative to the site root, e.g. 'assets/fighters/cinder.png').
 * Anything left out falls back to the built-in vector emblems and synthesized sounds.
 */
export interface AssetOverrides {
  fighters: Record<string, string>;
  sounds: Partial<Record<SoundId, string>>;
  music?: string;
}

export type SoundId = 'click' | 'place' | 'deny' | 'reveal' | 'step' | 'hit' | 'guard' | 'miss' | 'heal' | 'ko' | 'win';

export const ASSETS: AssetOverrides = {
  fighters: {},
  sounds: {},
};

export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
