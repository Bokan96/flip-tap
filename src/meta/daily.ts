import { ARENAS } from '../content/arenas';
import { FIGHTERS } from '../content/cards';
import { MODIFIERS, type DailyModifier } from '../content/modifiers';
import { Rng } from '../engine/rng';
import { dateKey } from './profile';

export interface DailyChallenge {
  date: string;
  fighter: string;
  rival: string;
  modifier: DailyModifier;
  arena: string;
}

/** FNV-1a: turns the date into a seed, so everyone gets the same challenge on the same day. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailyChallenge(date = dateKey()): DailyChallenge {
  const rng = new Rng(hash(`daily:${date}`));
  const fighter = rng.pick(FIGHTERS).id;
  const rival = rng.pick(FIGHTERS.filter((f) => f.id !== fighter)).id;
  const modifier = rng.pick(MODIFIERS);
  return { date, fighter, rival, modifier, arena: rng.pick(ARENAS).id };
}
