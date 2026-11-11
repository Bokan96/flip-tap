import type { ArenaState, Pos, TileKind } from '../engine/types';

/*
 * Arenas (content: edit freely). Every arena must be point-symmetric (turning the board half a
 * turn swaps the two sides exactly) so neither seat has an advantage; a test checks this.
 * Coordinates are [row, column] from the top-left.
 */
export interface ArenaDef {
  id: string;
  name: string;
  /** One line shown in the arena picker. */
  text: string;
  rows: number;
  cols: number;
  /** Start squares for Player 1 and Player 2. */
  start: [[number, number], [number, number]];
  blocked?: [number, number][];
  tiles?: { at: [number, number]; kind: TileKind }[];
}

export const ARENAS: ArenaDef[] = [
  { id: 'classic', name: 'Classic', text: 'The original 3×4 board.', rows: 3, cols: 4, start: [[1, 0], [1, 3]] },
  { id: 'hall', name: 'Long Hall', text: 'A wider board: more room to dodge.', rows: 3, cols: 5, start: [[1, 0], [1, 4]] },
  {
    id: 'pillars',
    name: 'Pillars',
    text: 'Two stone pillars block movement and stop pushes.',
    rows: 3,
    cols: 4,
    start: [[1, 0], [1, 3]],
    blocked: [[0, 1], [2, 2]],
  },
  {
    id: 'springs',
    name: 'Hot Springs',
    text: 'Ending a step on a spring restores energy.',
    rows: 3,
    cols: 4,
    start: [[1, 0], [1, 3]],
    tiles: [
      { at: [0, 2], kind: 'well' },
      { at: [2, 1], kind: 'well' },
    ],
  },
  {
    id: 'thorns',
    name: 'Thorn Garden',
    text: 'Thorns in the middle lane hurt whoever stops on them.',
    rows: 3,
    cols: 4,
    start: [[1, 0], [1, 3]],
    tiles: [
      { at: [1, 1], kind: 'spikes' },
      { at: [1, 2], kind: 'spikes' },
    ],
  },
  {
    id: 'court',
    name: 'Grand Court',
    text: 'A big 4×5 court with two pillars.',
    rows: 4,
    cols: 5,
    start: [[1, 0], [2, 4]],
    blocked: [[0, 2], [3, 2]],
  },
];

export const DEFAULT_ARENA = 'classic';

export function getArena(id: string): ArenaDef {
  const a = ARENAS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown arena: ${id}`);
  return a;
}

/** The match-state form of an arena. */
export function arenaState(id = DEFAULT_ARENA): ArenaState {
  const a = getArena(id);
  const idx = ([r, c]: [number, number]) => r * a.cols + c;
  const tiles: Record<number, TileKind> = {};
  for (const t of a.tiles ?? []) tiles[idx(t.at)] = t.kind;
  return { id: a.id, rows: a.rows, cols: a.cols, blocked: (a.blocked ?? []).map(idx), tiles, traps: [] };
}

export function arenaStart(id: string, seat: 0 | 1): Pos {
  const [r, c] = getArena(id).start[seat];
  return { r, c };
}
