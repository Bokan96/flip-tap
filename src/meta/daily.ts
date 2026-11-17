import { ARENAS } from '../content/arenas';
import { FIGHTERS } from '../content/cards';
import { MODIFIERS, type DailyModifier } from '../content/modifiers';
import { MATCHUP_TABLES, type MatchupTable } from '../content/matchups';
import { hashString, Rng } from '../engine/rng';
import { dateKey } from './profile';

export interface DailyChallenge {
  date: string;
  fighter: string;
  rival: string;
  modifier: DailyModifier;
  arena: string;
}

/**
 * The fighter pairings the daily challenge may use on `date`: ordered (you, rival) pairs whose
 * simulated score sits inside the newest matchup table's band, so no day is a walkover or a wall.
 * Empty before the first table's date (those days keep the draw they always had).
 */
export function fairPairs(date: string, tables: readonly MatchupTable[] = MATCHUP_TABLES): [string, string][] {
  const table = [...tables].sort((x, y) => x.from.localeCompare(y.from)).filter((t) => t.from <= date).pop();
  if (!table) return [];
  const ids = FIGHTERS.map((f) => f.id);
  const [lo, hi] = table.band;
  return ids.flatMap((a) => ids.filter((b) => b !== a && (table.scores[a]?.[b] ?? -1) >= lo && table.scores[a]![b] <= hi).map((b) => [a, b] as [string, string]));
}

/** The challenge for a date: the same for everyone, drawn from a seed made from the date. */
export function dailyChallenge(date = dateKey(), tables: readonly MatchupTable[] = MATCHUP_TABLES): DailyChallenge {
  const rng = new Rng(hashString(`daily:${date}`));
  const fair = fairPairs(date, tables);
  let fighter: string;
  let rival: string;
  if (fair.length) [fighter, rival] = rng.pick(fair);
  else {
    // The original draw (kept exactly, so days before the first matchup table don't change).
    fighter = rng.pick(FIGHTERS).id;
    rival = rng.pick(FIGHTERS.filter((f) => f.id !== fighter)).id;
  }
  const modifier = rng.pick(MODIFIERS);
  return { date, fighter, rival, modifier, arena: rng.pick(ARENAS).id };
}
