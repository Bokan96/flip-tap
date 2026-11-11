export type Seat = 0 | 1;

export interface Pos {
  r: number;
  c: number;
}

/** +1 = facing right (towards higher columns), -1 = facing left. */
export type Facing = 1 | -1;

export type CardKind = 'move' | 'guard' | 'focus' | 'attack' | 'heal' | 'reload';

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
  /** Attack: on a connecting hit, move the target n squares away (n > 0) or toward you (n < 0) along columns. */
  push?: number;
  /** Attack: if the hit deals damage, the target's next card this round is cancelled. */
  stun?: boolean;
  /** Guard: if an attack hits you this step, the attacker takes this much damage. */
  counter?: number;
  /** Attack: percent of the damage dealt that heals the attacker. */
  drain?: number;
  /** Attack animation style; guessed from the pattern when omitted (see ui/fx.ts). */
  fx?: 'slash' | 'burst' | 'wave' | 'beam' | 'quake';
  /** Bonus cards are earned in Tournament mode. */
  bonus?: boolean;
  text?: string;
}

/**
 * Numeric rule modifiers for one player. Fighter passives and match modifiers (e.g. the daily
 * challenge) are both expressed as Mods and merged when the match is created.
 */
export interface Mods {
  /** Added to every attack this player makes. */
  damageBonus: number;
  /** While this player's life is at or below `lowLifeThreshold`, attacks deal `lowLifeBonus` more. 0 = off. */
  lowLifeThreshold: number;
  lowLifeBonus: number;
  /** Subtracted from every hit this player takes. */
  damageReduction: number;
  /** Subtracted from hits taken on a step where this player moved. */
  movedReduction: number;
  /** Added to this player's attacks against a target that moved this step. */
  vsMovedBonus: number;
  /** Extra energy recovered at the end of each round. */
  energyPerRound: number;
  /** Ignores push and pull. */
  immovable: boolean;
  /** This player's pushes and pulls move the target this many extra squares. */
  pushBonus: number;
  /** Attacks are spent once played and can't be used again until a Reload card is played. */
  ammo: boolean;
}

export interface Passive {
  name: string;
  text: string;
  mods: Partial<Mods>;
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
  passive?: Passive;
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
  mods: Mods;
  /** Ammo fighters only: attack cards already fired and not yet reloaded. */
  spent: string[];
  /** Stunned: this player's next card this round is cancelled. Cleared at the end of every round. */
  dazed: boolean;
}

export type MatchOutcome = { winner: Seat } | { winner: null; draw: true };

/** Effects some arena squares have on a fighter who ends a step there. */
export type TileKind = 'spikes' | 'well';

/** The board a match is played on (see content/arenas.ts). Plain data, so it saves as JSON. */
export interface ArenaState {
  id: string;
  rows: number;
  cols: number;
  /** Square indices (r * cols + c) nobody can stand on. */
  blocked: number[];
  /** Square effects by square index. */
  tiles: Record<number, TileKind>;
}

export interface MatchState {
  round: number;
  arena: ArenaState;
  players: [PlayerState, PlayerState];
  outcome: MatchOutcome | null;
}

/** One card id per slot. */
export type Plan = string[];

export type HitKind = 'none' | 'miss' | 'hit' | 'guard';

export interface StepPlayerResult {
  cardId: string;
  /** False if the card did nothing (stunned or unaffordable). */
  active: boolean;
  /** The card was cancelled by a stun from the previous step. */
  stunned: boolean;
  from: Pos;
  /** Position after movement. */
  to: Pos;
  /** Position after push/pull (same as `to` if not displaced). */
  final: Pos;
  moved: boolean;
  facing: Facing;
  /** Squares covered by this player's attack (empty if not an attack). */
  area: Pos[];
  /** How the opponent's card affected this player. */
  hit: HitKind;
  damageTaken: number;
  /** Damage taken from the opponent's counter. */
  counterTaken: number;
  /** Life gained from this player's drain attack. */
  drained: number;
  /** Got stunned this step: the next card this round is cancelled. */
  dazed: boolean;
  /** This player's attack never landed because they were knocked out by a faster attack first. */
  interrupted: boolean;
  /** This player's Reload card resolved: all spent attacks are usable again. */
  reloaded: boolean;
  /** The square effect this player ended the step on, if any. */
  tile: TileKind | null;
  healed: number;
  life: number;
  energy: number;
}

export interface StepResult {
  slot: number;
  players: [StepPlayerResult, StepPlayerResult];
  outcome: MatchOutcome | null;
  /**
   * When both fighters attack, the order they strike in (see rules.strikeOrder);
   * null when only one attacks or both strike at the same time.
   */
  sequence: [Seat, Seat] | null;
  /** Both fighters' life right after the first strike of a sequence (for the reveal animation). */
  midLives: [number, number] | null;
}

export interface RoundResult {
  steps: StepResult[];
  /** State after the round, including end-of-round energy recovery. */
  state: MatchState;
  /** Fatigue damage both fighters took at the end of this round (0 before it starts). */
  fatigue: number;
}

/** Everything that happened in a match, round by round (used for stats and achievements). */
export interface MatchLog {
  rounds: { plans: [Plan, Plan]; result: RoundResult }[];
}
