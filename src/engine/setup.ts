import { BALANCE } from '../content/balance';
import { arenaStart, arenaState, DEFAULT_ARENA } from '../content/arenas';
import { BASIC_CARD_IDS, getFighter } from '../content/cards';
import type { Variant } from '../content/variants';
import type { MatchState, Mods, PlayerState, Seat } from './types';

export interface SeatConfig {
  fighterId: string;
  /** Extra cards (e.g. tournament bonus cards). */
  bonusCards?: string[];
}

/** Rule changes applied to both players for a whole match (e.g. the daily challenge). */
export interface MatchModifier {
  mods?: Partial<Mods>;
  /** Start values instead of full life / BALANCE.energyStart. */
  startLife?: number;
  startEnergy?: number;
}

export const NO_MODS: Mods = {
  damageBonus: 0,
  lowLifeThreshold: 0,
  lowLifeBonus: 0,
  damageReduction: 0,
  movedReduction: 0,
  vsMovedBonus: 0,
  energyPerRound: 0,
  immovable: false,
  pushBonus: 0,
  ammo: false,
  trapBonus: 0,
  hexBonus: 0,
};

/** Combine modifier sets: numbers add up, flags combine with OR, thresholds take the highest. */
export function mergeMods(...parts: (Partial<Mods> | undefined)[]): Mods {
  const out: Mods = { ...NO_MODS };
  for (const m of parts) {
    if (!m) continue;
    for (const key of Object.keys(m) as (keyof Mods)[]) {
      const v = m[key];
      if (v === undefined) continue;
      if (key === 'immovable' || key === 'ammo') out[key] = out[key] || (v as boolean);
      else if (key === 'lowLifeThreshold') out.lowLifeThreshold = Math.max(out.lowLifeThreshold, v as number);
      else out[key] = (out[key] as number) + (v as number);
    }
  }
  return out;
}

export function buildDeck(fighterId: string, bonusCards: string[] = []): string[] {
  const f = getFighter(fighterId);
  return [...BASIC_CARD_IDS, ...f.signature, ...bonusCards.filter((id) => !BASIC_CARD_IDS.includes(id))];
}

function createPlayer(seat: Seat, cfg: SeatConfig, mod: MatchModifier, arenaId: string, variant?: Variant): PlayerState {
  const f = getFighter(cfg.fighterId);
  const lifeMax = BALANCE.lifeMax;
  const energyMax = BALANCE.energyMax;
  return {
    fighterId: f.id,
    life: Math.min(lifeMax, mod.startLife ?? lifeMax),
    energy: Math.min(energyMax, mod.startEnergy ?? BALANCE.energyStart),
    lifeMax,
    energyMax,
    pos: arenaStart(arenaId, seat),
    facing: seat === 0 ? 1 : -1,
    deck: buildDeck(f.id, cfg.bonusCards),
    mods: mergeMods(f.passive?.mods, mod.mods),
    spent: [],
    hexed: false,
    dazed: false,
    ...(variant === 'twoTap' ? { carry: { held: null } } : {}),
  };
}

export function createMatch(
  p0: SeatConfig,
  p1: SeatConfig,
  modifier: MatchModifier = {},
  arenaId = DEFAULT_ARENA,
  variant?: Variant,
): MatchState {
  return {
    round: 1,
    ...(variant ? { variant } : {}),
    outcome: null,
    arena: arenaState(arenaId),
    players: [createPlayer(0, p0, modifier, arenaId, variant), createPlayer(1, p1, modifier, arenaId, variant)],
  };
}
