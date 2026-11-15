import { BASIC_CARD_IDS, CARDS, registerCustom } from '../content/cards';
import { STRINGS } from '../content/strings';
import { clearFastCards } from '../engine/fastsim';
import type { CardDef, FighterDef } from '../engine/types';
import { EMBLEM_KEYS } from '../ui/emblems';
import { readJson, writeJson } from './storage';

/*
 * The hero creator's saved work: custom heroes (name, emblem, colour, 4 cards) and custom cards.
 * Kept under its own key, apart from the profile, so resetting progress keeps them. Everything is
 * checked on the way in and out (names cleaned, numbers clamped, patterns validated), because names
 * end up in the page's HTML and the engine trusts card fields.
 */

export interface CustomHero {
  id: string;
  name: string;
  /** One of EMBLEM_KEYS. */
  emblem: string;
  /** #rrggbb */
  color: string;
  /** Exactly HERO_CARDS card ids: built-in signature/bonus cards or custom cards. */
  cards: string[];
}

export interface CustomData {
  heroes: CustomHero[];
  cards: CardDef[];
}

const KEY = 'fliptap.custom.v1';
export const HERO_CARDS = 4;
export const HERO_LIMIT = 12;
export const CARD_LIMIT = 40;
export const NAME_MAX = 16;
export const HERO_COLORS = ['#ff6b3d', '#ffb13d', '#ffd23d', '#9fe04a', '#3ddc84', '#2fe0bf', '#3da5ff', '#7c8cff', '#b07cff', '#ff5fb4', '#e6e9f2', '#9fb6cc'];
export const CUSTOM_KINDS = ['attack', 'trap', 'guard', 'move', 'heal'] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];

/** The ranges the card editor offers (and loading enforces), in steps of 5. */
export const LIMITS = {
  cost: [0, 100],
  damage: [0, 100],
  trap: [5, 60],
  guard: [5, 100],
  counter: [0, 50],
  blockSap: [0, 50],
  heal: [5, 60],
  sap: [5, 50],
  hex: [5, 50],
  recoil: [5, 50],
  vsMoved: [5, 50],
} as const;
export const DRAIN_STEPS = [25, 50, 100];
export const HEAL_BELOW = [30, 50, 70];

/** Letters (any alphabet), digits, spaces and a little punctuation; trimmed and capped. Safe in HTML. */
export function cleanName(raw: unknown, max = NAME_MAX): string {
  return String(raw ?? '')
    .replace(/[^\p{L}\p{N} \-'.!]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const step5 = (v: unknown, [lo, hi]: readonly number[]) => Math.min(hi, Math.max(lo, Math.round(Number(v) / 5) * 5 || 0));

/** 3 rows of 3 (or 5, a reach of 2) '0'/'1', with at least one square. */
export function okPattern(p: unknown): p is [string, string, string] {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((r) => typeof r === 'string' && /^[01]+$/.test(r) && r.length === p[0].length) &&
    (p[0].length === 3 || p[0].length === 5) &&
    p.join('').includes('1')
  );
}

type Raw = Record<string, unknown>;

/** A custom card made safe: only the fields its kind allows, every number in range. Null if unusable. */
export function cleanCard(input: unknown): CardDef | null {
  const raw = input as Raw | null;
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^cc-[a-z0-9]+$/.test(raw.id)) return null;
  const kind = raw.kind as CustomKind;
  if (!CUSTOM_KINDS.includes(kind)) return null;
  const c: CardDef = { id: raw.id, name: cleanName(raw.name) || STRINGS.hero.untitledCard, kind, cost: -step5(-Number(raw.cost), LIMITS.cost) };
  const optional = (key: 'counter' | 'blockSap' | 'sap' | 'hex' | 'recoil' | 'vsMoved') => {
    if (Number(raw[key]) > 0) c[key] = step5(raw[key], key === 'counter' || key === 'blockSap' ? [5, LIMITS[key][1]] : LIMITS[key]);
  };
  switch (kind) {
    case 'attack': {
      if (!okPattern(raw.pattern)) return null;
      c.pattern = [...raw.pattern];
      c.damage = step5(raw.damage, LIMITS.damage);
      const push = Math.max(-2, Math.min(2, Math.round(Number(raw.push) || 0)));
      if (push) c.push = push;
      if (raw.stun) c.stun = true;
      if (DRAIN_STEPS.includes(Number(raw.drain))) c.drain = Number(raw.drain);
      (['sap', 'hex', 'recoil', 'vsMoved'] as const).forEach(optional);
      if (raw.planted) c.planted = true;
      break;
    }
    case 'trap':
      if (!okPattern(raw.pattern)) return null;
      c.pattern = [...raw.pattern];
      c.trap = step5(raw.trap, LIMITS.trap);
      break;
    case 'guard':
      c.guard = step5(raw.guard, LIMITS.guard);
      optional('counter');
      optional('blockSap');
      break;
    case 'move': {
      if (raw.swap) c.swap = true;
      else {
        const s = Array.isArray(raw.step) ? raw.step : [];
        const dr = Math.max(-2, Math.min(2, Math.round(Number(s[0]) || 0)));
        const dc = Math.max(-2, Math.min(2, Math.round(Number(s[1]) || 0)));
        if (!dr && !dc) return null;
        c.step = [dr, dc];
        if (raw.forward) c.forward = true;
      }
      optional('counter');
      break;
    }
    case 'heal':
      c.heal = step5(raw.heal, LIMITS.heal);
      if (HEAL_BELOW.includes(Number(raw.healAtOrBelow))) c.healAtOrBelow = Number(raw.healAtOrBelow);
      break;
  }
  return c;
}

/** Can a hero use this card? Built-in non-basic cards (other heroes' and bonus cards) or a custom card. */
export function heroCardOk(id: string, customIds: Set<string>): boolean {
  return customIds.has(id) || (!!CARDS[id] && !BASIC_CARD_IDS.includes(id));
}

/** A custom hero made safe, or null if it doesn't name exactly HERO_CARDS usable, different cards. */
export function cleanHero(input: unknown, customIds: Set<string>): CustomHero | null {
  const raw = input as Raw | null;
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^ch-[a-z0-9]+$/.test(raw.id)) return null;
  const name = cleanName(raw.name);
  const cards = Array.isArray(raw.cards) ? raw.cards.filter((id): id is string => typeof id === 'string') : [];
  if (!name || cards.length !== HERO_CARDS || new Set(cards).size !== HERO_CARDS || !cards.every((id) => heroCardOk(id, customIds))) return null;
  return {
    id: raw.id,
    name,
    emblem: EMBLEM_KEYS.includes(String(raw.emblem)) ? String(raw.emblem) : EMBLEM_KEYS[0],
    color: /^#[0-9a-f]{6}$/i.test(String(raw.color)) ? String(raw.color) : HERO_COLORS[0],
    cards,
  };
}

/** The fighter a custom hero plays as: no passive, a neutral CPU. */
export function heroFighter(h: CustomHero): FighterDef {
  return { id: h.id, name: h.name, title: STRINGS.hero.customTitle, blurb: '', color: h.color, emblem: h.emblem, signature: [...h.cards], role: STRINGS.hero.role, complexity: 2 };
}

let data: CustomData | null = null;

/** The saved heroes and cards (checked once, then kept in memory). */
export function customData(): CustomData {
  if (data) return data;
  const raw = readJson<{ heroes?: unknown[]; cards?: unknown[] }>(KEY);
  const cards = (raw?.cards ?? []).map(cleanCard).filter((c): c is CardDef => !!c).slice(0, CARD_LIMIT);
  const ids = new Set(cards.map((c) => c.id));
  const heroes = (raw?.heroes ?? []).map((h) => cleanHero(h, ids)).filter((h): h is CustomHero => !!h).slice(0, HERO_LIMIT);
  data = { heroes, cards };
  return data;
}

/** Make the saved heroes and cards playable (call before anything reads a saved match). */
export function applyCustom(): void {
  const d = customData();
  registerCustom(d.cards, d.heroes.map(heroFighter));
  clearFastCards();
}

function commit(next: CustomData): void {
  data = next;
  writeJson(KEY, { version: 1, ...next });
  applyCustom();
}

export const customHeroes = (): CustomHero[] => customData().heroes;
export const customCards = (): CardDef[] => customData().cards;

/** A fresh id for a new hero ('ch') or card ('cc'). */
export function newId(prefix: 'ch' | 'cc'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Save (create or replace) a hero. Returns it as saved, or null if it isn't complete. */
export function saveHero(h: CustomHero): CustomHero | null {
  const d = customData();
  const clean = cleanHero(h, new Set(d.cards.map((c) => c.id)));
  if (!clean) return null;
  const exists = d.heroes.some((x) => x.id === clean.id);
  if (!exists && d.heroes.length >= HERO_LIMIT) return null;
  commit({ ...d, heroes: exists ? d.heroes.map((x) => (x.id === clean.id ? clean : x)) : [...d.heroes, clean] });
  return clean;
}

export function deleteHero(id: string): void {
  const d = customData();
  commit({ ...d, heroes: d.heroes.filter((h) => h.id !== id) });
}

/** Save (create or replace) a custom card. Returns it as saved, or null if it isn't usable. */
export function saveCard(c: CardDef): CardDef | null {
  const d = customData();
  const clean = cleanCard(c);
  if (!clean) return null;
  const exists = d.cards.some((x) => x.id === clean.id);
  if (!exists && d.cards.length >= CARD_LIMIT) return null;
  commit({ ...d, cards: exists ? d.cards.map((x) => (x.id === clean.id ? clean : x)) : [...d.cards, clean] });
  return clean;
}

/** Heroes that use a card (a card in use can't be deleted). */
export const heroesUsing = (cardId: string): CustomHero[] => customData().heroes.filter((h) => h.cards.includes(cardId));

/** Delete a custom card; false if a hero still uses it. */
export function deleteCard(id: string): boolean {
  if (heroesUsing(id).length) return false;
  const d = customData();
  commit({ ...d, cards: d.cards.filter((c) => c.id !== id) });
  return true;
}

/** Forget the in-memory copy (tests switch storage between cases). */
export function resetCustomCache(): void {
  data = null;
}
