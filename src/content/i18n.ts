import { ACHIEVEMENTS } from './achievements';
import { ARENAS } from './arenas';
import { CARDS, FIGHTERS } from './cards';
import { SR } from './lang/sr';
import { MODIFIERS } from './modifiers';
import { STRINGS, type Strings } from './strings';

/*
 * Languages. English is written into the content and strings.ts; every other language is a
 * Translation that replaces those texts once, at startup (changing language reloads the game).
 * Only names and descriptions change, never numbers, so replays and balance are unaffected.
 */

export type Lang = 'en' | 'sr';

/** Each language under its own name. */
export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'sr', name: 'Srpski' },
];

/** Names and descriptions of the content, by id. */
export interface ContentText {
  cards: Record<string, { name: string; text?: string }>;
  fighters: Record<string, { title: string; blurb: string; role: string; passive: { name: string; text: string } }>;
  arenas: Record<string, { name: string; text: string }>;
  modifiers: Record<string, { name: string; text: string }>;
  achievements: Record<string, { name: string; text: string }>;
}

export interface Translation {
  /** Value for <html lang>. */
  htmlLang: string;
  strings: Strings;
  content: ContentText;
}

const TRANSLATIONS: Partial<Record<Lang, Translation>> = { sr: SR };
const KEY = 'fliptap.lang';

export function getLanguage(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v && LANGUAGES.some((l) => l.id === v)) return v as Lang;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function setLanguage(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable: lasts for this session only */
  }
}

/** Replace every English text with this translation's. */
export function applyTranslation(t: Translation): void {
  Object.assign(STRINGS, t.strings);
  for (const [id, c] of Object.entries(t.content.cards)) if (CARDS[id]) Object.assign(CARDS[id], c);
  for (const f of FIGHTERS) {
    const tf = t.content.fighters[f.id];
    if (!tf) continue;
    Object.assign(f, { title: tf.title, blurb: tf.blurb, role: tf.role });
    if (f.passive) Object.assign(f.passive, tf.passive);
  }
  for (const a of ARENAS) Object.assign(a, t.content.arenas[a.id] ?? {});
  for (const m of MODIFIERS) Object.assign(m, t.content.modifiers[m.id] ?? {});
  for (const a of ACHIEVEMENTS) Object.assign(a, t.content.achievements[a.id] ?? {});
  if (typeof document !== 'undefined') document.documentElement.lang = t.htmlLang;
}

/** Switch the texts to `lang` (English needs nothing: it is what the content is written in). */
export function applyLanguage(lang: Lang): void {
  const t = TRANSLATIONS[lang];
  if (t) applyTranslation(t);
}
