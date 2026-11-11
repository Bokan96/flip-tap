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
  { id: 'guard', name: 'Guard', kind: 'guard', cost: 0, guard: 15 },
  { id: 'focus', name: 'Focus', kind: 'focus', cost: 15 },
];

const bonus: CardDef[] = [
  { id: 'bulwark', name: 'Bulwark', kind: 'guard', cost: -20, guard: 100, bonus: true },
  { id: 'renew', name: 'Renew', kind: 'heal', cost: -55, heal: 35, bonus: true },
  { id: 'leapLeft', name: 'Leap Left', kind: 'move', cost: -5, step: [0, -2], bonus: true },
  { id: 'leapRight', name: 'Leap Right', kind: 'move', cost: -5, step: [0, 2], bonus: true },
  { id: 'overload', name: 'Overload', kind: 'attack', cost: -75, damage: 75, pattern: ['000', '010', '000'], bonus: true, text: 'Only hits a foe on your square.' },
  { id: 'stormCall', name: 'Storm Call', kind: 'attack', cost: -20, damage: 15, pattern: ['111', '111', '111'], bonus: true },
  { id: 'surge', name: 'Surge', kind: 'focus', cost: 35, bonus: true },
  { id: 'riposte', name: 'Riposte', kind: 'guard', cost: -10, guard: 10, counter: 20, bonus: true },
  { id: 'leech', name: 'Leech', kind: 'attack', cost: -30, damage: 20, pattern: ['000', '011', '000'], drain: 100, bonus: true },
  { id: 'shockwave', name: 'Shockwave', kind: 'attack', cost: -30, damage: 15, pattern: ['001', '011', '001'], push: 1, bonus: true, fx: 'wave' },
  { id: 'hook', name: 'Hook', kind: 'attack', cost: -20, damage: 10, pattern: ['001', '001', '001'], push: -1, bonus: true },
  { id: 'daze', name: 'Daze', kind: 'attack', cost: -20, damage: 10, pattern: ['000', '011', '000'], stun: true, bonus: true },
];

const signature: CardDef[] = [
  // Cinder: high damage, hungry for energy
  { id: 'cinderJab', name: 'Ember Jab', kind: 'attack', cost: -15, damage: 25, pattern: ['000', '011', '000'], fx: 'slash' },
  { id: 'cinderRing', name: 'Fire Ring', kind: 'attack', cost: -30, damage: 20, pattern: ['111', '101', '111'], push: 1 },
  { id: 'cinderPillar', name: 'Flame Pillar', kind: 'attack', cost: -25, damage: 30, pattern: ['010', '010', '010'], stun: true },
  { id: 'cinderBlaze', name: 'Wildfire', kind: 'attack', cost: -55, damage: 45, pattern: ['011', '011', '011'], fx: 'burst' },

  // Marin: wide reach in front
  { id: 'marinSplash', name: 'Splash', kind: 'attack', cost: -15, damage: 20, pattern: ['000', '111', '000'] },
  { id: 'marinUndertow', name: 'Undertow', kind: 'attack', cost: -25, damage: 25, pattern: ['101', '010', '101'], push: -1, fx: 'wave' },
  { id: 'marinWall', name: 'Tide Wall', kind: 'attack', cost: -30, damage: 30, pattern: ['001', '001', '001'], push: 1, fx: 'wave' },
  { id: 'marinFlood', name: 'Flood', kind: 'attack', cost: -45, damage: 40, pattern: ['111', '111', '000'], fx: 'wave' },

  // Zephyr: cheap, broad and slippery
  { id: 'zephyrGust', name: 'Gust', kind: 'attack', cost: -20, damage: 20, pattern: ['010', '111', '010'], push: 1, fx: 'wave' },
  { id: 'zephyrShear', name: 'Shear', kind: 'attack', cost: -25, damage: 30, pattern: ['101', '000', '101'] },
  { id: 'zephyrSpiral', name: 'Spiral', kind: 'attack', cost: -20, damage: 15, pattern: ['111', '111', '111'] },
  { id: 'zephyrEdge', name: 'Sky Edge', kind: 'attack', cost: -50, damage: 45, pattern: ['001', '011', '001'], fx: 'slash' },

  // Basalt: narrow but heavy, punishes attackers
  { id: 'basaltToss', name: 'Stone Toss', kind: 'attack', cost: -15, damage: 30, pattern: ['000', '001', '000'], fx: 'burst' },
  { id: 'basaltQuake', name: 'Tremor', kind: 'attack', cost: -30, damage: 25, pattern: ['000', '111', '111'], stun: true },
  { id: 'basaltSpikes', name: 'Spiked Wall', kind: 'guard', cost: -15, guard: 20, counter: 20 },
  { id: 'basaltCrush', name: 'Crush', kind: 'attack', cost: -60, damage: 60, pattern: ['000', '010', '000'], fx: 'quake' },

  // Volta: fast and efficient
  { id: 'voltaZap', name: 'Zap', kind: 'attack', cost: -10, damage: 20, pattern: ['000', '011', '000'], fx: 'beam' },
  { id: 'voltaArc', name: 'Arc', kind: 'attack', cost: -25, damage: 25, pattern: ['101', '010', '101'], fx: 'beam' },
  { id: 'voltaField', name: 'Static Field', kind: 'attack', cost: -25, damage: 20, pattern: ['111', '111', '111'] },
  { id: 'voltaClap', name: 'Thunderclap', kind: 'attack', cost: -55, damage: 40, pattern: ['010', '111', '010'], stun: true, fx: 'burst' },

  // Ferro: heavy, cheap shots; each fires once until Reload
  { id: 'ferroSnap', name: 'Snap Shot', kind: 'attack', cost: -10, damage: 30, pattern: ['000', '011', '000'], fx: 'beam' },
  { id: 'ferroScatter', name: 'Scattershot', kind: 'attack', cost: -20, damage: 25, pattern: ['001', '011', '001'], fx: 'burst' },
  { id: 'ferroSlug', name: 'Slug', kind: 'attack', cost: -25, damage: 40, pattern: ['000', '001', '000'], push: 1, fx: 'beam' },
  { id: 'ferroCannon', name: 'Hand Cannon', kind: 'attack', cost: -45, damage: 55, pattern: ['011', '011', '011'], fx: 'burst' },
  { id: 'ferroReload', name: 'Reload', kind: 'reload', cost: 0 },

  // Umbra: tricky flanking shapes
  { id: 'umbraClaw', name: 'Night Claw', kind: 'attack', cost: -20, damage: 25, pattern: ['001', '010', '001'], drain: 50 },
  { id: 'umbraEclipse', name: 'Eclipse', kind: 'attack', cost: -45, damage: 45, pattern: ['000', '101', '000'] },
  { id: 'umbraCreep', name: 'Creeping Dark', kind: 'attack', cost: -20, damage: 20, pattern: ['000', '111', '111'], fx: 'wave' },
  { id: 'umbraGrasp', name: 'Void Grasp', kind: 'attack', cost: -40, damage: 35, pattern: ['011', '010', '011'], push: -1 },
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
    passive: { name: 'Kindle', text: 'Attacks deal 10 more damage while at 50 life or less.', mods: { lowLifeThreshold: 50, lowLifeBonus: 10 } },
  },
  {
    id: 'marin',
    name: 'Marin',
    title: 'Keeper of Tides',
    blurb: 'Controls the space in front with long waves.',
    color: '#3da5ff',
    emblem: 'wave',
    signature: ['marinSplash', 'marinUndertow', 'marinWall', 'marinFlood'],
    passive: { name: 'Riptide', text: 'Pushes and pulls move the target 1 extra square.', mods: { pushBonus: 1 } },
  },
  {
    id: 'zephyr',
    name: 'Zephyr',
    title: 'Wanderer of the Sky',
    blurb: 'Cheap, wide attacks that are hard to dodge.',
    color: '#5fe3b0',
    emblem: 'swirl',
    signature: ['zephyrGust', 'zephyrShear', 'zephyrSpiral', 'zephyrEdge'],
    passive: { name: 'Slipstream', text: 'Takes 10 less damage on steps where it moved.', mods: { movedReduction: 10 } },
  },
  {
    id: 'basalt',
    name: 'Basalt',
    title: 'The Unmoved',
    blurb: 'Narrow strikes, crushing damage.',
    color: '#c9a36b',
    emblem: 'hex',
    signature: ['basaltToss', 'basaltQuake', 'basaltSpikes', 'basaltCrush'],
    passive: { name: 'Bedrock', text: '115 max life. Can’t be pushed or pulled.', mods: { immovable: true } },
    lifeMax: 115,
  },
  {
    id: 'volta',
    name: 'Volta',
    title: 'Storm Runner',
    blurb: 'Efficient shocks that keep energy flowing.',
    color: '#ffd23d',
    emblem: 'bolt',
    signature: ['voltaZap', 'voltaArc', 'voltaField', 'voltaClap'],
    passive: { name: 'Capacitor', text: '120 max energy. Regains 7 extra energy every round.', mods: { energyPerRound: 7 } },
    energyMax: 120,
  },
  {
    id: 'umbra',
    name: 'Umbra',
    title: 'Shadow at Dusk',
    blurb: 'Flanking shapes that punish predictable steps.',
    color: '#b07cff',
    emblem: 'moon',
    signature: ['umbraClaw', 'umbraEclipse', 'umbraCreep', 'umbraGrasp'],
    passive: { name: 'Ambush', text: 'Attacks deal 10 more damage to a target that moved this step.', mods: { vsMovedBonus: 10 } },
  },
  {
    id: 'ferro',
    name: 'Ferro',
    title: 'The Iron Gunner',
    blurb: 'Big, cheap shots, then a pause to reload.',
    color: '#9fb6cc',
    emblem: 'crosshair',
    signature: ['ferroSnap', 'ferroScatter', 'ferroSlug', 'ferroCannon', 'ferroReload'],
    passive: { name: 'Magazine', text: 'Each attack fires once, then needs a Reload.', mods: { ammo: true } },
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
