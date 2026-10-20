import { BALANCE } from '../content/balance';
import { BASIC_CARD_IDS, getFighter } from '../content/cards';
import type { MatchState, PlayerState, Seat } from './types';

export interface SeatConfig {
  fighterId: string;
  /** Extra cards (e.g. tournament bonus cards). */
  bonusCards?: string[];
}

export function buildDeck(fighterId: string, bonusCards: string[] = []): string[] {
  const f = getFighter(fighterId);
  return [...BASIC_CARD_IDS, ...f.signature, ...bonusCards.filter((id) => !BASIC_CARD_IDS.includes(id))];
}

function createPlayer(seat: Seat, cfg: SeatConfig): PlayerState {
  const f = getFighter(cfg.fighterId);
  const lifeMax = f.lifeMax ?? BALANCE.lifeMax;
  const energyMax = f.energyMax ?? BALANCE.energyMax;
  return {
    fighterId: f.id,
    life: lifeMax,
    energy: energyMax,
    lifeMax,
    energyMax,
    pos: { ...BALANCE.startPos[seat] },
    facing: seat === 0 ? 1 : -1,
    deck: buildDeck(f.id, cfg.bonusCards),
  };
}

export function createMatch(p0: SeatConfig, p1: SeatConfig): MatchState {
  return {
    round: 1,
    outcome: null,
    players: [createPlayer(0, p0), createPlayer(1, p1)],
  };
}
