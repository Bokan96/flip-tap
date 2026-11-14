import { ARENAS } from '../content/arenas';
import { BALANCE } from '../content/balance';
import { BASIC_CARD_IDS, CARDS, FIGHTERS, getCard, getFighter } from '../content/cards';
import { MODIFIERS } from '../content/modifiers';
import { TWO_TAP, type Variant } from '../content/variants';
import { DIFFICULTIES, type Difficulty } from '../engine/ai';
import { resolveRound } from '../engine/rules';
import { buildDeck, createMatch } from '../engine/setup';
import type { MatchLog, MatchOutcome, MatchState, Plan, Seat } from '../engine/types';
import type { PlanSource } from '../net/transport';

/**
 * A finished match, small enough for a link. The engine is deterministic, so the match is
 * rebuilt by re-running every round's plans from the same start.
 */
export interface Replay {
  mode: ReplayMode;
  /** CPU difficulty for seat 1 (null in hot-seat). */
  difficulty: Difficulty | null;
  arena: string;
  fighters: [string, string];
  /** Each seat's extra cards (loadout or tournament rival bonus). */
  bonus: [string[], string[]];
  /** Daily rule twist id, or null. */
  modifier: string | null;
  /** Daily challenge date (YYYY-MM-DD), or null. */
  date: string | null;
  /** Rule variant (absent: classic). */
  variant?: Variant;
  rounds: [Plan, Plan][];
  /** Recorded with different card, fighter or arena numbers, so it may play out differently now. */
  stale?: boolean;
}

export type ReplayMode = 'cpu' | 'hotseat' | 'tournament' | 'daily';
const MODES: ReplayMode[] = ['cpu', 'hotseat', 'tournament', 'daily'];
const VERSION = 1;

/** The bonus cards in a deck: everything that isn't a basic or one of the fighter's own cards. */
function bonusOf(state: MatchState, seat: Seat): string[] {
  const p = state.players[seat];
  const own = getFighter(p.fighterId).signature;
  return p.deck.filter((id) => !BASIC_CARD_IDS.includes(id) && !own.includes(id));
}

/** Build the replay of a match from its final state and log. */
export function replayFromMatch(
  state: MatchState,
  log: MatchLog,
  info: { mode: ReplayMode; difficulty: Difficulty | null; modifier?: string | null; date?: string | null },
): Replay {
  return {
    mode: info.mode,
    difficulty: info.difficulty,
    arena: state.arena.id,
    fighters: [state.players[0].fighterId, state.players[1].fighterId],
    bonus: [bonusOf(state, 0), bonusOf(state, 1)],
    modifier: info.modifier ?? null,
    date: info.date ?? null,
    ...(state.variant ? { variant: state.variant } : {}),
    rounds: log.rounds.map((r) => [[...r.plans[0]], [...r.plans[1]]]),
  };
}

/** The match exactly as it started. */
export function replayStart(r: Replay): MatchState {
  const mod = r.modifier ? MODIFIERS.find((m) => m.id === r.modifier)?.modifier : undefined;
  return createMatch(
    { fighterId: r.fighters[0], bonusCards: r.bonus[0] },
    { fighterId: r.fighters[1], bonusCards: r.bonus[1] },
    mod,
    r.arena,
    r.variant,
  );
}

export interface ReplayRun {
  /** `states[k]` is the state at the start of round k + 1; the last one is the final state. */
  states: MatchState[];
  log: MatchLog;
  outcome: MatchOutcome;
}

/** Re-run the whole match. Null if a plan is no longer legal (content changed too much). */
export function runReplay(r: Replay): ReplayRun | null {
  try {
    let state = replayStart(r);
    const states = [state];
    const log: MatchLog = { rounds: [] };
    for (const plans of r.rounds) {
      if (state.outcome) return null;
      const result = resolveRound(state, plans);
      log.rounds.push({ plans, result });
      state = result.state;
      states.push(state);
    }
    if (!state.outcome) return null;
    return { states, log, outcome: state.outcome };
  } catch {
    return null;
  }
}

// ---------- content stamp ----------

/** Text-only fields: changing them never changes how a match plays out. */
const COSMETIC = new Set(['name', 'text', 'title', 'blurb', 'role', 'color', 'emblem', 'complexity', 'ai', 'fx']);

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 16-bit fingerprint of the rules and content that decide a match. A variant's own numbers only
 * count for matches played with it, so tuning Two-tap leaves classic replays fresh.
 */
export function contentStamp(variant?: Variant): number {
  const content = { BALANCE, CARDS, FIGHTERS, ARENAS, MODIFIERS, ...(variant === 'twoTap' ? { TWO_TAP } : {}) };
  const json = JSON.stringify(content, (k, v) => (COSMETIC.has(k) ? undefined : v));
  return hash(json) & 0xffff;
}

// ---------- binary format ----------
// version · stamp (2 bytes) · mode + difficulty + variant · arena · 2 fighters · bonus lists · modifier ·
// date · round count · plans as deck indices, 5 bits each. Strings are length-prefixed ASCII.

const INDEX_BITS = 5;
/** Flag in the mode byte (bits 0-2 mode, 3-5 difficulty). */
const TWO_TAP_BIT = 1 << 6;

class Writer {
  bytes: number[] = [];
  private acc = 0;
  private bits = 0;
  byte(n: number): void {
    this.bytes.push(n & 0xff);
  }
  str(s: string): void {
    if (s.length > 255 || /[^\x20-\x7e]/.test(s)) throw new Error(`Can't encode "${s}"`);
    this.byte(s.length);
    for (const ch of s) this.byte(ch.charCodeAt(0));
  }
  bitsOut(value: number, n: number): void {
    this.acc = (this.acc << n) | value;
    this.bits += n;
    while (this.bits >= 8) {
      this.bits -= 8;
      this.byte(this.acc >> this.bits);
      this.acc &= (1 << this.bits) - 1;
    }
  }
  flush(): void {
    if (this.bits > 0) this.byte(this.acc << (8 - this.bits));
    this.acc = 0;
    this.bits = 0;
  }
}

class Reader {
  private i = 0;
  private acc = 0;
  private bits = 0;
  constructor(private bytes: Uint8Array) {}
  byte(): number {
    if (this.i >= this.bytes.length) throw new Error('Replay is cut short');
    return this.bytes[this.i++];
  }
  str(): string {
    const n = this.byte();
    let s = '';
    for (let k = 0; k < n; k++) s += String.fromCharCode(this.byte());
    return s;
  }
  bitsIn(n: number): number {
    while (this.bits < n) {
      this.acc = (this.acc << 8) | this.byte();
      this.bits += 8;
    }
    this.bits -= n;
    const v = this.acc >> this.bits;
    this.acc &= (1 << this.bits) - 1;
    return v;
  }
}

function toBase64Url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('Not a replay code');
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Pack a replay into a short URL-safe code. */
export function encodeReplay(r: Replay): string {
  const w = new Writer();
  w.byte(VERSION);
  const stamp = contentStamp(r.variant);
  w.byte(stamp >> 8);
  w.byte(stamp);
  const diff = r.difficulty ? DIFFICULTIES.indexOf(r.difficulty) + 1 : 0;
  w.byte(MODES.indexOf(r.mode) | (diff << 3) | (r.variant === 'twoTap' ? TWO_TAP_BIT : 0));
  w.str(r.arena);
  r.fighters.forEach((f) => w.str(f));
  r.bonus.forEach((list) => {
    w.byte(list.length);
    list.forEach((id) => w.str(id));
  });
  w.str(r.modifier ?? '');
  w.str(r.date ?? '');
  w.byte(r.rounds.length);
  const decks = [0, 1].map((i) => buildDeck(r.fighters[i], r.bonus[i]));
  for (const plans of r.rounds) {
    plans.forEach((plan, i) => {
      if (plan.length !== BALANCE.slotsPerRound) throw new Error('Plan has the wrong length');
      for (const id of plan) {
        const at = decks[i].indexOf(id);
        if (at < 0 || at >= 1 << INDEX_BITS) throw new Error(`Card ${id} is not in the deck`);
        w.bitsOut(at, INDEX_BITS);
      }
    });
  }
  w.flush();
  return toBase64Url(w.bytes);
}

/** Unpack a replay code. Null if it is damaged or names content this version doesn't have. */
export function decodeReplay(code: string): Replay | null {
  try {
    const rd = new Reader(fromBase64Url(code.trim()));
    if (rd.byte() !== VERSION) return null;
    const stamp = (rd.byte() << 8) | rd.byte();
    const md = rd.byte();
    const mode = MODES[md & 7];
    const diff = (md >> 3) & 7;
    const variant: Variant | undefined = md & TWO_TAP_BIT ? 'twoTap' : undefined;
    if (!mode || diff > DIFFICULTIES.length || md & 0x80) return null;
    const arena = rd.str();
    if (!ARENAS.some((a) => a.id === arena)) return null;
    const fighters = [rd.str(), rd.str()] as [string, string];
    fighters.forEach(getFighter);
    const bonus = [0, 1].map(() => Array.from({ length: rd.byte() }, () => rd.str())) as [string[], string[]];
    bonus.flat().forEach(getCard);
    const modifier = rd.str() || null;
    if (modifier && !MODIFIERS.some((m) => m.id === modifier)) return null;
    const date = rd.str() || null;
    const count = rd.byte();
    const decks = [0, 1].map((i) => buildDeck(fighters[i], bonus[i]));
    const rounds: [Plan, Plan][] = [];
    for (let k = 0; k < count; k++) {
      const plans = [0, 1].map((i) =>
        Array.from({ length: BALANCE.slotsPerRound }, () => {
          const id = decks[i][rd.bitsIn(INDEX_BITS)];
          if (!id) throw new Error('Card index out of range');
          return id;
        }),
      ) as [Plan, Plan];
      rounds.push(plans);
    }
    return {
      mode,
      difficulty: diff ? DIFFICULTIES[diff - 1] : null,
      arena,
      fighters,
      bonus,
      modifier,
      date,
      ...(variant ? { variant } : {}),
      rounds,
      stale: stamp !== contentStamp(variant),
    };
  } catch {
    return null;
  }
}

/** Plays back the recorded plans, one round at a time. */
export class ReplayPlanSource implements PlanSource {
  readonly kind = 'replay' as const;
  constructor(private rounds: [Plan, Plan][]) {}
  async requestPlan(state: MatchState, seat: Seat): Promise<Plan> {
    const plans = this.rounds[state.round - 1];
    if (!plans) throw new Error(`The replay has no round ${state.round}`);
    return [...plans[seat]];
  }
}
