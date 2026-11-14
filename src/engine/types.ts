import type { Variant } from '../content/variants';

export type Seat = 0 | 1;

export interface Pos {
  r: number;
  c: number;
}

/** +1 = facing right (towards higher columns), -1 = facing left. */
export type Facing = 1 | -1;

export type CardKind = 'move' | 'guard' | 'focus' | 'attack' | 'heal' | 'reload' | 'trap';

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
  /**
   * 3 rows of 3 (or 5, for a reach of 2) chars ('1' = hit), written facing right; the middle of
   * the middle row is the user.
   */
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
  /** Attack: the user loses this much life when the card resolves, hit or miss (can knock them out). */
  recoil?: number;
  /** Heal: only heals if the user's life is at or below this after the step's hits. */
  healAtOrBelow?: number;
  /** Attack: on a connecting hit (even a guarded one) the target loses this much energy. */
  sap?: number;
  /** Attack: extra damage against a target that moved this step. */
  vsMoved?: number;
  /** Attack: if the hit deals damage, the target is hexed (see Mods.hexBonus and BALANCE.hexDamage). */
  hex?: boolean;
  /** Attack: can't be planned after a move card in the same round. */
  planted?: boolean;
  /** Trap card: damage a trap on each of the pattern's squares deals to the first enemy to end a step there. */
  trap?: number;
  /** Move card: after movement, the two fighters trade places. */
  swap?: boolean;
  /** Move card: the step's columns are relative to facing (positive = toward the opponent). */
  forward?: boolean;
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
  /** Extra damage this player's traps deal. */
  trapBonus: number;
  /** Extra damage this player's hits deal when they break a hex. */
  hexBonus: number;
}

export interface Passive {
  name: string;
  text: string;
  mods: Partial<Mods>;
}

/** How a fighter leans when the CPU plays it (small nudges; leave out for neutral). */
export interface Personality {
  /** Above 0 values damage dealt over damage taken, below 0 the reverse (about -0.3 to 0.3). */
  aggression?: number;
  /** Extra weight on the worst case when choosing a plan (about 0 to 0.2). */
  caution?: number;
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
  /** Short play-style tag shown on fighter select (e.g. "Burst", "Trapper"). */
  role: string;
  /** How tricky the fighter is to play well: 1 (simple) to 3 (advanced). */
  complexity: 1 | 2 | 3;
  passive?: Passive;
  /** CPU personality for this fighter. */
  ai?: Personality;
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
  /** Hexed: the next enemy hit that connects deals extra damage and breaks the hex. Lasts across rounds. */
  hexed: boolean;
  /** Stunned: this player's next card is cancelled. Cleared at the end of every round (except in Two-tap). */
  dazed: boolean;
  /** Two-tap only: the card locked in last round, which plays first this round (null in round 1). */
  carry?: { held: string | null };
}

export type MatchOutcome = { winner: Seat } | { winner: null; draw: true };

/** Effects some arena squares have on a fighter who ends a step there. */
export type TileKind = 'spikes' | 'well';

/** A trap on the board: hurts the owner's opponent when they end a step on it. */
export interface Trap {
  /** Square index (r * cols + c). */
  at: number;
  owner: Seat;
  damage: number;
  /** Removed at the end of this round. */
  until: number;
}

/** The board a match is played on (see content/arenas.ts). Plain data, so it saves as JSON. */
export interface ArenaState {
  id: string;
  rows: number;
  cols: number;
  /** Square indices (r * cols + c) nobody can stand on. */
  blocked: number[];
  /** Square effects by square index. */
  tiles: Record<number, TileKind>;
  /** Traps currently on the board. */
  traps: Trap[];
}

export interface MatchState {
  round: number;
  /** Rule variant (see content/variants.ts); absent for the classic rules. */
  variant?: Variant;
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
  /** Both fighters traded places this step. */
  swapped: boolean;
  /** Damage from an enemy trap this player stepped on. */
  trapDamage: number;
  /** Life this player lost to their own attack's recoil. */
  recoilTaken: number;
  /** Energy this player lost to the opponent's sap. */
  energyLost: number;
  /** This player got hexed this step. */
  hexApplied: boolean;
  /** A hit broke the hex on this player this step (its extra damage is in damageTaken). */
  hexBroken: boolean;
  /** Hexed after the step (for the status glow). */
  hexed: boolean;
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
  /** Traps on the board after this step (including ones placed during it). */
  traps: Trap[];
  /** Squares (r * cols + c) of traps an enemy attack destroyed this step. */
  brokenTraps: number[];
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
