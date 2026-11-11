import type { MatchModifier } from '../engine/setup';

/** Rule twists for the daily challenge (content: edit freely). Applied to both fighters. */
export interface DailyModifier {
  id: string;
  name: string;
  text: string;
  modifier: MatchModifier;
}

export const MODIFIERS: DailyModifier[] = [
  { id: 'glass', name: 'Glass Cannon', text: 'All attacks deal 10 more damage.', modifier: { mods: { damageBonus: 10 } } },
  { id: 'lowBattery', name: 'Low Batteries', text: 'Both fighters start with 50 energy.', modifier: { startEnergy: 50 } },
  { id: 'fastCharge', name: 'Fast Charge', text: 'Both fighters regain 10 extra energy every round.', modifier: { mods: { energyPerRound: 10 } } },
  { id: 'ironSkin', name: 'Iron Skin', text: 'All damage is reduced by 5.', modifier: { mods: { damageReduction: 5 } } },
  { id: 'suddenDeath', name: 'Sudden Death', text: 'Both fighters start with 50 life.', modifier: { startLife: 50 } },
];
