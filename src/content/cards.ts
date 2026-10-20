import type { CardDef, FighterDef } from '../engine/types';

/*
 * All game content lives here. To reskin the game, edit names/text/colours here,
 * strings in strings.ts and art/sound overrides in assets.ts. No engine changes needed.
 *
 * Patterns are 3 rows x 3 columns written facing RIGHT:
 *   column 0 = behind, column 1 = the user's column, column 2 = in front.
 */

const basics: CardDef[] = [
  { id: 'up', name: 'Step Up', kind: 'move', cost: 0, step: [-1, 0] },
  { id: 'down', name: 'Step Down', kind: 'move', cost: 0, step: [1, 0] },
  { id: 'left', name: 'Step Left', kind: 'move', cost: 0, step: [0, -1] },
  { id: 'right', name: 'Step Right', kind: 'move', cost: 0, step: [0, 1] },
  { id: 'guard', name: 'Guard', kind: 'guard', cost: 0, guard: 15, text: 'Reduce damage taken this step by 15.' },
  { id: 'focus', name: 'Focus', kind: 'focus', cost: 15, text: 'Gain 15 energy.' },
];

const bonus: CardDef[] = [
  { id: 'bulwark', name: 'Bulwark', kind: 'guard', cost: -30, guard: 100, bonus: true, text: 'Block all damage this step.' },
  { id: 'renew', name: 'Renew', kind: 'heal', cost: -55, heal: 35, bonus: true, text: 'Restore 35 life.' },
  { id: 'leapLeft', name: 'Leap Left', kind: 'move', cost: -5, step: [0, -2], bonus: true },
  { id: 'leapRight', name: 'Leap Right', kind: 'move', cost: -5, step: [0, 2], bonus: true },
  { id: 'overload', name: 'Overload', kind: 'attack', cost: -90, damage: 75, pattern: ['000', '010', '000'], bonus: true, text: 'Only hits a foe on your square.' },
  { id: 'stormCall', name: 'Storm Call', kind: 'attack', cost: -20, damage: 15, pattern: ['111', '111', '111'], bonus: true },
  { id: 'surge', name: 'Surge', kind: 'focus', cost: 35, bonus: true, text: 'Gain 35 energy.' },
];

const signature: CardDef[] = [
  // Cinder: high damage, hungry for energy
  { id: 'cinderJab', name: 'Ember Jab', kind: 'attack', cost: -15, damage: 25, pattern: ['000', '011', '000'] },
  { id: 'cinderRing', name: 'Fire Ring', kind: 'attack', cost: -30, damage: 20, pattern: ['111', '101', '111'] },
  { id: 'cinderPillar', name: 'Flame Pillar', kind: 'attack', cost: -25, damage: 30, pattern: ['010', '010', '010'] },
  { id: 'cinderBlaze', name: 'Wildfire', kind: 'attack', cost: -55, damage: 45, pattern: ['011', '011', '011'] },

  // Marin: wide reach in front
  { id: 'marinSplash', name: 'Splash', kind: 'attack', cost: -15, damage: 20, pattern: ['000', '111', '000'] },
  { id: 'marinUndertow', name: 'Undertow', kind: 'attack', cost: -25, damage: 25, pattern: ['101', '010', '101'] },
  { id: 'marinWall', name: 'Tide Wall', kind: 'attack', cost: -30, damage: 35, pattern: ['001', '001', '001'] },
  { id: 'marinFlood', name: 'Flood', kind: 'attack', cost: -50, damage: 40, pattern: ['111', '111', '000'] },

  // Zephyr: cheap, broad and slippery
  { id: 'zephyrGust', name: 'Gust', kind: 'attack', cost: -20, damage: 20, pattern: ['010', '111', '010'] },
  { id: 'zephyrShear', name: 'Shear', kind: 'attack', cost: -25, damage: 30, pattern: ['101', '000', '101'] },
  { id: 'zephyrSpiral', name: 'Spiral', kind: 'attack', cost: -20, damage: 15, pattern: ['111', '111', '111'] },
  { id: 'zephyrEdge', name: 'Sky Edge', kind: 'attack', cost: -50, damage: 45, pattern: ['001', '011', '001'] },

  // Basalt: narrow but heavy
  { id: 'basaltToss', name: 'Stone Toss', kind: 'attack', cost: -15, damage: 30, pattern: ['000', '001', '000'] },
  { id: 'basaltQuake', name: 'Tremor', kind: 'attack', cost: -30, damage: 25, pattern: ['000', '111', '111'] },
  { id: 'basaltSlide', name: 'Rockfall', kind: 'attack', cost: -35, damage: 35, pattern: ['111', '010', '000'] },
  { id: 'basaltCrush', name: 'Crush', kind: 'attack', cost: -60, damage: 60, pattern: ['000', '010', '000'] },

  // Volta: fast and efficient
  { id: 'voltaZap', name: 'Zap', kind: 'attack', cost: -10, damage: 20, pattern: ['000', '011', '000'] },
  { id: 'voltaArc', name: 'Arc', kind: 'attack', cost: -25, damage: 25, pattern: ['101', '010', '101'] },
  { id: 'voltaField', name: 'Static Field', kind: 'attack', cost: -25, damage: 15, pattern: ['111', '111', '111'] },
  { id: 'voltaClap', name: 'Thunderclap', kind: 'attack', cost: -55, damage: 40, pattern: ['010', '111', '010'] },

  // Umbra: tricky flanking shapes
  { id: 'umbraClaw', name: 'Night Claw', kind: 'attack', cost: -20, damage: 25, pattern: ['001', '010', '001'] },
  { id: 'umbraEclipse', name: 'Eclipse', kind: 'attack', cost: -45, damage: 45, pattern: ['000', '101', '000'] },
  { id: 'umbraCreep', name: 'Creeping Dark', kind: 'attack', cost: -20, damage: 20, pattern: ['000', '111', '111'] },
  { id: 'umbraGrasp', name: 'Void Grasp', kind: 'attack', cost: -40, damage: 35, pattern: ['011', '010', '011'] },
];

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  [...basics, ...bonus, ...signature].map((c) => [c.id, c]),
);

export const BASIC_CARD_IDS = basics.map((c) => c.id);
export const BONUS_CARD_IDS = bonus.map((c) => c.id);

export const FIGHTERS: FighterDef[] = [
  {
    id: 'cinder',
    name: 'Cinder',
    title: 'Spark of the Forge',
    blurb: 'Hits hard and burns through energy fast.',
    color: '#ff6b3d',
    emblem: 'flame',
    signature: ['cinderJab', 'cinderRing', 'cinderPillar', 'cinderBlaze'],
  },
  {
    id: 'marin',
    name: 'Marin',
    title: 'Keeper of Tides',
    blurb: 'Controls the space in front with long waves.',
    color: '#3da5ff',
    emblem: 'wave',
    signature: ['marinSplash', 'marinUndertow', 'marinWall', 'marinFlood'],
  },
  {
    id: 'zephyr',
    name: 'Zephyr',
    title: 'Wanderer of the Sky',
    blurb: 'Cheap, wide attacks that are hard to dodge.',
    color: '#5fe3b0',
    emblem: 'swirl',
    signature: ['zephyrGust', 'zephyrShear', 'zephyrSpiral', 'zephyrEdge'],
  },
  {
    id: 'basalt',
    name: 'Basalt',
    title: 'The Unmoved',
    blurb: 'Narrow strikes, crushing damage.',
    color: '#c9a36b',
    emblem: 'hex',
    signature: ['basaltToss', 'basaltQuake', 'basaltSlide', 'basaltCrush'],
  },
  {
    id: 'volta',
    name: 'Volta',
    title: 'Storm Runner',
    blurb: 'Efficient shocks that keep energy flowing.',
    color: '#ffd23d',
    emblem: 'bolt',
    signature: ['voltaZap', 'voltaArc', 'voltaField', 'voltaClap'],
  },
  {
    id: 'umbra',
    name: 'Umbra',
    title: 'Shadow at Dusk',
    blurb: 'Flanking shapes that punish predictable steps.',
    color: '#b07cff',
    emblem: 'moon',
    signature: ['umbraClaw', 'umbraEclipse', 'umbraCreep', 'umbraGrasp'],
  },
];

export function getFighter(id: string): FighterDef {
  const f = FIGHTERS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fighter: ${id}`);
  return f;
}

export function getCard(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card: ${id}`);
  return c;
}
