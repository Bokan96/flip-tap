export type Seat = 0 | 1;

export interface Pos {
  r: number;
  c: number;
}

/** +1 = facing right (towards higher columns), -1 = facing left. */
export type Facing = 1 | -1;

export type CardKind = 'move' | 'guard' | 'focus' | 'attack' | 'heal';

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  /** Energy change for the user when the card resolves (negative spends). */
  cost: number;
  /** Movement [rows, cols]; cols are absolute (not facing-relative). */
  step?: [number, number];
  heal?: number;
  guard?: number;
  /** 3 rows of 3 chars ('1' = hit), written facing right; centre is the user. */
  pattern?: [string, string, string];
  damage?: number;
  /** Bonus cards are earned in Tournament mode. */
  bonus?: boolean;
  text?: string;
}

export interface FighterDef {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** Primary UI colour for this fighter. */
  color: string;
  /** Key into the emblem renderer (src/ui/emblems.ts) unless an image is supplied in assets. */
  emblem: string;
  signature: string[];
  lifeMax?: number;
  energyMax?: number;
}

export interface PlayerState {
  fighterId: string;
  life: number;
  energy: number;
  lifeMax: number;
  energyMax: number;
  pos: Pos;
  facing: Facing;
  /** Card ids this player may plan with. */
  deck: string[];
}

export type MatchOutcome = { winner: Seat } | { winner: null; draw: true };

export interface MatchState {
  round: number;
  players: [PlayerState, PlayerState];
  outcome: MatchOutcome | null;
}

/** One card id per slot. */
export type Plan = string[];

export type HitKind = 'none' | 'miss' | 'hit' | 'guard';

export interface StepPlayerResult {
  cardId: string;
  active: boolean;
  from: Pos;
  to: Pos;
  facing: Facing;
  /** Squares covered by this player's attack (empty if not an attack). */
  area: Pos[];
  /** How the opponent's card affected this player. */
  hit: HitKind;
  damageTaken: number;
  healed: number;
  life: number;
  energy: number;
}

export interface StepResult {
  slot: number;
  players: [StepPlayerResult, StepPlayerResult];
  outcome: MatchOutcome | null;
}

export interface RoundResult {
  steps: StepResult[];
  /** State after the round, including end-of-round energy recovery. */
  state: MatchState;
}
