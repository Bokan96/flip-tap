/*
 * Artwork, sound and music files. Every slot is optional: leave it out and the built-in vector
 * art, synthesized sound or theme colour is used instead.
 *
 * Put files in /public/assets/ and refer to them relative to the site root,
 * e.g. 'assets/fighters/cinder.png'. See docs/RESKIN.md for sizes and the full checklist.
 */

export type SoundId =
  | 'click' | 'place' | 'deny' | 'reveal' | 'step' | 'hit' | 'guard' | 'miss' | 'heal' | 'ko' | 'win' | 'tick'
  // effects
  | 'flip' | 'clang' | 'zap' | 'shimmer' | 'thud' | 'reload' | 'trap' | 'burn' | 'swap'
  // attack styles (see CardDef.fx)
  | 'slash' | 'burst' | 'wave' | 'beam' | 'quake';

export interface FighterArt {
  /** Small icon: HUD, ladder, lists, deck viewer, title screen row. Replaces the vector emblem. */
  emblem?: string;
  /** Large picture: fighter select, VS splash, result and daily screens. Defaults to the emblem. */
  portrait?: string;
  /** Picture inside the board piece. Without it the piece is a plain diamond in the player's colour. */
  token?: string;
}

export interface AssetOverrides {
  /** Per fighter id. A plain string is treated as the emblem. */
  fighters: Record<string, string | FighterArt>;
  /** Per card id: artwork shown behind the card's grid (darkened at the bottom for legibility). */
  cards: Record<string, string>;
  /** Title-screen logo image (replaces the text logo). */
  logo?: string;
  /** Whole-page background. */
  background?: string;
  /** Behind the board. */
  board?: string;
  /** Each board square. */
  tile?: string;
  /** Back of face-down cards during the reveal. */
  cardBack?: string;
  sounds: Partial<Record<SoundId, string>>;
  /** Looping background tracks. Without them the built-in synthesized loops play. */
  music: { menu?: string; battle?: string };
}

export const ASSETS: AssetOverrides = {
  fighters: {},
  cards: {},
  sounds: {},
  music: {},
};

/** A fighter's art slots, accepting the short form (a plain string = emblem). */
export function fighterArt(fighterId: string): FighterArt {
  const art = ASSETS.fighters[fighterId];
  return typeof art === 'string' ? { emblem: art } : (art ?? {});
}

export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
