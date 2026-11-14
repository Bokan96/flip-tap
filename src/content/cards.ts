import type { CardDef, FighterDef } from '../engine/types';

/*
 * All game content lives here. To reskin the game, edit names/text/colours here,
 * strings in strings.ts and art/sound overrides in assets.ts. No engine changes needed.
 *
 * Patterns are 3 rows x 3 columns written facing RIGHT:
 *   column 0 = behind, column 1 = the user's column, column 2 = in front.
 * Rows may also be 5 characters wide (reach 2): the middle character is then the user's column.
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
  { id: 'tripwire', name: 'Tripwire', kind: 'trap', cost: -10, trap: 15, pattern: ['000', '001', '000'], bonus: true },
  { id: 'caltrops', name: 'Caltrops', kind: 'trap', cost: -15, trap: 10, pattern: ['010', '000', '010'], bonus: true },
  // Was Ignite (a burn); the id stays so saved collections keep the card.
  { id: 'ignite', name: 'Evil Eye', kind: 'attack', cost: -15, damage: 10, pattern: ['000', '011', '000'], hex: true, bonus: true, fx: 'beam' },
  { id: 'phaseStep', name: 'Phase Step', kind: 'move', cost: -15, swap: true, bonus: true },
];

const signature: CardDef[] = [
  // Cinder: big hits that burn himself too, and a heal once he is low
  { id: 'cinderJab', name: 'Ember Jab', kind: 'attack', cost: -15, damage: 25, pattern: ['000', '011', '000'], fx: 'slash' },
  { id: 'cinderRing', name: 'Fire Ring', kind: 'attack', cost: -20, damage: 20, pattern: ['111', '101', '111'], push: 1, recoil: 5 },
  { id: 'cinderPillar', name: 'Flame Pillar', kind: 'attack', cost: -20, damage: 30, pattern: ['010', '010', '010'], stun: true },
  { id: 'cinderBlaze', name: 'Wildfire', kind: 'attack', cost: -45, damage: 45, pattern: ['011', '011', '011'], recoil: 10, fx: 'burst' },
  { id: 'cinderRekindle', name: 'Rekindle', kind: 'heal', cost: -25, heal: 20, healAtOrBelow: 50 },

  // Marin: cheap pulls and shoves that put rivals where he wants them
  { id: 'marinSplash', name: 'Splash', kind: 'attack', cost: -15, damage: 25, pattern: ['000', '111', '000'] },
  { id: 'marinLure', name: 'Tidal Lure', kind: 'attack', cost: -5, damage: 5, pattern: ['00001', '00001', '00001'], push: -1, fx: 'wave' },
  { id: 'marinGeyser', name: 'Geyser', kind: 'attack', cost: -10, damage: 15, pattern: ['010', '010', '010'], push: 1, fx: 'wave' },
  { id: 'marinFlood', name: 'Flood', kind: 'attack', cost: -45, damage: 40, pattern: ['111', '111', '000'], fx: 'wave' },

  // Zephyr: costly dashes that punish an attack he steps into
  { id: 'zephyrGust', name: 'Gust', kind: 'attack', cost: -20, damage: 20, pattern: ['010', '111', '010'], push: 1, fx: 'wave' },
  { id: 'zephyrSpiral', name: 'Spiral', kind: 'attack', cost: -20, damage: 15, pattern: ['111', '111', '111'] },
  { id: 'zephyrEdge', name: 'Sky Edge', kind: 'attack', cost: -50, damage: 45, pattern: ['001', '011', '001'], fx: 'slash' },
  { id: 'zephyrDash', name: 'Gale Dash', kind: 'move', cost: -15, step: [0, 1], forward: true, counter: 20 },
  { id: 'zephyrLunge', name: 'Sky Lunge', kind: 'move', cost: -20, step: [0, 2], forward: true, counter: 30 },

  // Basalt: cheap, crushing blows while he stands his ground
  { id: 'basaltToss', name: 'Stone Toss', kind: 'attack', cost: -15, damage: 30, pattern: ['000', '001', '000'], fx: 'burst' },
  { id: 'basaltQuake', name: 'Tremor', kind: 'attack', cost: -25, damage: 30, pattern: ['000', '111', '111'], stun: true, planted: true },
  { id: 'basaltSpikes', name: 'Spiked Wall', kind: 'guard', cost: -15, guard: 20, counter: 20 },
  { id: 'basaltCrush', name: 'Crush', kind: 'attack', cost: -30, damage: 45, pattern: ['000', '011', '000'], planted: true, fx: 'quake' },

  // Volta: wide, weak shocks that drain the rival's energy
  { id: 'voltaZap', name: 'Zap', kind: 'attack', cost: -10, damage: 25, pattern: ['000', '011', '000'], fx: 'beam' },
  { id: 'voltaField', name: 'Static Field', kind: 'attack', cost: -10, damage: 5, pattern: ['111', '111', '111'], sap: 20 },
  { id: 'voltaCircuit', name: 'Short Circuit', kind: 'attack', cost: -10, damage: 10, pattern: ['011', '011', '011'], sap: 25, fx: 'beam' },
  { id: 'voltaClap', name: 'Thunderclap', kind: 'attack', cost: -50, damage: 40, pattern: ['010', '111', '010'], stun: true, fx: 'burst' },

  // Ferro: heavy, cheap shots; each fires once until Reload
  { id: 'ferroSnap', name: 'Snap Shot', kind: 'attack', cost: -10, damage: 25, pattern: ['000', '011', '000'], fx: 'beam' },
  { id: 'ferroScatter', name: 'Scattershot', kind: 'attack', cost: -25, damage: 25, pattern: ['001', '011', '001'], fx: 'burst' },
  { id: 'ferroSlug', name: 'Slug', kind: 'attack', cost: -25, damage: 40, pattern: ['000', '001', '000'], push: 1, fx: 'beam' },
  { id: 'ferroCannon', name: 'Hand Cannon', kind: 'attack', cost: -45, damage: 45, pattern: ['011', '011', '011'], fx: 'burst' },
  { id: 'ferroReload', name: 'Reload', kind: 'reload', cost: 0 },

  // Briar: sets traps (which attacks can break), then pulls rivals onto them
  { id: 'briarSnare', name: 'Snare', kind: 'trap', cost: -5, trap: 25, pattern: ['000', '001', '000'] },
  { id: 'briarField', name: 'Thorn Ring', kind: 'trap', cost: -10, trap: 15, pattern: ['010', '101', '010'] },
  { id: 'briarLash', name: 'Lash', kind: 'attack', cost: -15, damage: 20, pattern: ['001', '001', '001'], push: -1, fx: 'slash' },
  { id: 'briarBloom', name: 'Bloom', kind: 'attack', cost: -40, damage: 35, pattern: ['111', '101', '111'], fx: 'burst' },

  // Vex: hexes a rival, then cashes the hex in; trades places
  { id: 'vexHex', name: 'Hex Bolt', kind: 'attack', cost: -10, damage: 20, pattern: ['000', '011', '000'], hex: true, fx: 'beam' },
  { id: 'vexSwap', name: 'Mirror Step', kind: 'move', cost: -5, swap: true },
  { id: 'vexCurse', name: 'Malediction', kind: 'attack', cost: -15, damage: 15, pattern: ['010', '111', '010'], hex: true, fx: 'burst' },
  { id: 'vexFlare', name: 'Flare', kind: 'attack', cost: -45, damage: 40, pattern: ['001', '011', '001'], fx: 'wave' },

  // Umbra: flanking shapes that hit hardest when the rival moves
  { id: 'umbraClaw', name: 'Night Claw', kind: 'attack', cost: -20, damage: 25, pattern: ['001', '010', '001'], drain: 25 },
  { id: 'umbraPounce', name: 'Pounce', kind: 'attack', cost: -15, damage: 10, pattern: ['011', '011', '011'], vsMoved: 5, fx: 'slash' },
  { id: 'umbraNightfall', name: 'Nightfall', kind: 'attack', cost: -35, damage: 20, pattern: ['111', '101', '111'], vsMoved: 25, fx: 'burst' },
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
    blurb: 'Burns himself to hit harder, then rekindles once he is low.',
    color: '#ff6b3d',
    emblem: 'flame',
    signature: ['cinderJab', 'cinderRing', 'cinderPillar', 'cinderBlaze', 'cinderRekindle'],
    role: 'Burst',
    complexity: 2,
    ai: { aggression: 0.25 },
    passive: { name: 'Kindle', text: 'Attacks deal 10 more damage while at 50 life or less.', mods: { lowLifeThreshold: 50, lowLifeBonus: 10 } },
  },
  {
    id: 'marin',
    name: 'Marin',
    title: 'Keeper of Tides',
    blurb: 'Cheap tides that drag and shove rivals where he wants them.',
    color: '#3da5ff',
    emblem: 'wave',
    signature: ['marinSplash', 'marinLure', 'marinGeyser', 'marinFlood'],
    role: 'Control',
    complexity: 2,
    ai: { caution: 0.05 },
    passive: { name: 'Riptide', text: 'Pushes and pulls move the target 1 extra square.', mods: { pushBonus: 1 } },
  },
  {
    id: 'zephyr',
    name: 'Zephyr',
    title: 'Wanderer of the Sky',
    blurb: 'Dashes into enemy attacks and strikes back.',
    color: '#5fe3b0',
    emblem: 'swirl',
    signature: ['zephyrGust', 'zephyrSpiral', 'zephyrEdge', 'zephyrDash', 'zephyrLunge'],
    role: 'Duelist',
    complexity: 3,
    ai: { aggression: -0.1, caution: 0.1 },
    passive: { name: 'Slipstream', text: 'Takes 10 less damage on steps where it moved.', mods: { movedReduction: 10 } },
  },
  {
    id: 'basalt',
    name: 'Basalt',
    title: 'The Unmoved',
    blurb: 'Plants his feet for cheap, crushing blows.',
    color: '#c9a36b',
    emblem: 'hex',
    signature: ['basaltToss', 'basaltQuake', 'basaltSpikes', 'basaltCrush'],
    role: 'Tank',
    complexity: 1,
    ai: { aggression: -0.15, caution: 0.05 },
    passive: { name: 'Bedrock', text: 'Can’t be pushed or pulled.', mods: { immovable: true } },
  },
  {
    id: 'volta',
    name: 'Volta',
    title: 'Storm Runner',
    blurb: 'Wide, weak shocks that drain the rival’s energy.',
    color: '#ffd23d',
    emblem: 'bolt',
    signature: ['voltaZap', 'voltaField', 'voltaCircuit', 'voltaClap'],
    role: 'Disruptor',
    complexity: 2,
    ai: { aggression: 0.1 },
    passive: { name: 'Capacitor', text: 'Regains 10 extra energy every round.', mods: { energyPerRound: 10 } },
  },
  {
    id: 'umbra',
    name: 'Umbra',
    title: 'Shadow at Dusk',
    blurb: 'Strikes hardest at rivals who try to step away.',
    color: '#b07cff',
    emblem: 'moon',
    signature: ['umbraClaw', 'umbraPounce', 'umbraNightfall', 'umbraGrasp'],
    role: 'Ambusher',
    complexity: 2,
    ai: { aggression: 0.15 },
    passive: { name: 'Ambush', text: 'Attacks deal 5 more damage to a target that moved this step.', mods: { vsMovedBonus: 5 } },
  },
  {
    id: 'ferro',
    name: 'Ferro',
    title: 'The Iron Gunner',
    blurb: 'Big, cheap shots, then a pause to reload.',
    color: '#9fb6cc',
    emblem: 'crosshair',
    signature: ['ferroSnap', 'ferroScatter', 'ferroSlug', 'ferroCannon', 'ferroReload'],
    role: 'Gunner',
    complexity: 3,
    ai: { aggression: 0.1 },
    passive: { name: 'Magazine', text: 'Each attack fires once, then needs a Reload.', mods: { ammo: true } },
  },
  {
    id: 'briar',
    name: 'Briar',
    title: 'Warden of Thorns',
    blurb: 'Lays cheap traps, then drags rivals onto them. Attacks break traps.',
    color: '#9fe04a',
    emblem: 'thorn',
    signature: ['briarSnare', 'briarField', 'briarLash', 'briarBloom'],
    role: 'Trapper',
    complexity: 3,
    ai: { caution: 0.1 },
    passive: { name: 'Deep Roots', text: 'Your traps deal 10 more damage.', mods: { trapBonus: 10 } },
  },
  {
    id: 'vex',
    name: 'Vex',
    title: 'The Smiling Hex',
    blurb: 'Hexes a rival, then cashes it in. Trades places at will.',
    color: '#ff5fb4',
    emblem: 'mask',
    signature: ['vexHex', 'vexSwap', 'vexCurse', 'vexFlare'],
    role: 'Trickster',
    complexity: 3,
    ai: { aggression: 0.15 },
    passive: { name: 'Malice', text: 'Breaking a hex deals 10 more damage (20 in all).', mods: { hexBonus: 10 } },
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
