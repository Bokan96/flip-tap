import { it } from 'vitest';
import { BONUS_CARD_IDS, FIGHTERS } from '../src/content/cards';
import type { Variant } from '../src/content/variants';
import { PROFILES, SIM_PROFILE, type AiProfile } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { Rng } from '../src/engine/rng';

/*
 * CPU vs CPU duel: profile A against profile B with every pair of fighters, both seats.
 *   A=expert B=hard   difficulty names (or "sim"; "hard-flat" = Hard with the old scoring)
 *   MATCHES=n         matches per ordered pair (default 1)
 *   BONUS=n           random bonus cards per side (default 0)
 *   SEED=n, ARENA=id, VARIANT=twoTap
 * Prints A's score (wins + half of draws) and the average time per decision.
 */
const named = (spec: string): AiProfile => {
  const [n, over] = spec.split(':');
  const base = baseNamed(n);
  if (!over) return base;
  const p: AiProfile = { ...base, solve: base.solve ? { ...base.solve } : undefined, weights: { ...base.weights } };
  for (const kv of over.split(',')) {
    const [k, v] = kv.split('=');
    const num = Number(v);
    if (p.solve && k in p.solve) (p.solve as Record<string, number>)[k] = num;
    else if (k in p.weights) (p.weights as unknown as Record<string, number>)[k] = num;
    else (p as unknown as Record<string, number>)[k] = num;
  }
  return p;
};
const baseNamed = (n: string): AiProfile => {
  if (n === 'sim') return SIM_PROFILE;
  if (n === 'hard-flat') return { ...PROFILES.hard, weights: { energy: 0.2, energyHigh: 0.2, energySoft: 100, ammo: 0, trap: 0, danger: 0, hex: 0 } };
  if (n === 'expert-blind') return { ...PROFILES.expert, readPlayer: 0 };
  return PROFILES[n as keyof typeof PROFILES];
};

it('ai duel', () => {
  const A = process.env.A ?? 'expert';
  const B = process.env.B ?? 'hard';
  const MATCHES = Number(process.env.MATCHES ?? 1);
  const BONUS = Number(process.env.BONUS ?? 0);
  const rng = new Rng(Number(process.env.SEED ?? 1));
  const ids = FIGHTERS.map((f) => f.id);
  let score = 0, games = 0, draws = 0, rounds = 0;
  const started = Date.now();
  const per: Record<string, number> = {};
  for (const a of ids) for (const b of ids) {
    if (a === b && process.env.MIRROR !== '1') continue;
    for (let k = 0; k < MATCHES; k++) {
      // A sits in seat 0 against fighter b with fighter a, then the seats flip.
      for (const flip of [false, true]) {
        const bonus = () => (BONUS ? rng.shuffle([...BONUS_CARD_IDS]).slice(0, BONUS) : []);
        const seats = flip ? [{ fighterId: b, bonusCards: bonus() }, { fighterId: a, bonusCards: bonus() }] : [{ fighterId: a, bonusCards: bonus() }, { fighterId: b, bonusCards: bonus() }];
        const profiles: [AiProfile, AiProfile] = flip ? [named(B), named(A)] : [named(A), named(B)];
        const rec = runMatch(seats[0], seats[1], {
          profiles,
          seed: rng.int(2 ** 31),
          arenaId: process.env.ARENA,
          variant: (process.env.VARIANT || undefined) as Variant | undefined,
        });
        const aSeat = flip ? 1 : 0;
        const s = rec.outcome.winner === null ? 0.5 : rec.outcome.winner === aSeat ? 1 : 0;
        if (rec.outcome.winner === null) draws++;
        score += s;
        games++;
        rounds += rec.rounds;
        per[a] = (per[a] ?? 0) + s;
      }
    }
  }
  const secs = (Date.now() - started) / 1000;
  console.log(`${A} vs ${B}: ${A} scores ${(100 * score / games).toFixed(1)}% over ${games} games (${draws} draws), ${(rounds / games).toFixed(1)} rounds avg, ${(1000 * secs / (rounds * 2)).toFixed(0)} ms/decision avg, ${secs.toFixed(0)} s`);
  console.log('by fighter (as A):', Object.entries(per).map(([f, s]) => `${f} ${(100 * s / (games / ids.length)).toFixed(0)}%`).join(' '));
});
