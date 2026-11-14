import { describe, expect, it } from 'vitest';
import { ARENAS, arenaState, getArena } from '../src/content/arenas';
import { BALANCE } from '../src/content/balance';
import { FIGHTERS } from '../src/content/cards';
import { choosePlan } from '../src/engine/ai';
import { runMatch } from '../src/engine/match';
import { SIM_PROFILE } from '../src/engine/ai';
import { Rng } from '../src/engine/rng';
import { isOpen, planError, resolveRound } from '../src/engine/rules';
import { createMatch } from '../src/engine/setup';
import type { MatchState, Plan, Pos } from '../src/engine/types';

const IDLE: Plan = ['guard', 'focus', 'up'];

function duel(arena: string, a: string, b: string, posA: Pos, posB: Pos): MatchState {
  const s = createMatch({ fighterId: a }, { fighterId: b }, {}, arena);
  s.players[0].pos = posA;
  s.players[1].pos = posB;
  s.players[0].facing = posB.c >= posA.c ? 1 : -1;
  s.players[1].facing = posA.c > posB.c ? 1 : -1;
  return s;
}

describe('arena content', () => {
  it('every arena is fair: point-symmetric, open start squares, Player 1 on the left', () => {
    for (const def of ARENAS) {
      const a = arenaState(def.id);
      const mirror = (i: number) => a.rows * a.cols - 1 - i;
      expect(a.blocked.map(mirror).sort()).toEqual([...a.blocked].sort());
      for (const [i, kind] of Object.entries(a.tiles)) expect(a.tiles[mirror(Number(i))]).toBe(kind);
      const [[r0, c0], [r1, c1]] = def.start;
      expect([a.rows - 1 - r0, a.cols - 1 - c0]).toEqual([r1, c1]);
      expect(isOpen(a, r0, c0) && isOpen(a, r1, c1)).toBe(true);
      expect(c0).toBeLessThan(c1);
    }
  });
});

describe('arena preview', () => {
  it('draws every square, with pillars, hazards and both start squares marked', async () => {
    const { arenaMiniHtml } = await import('../src/ui/arenaPreview');
    for (const def of ARENAS) {
      const html = arenaMiniHtml(def);
      expect(html.match(/<i /g)).toHaveLength(def.rows * def.cols);
      expect(html.match(/class="blocked"/g)?.length ?? 0).toBe(def.blocked?.length ?? 0);
      expect(html.match(/class="tile-/g)?.length ?? 0).toBe(def.tiles?.length ?? 0);
      expect(html).toContain('class="start p0"');
      expect(html).toContain('class="start p1"');
    }
    expect(getArena('classic').cols).toBe(5);
    expect(getArena('quarters').cols).toBe(4);
  });
});

describe('arena rules', () => {
  it('a move onto a pillar does nothing', () => {
    // Pillars: blocked squares at (0,1) and (2,3).
    const s = duel('pillars', 'cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 4 });
    const r = resolveRound(s, [['up', 'guard', 'focus'], IDLE]);
    expect(r.steps[0].players[0].to).toEqual({ r: 1, c: 1 });
  });

  it('a push stops in front of a pillar', () => {
    const s = duel('pillars', 'zephyr', 'cinder', { r: 2, c: 1 }, { r: 2, c: 2 });
    const r = resolveRound(s, [['zephyrGust', 'guard', 'focus'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[1].hit).toBe('guard');
    expect(r.steps[0].players[1].final).toEqual({ r: 2, c: 2 });
  });

  it('attacks do not cover pillars', () => {
    const s = duel('pillars', 'zephyr', 'cinder', { r: 1, c: 2 }, { r: 1, c: 4 });
    const r = resolveRound(s, [['zephyrSpiral', 'guard', 'focus'], IDLE]);
    const area = r.steps[0].players[0].area.map((p) => `${p.r},${p.c}`);
    expect(area).toHaveLength(7);
    expect(area).not.toContain('0,1');
    expect(area).not.toContain('2,3');
  });

  it('thorns hurt and springs restore energy at the end of each step', () => {
    // Thorn Garden: thorns at (1,1), (1,2) and (1,3).
    let s = duel('thorns', 'cinder', 'marin', { r: 1, c: 0 }, { r: 1, c: 4 });
    let r = resolveRound(s, [['right', 'guard', 'up'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[0].tile).toBe('spikes');
    expect(r.steps[1].players[0].life).toBe(100 - 2 * BALANCE.tiles.spikes);
    expect(r.steps[2].players[0].tile).toBeNull();
    // Hot Springs: springs at (0,2) and (2,2).
    s = duel('springs', 'cinder', 'marin', { r: 0, c: 1 }, { r: 1, c: 4 });
    s.players[0].energy = 50;
    r = resolveRound(s, [['right', 'guard', 'down'], ['guard', 'focus', 'up']]);
    expect(r.steps[0].players[0].tile).toBe('well');
    expect(r.steps[1].players[0].energy).toBe(50 + 2 * BALANCE.tiles.well);
  });
});

describe('fatigue', () => {
  const far = () => duel('classic', 'cinder', 'marin', { r: 1, c: 0 }, { r: 1, c: 3 });

  it('starts after round 10', () => {
    const s = far();
    s.round = BALANCE.fatigueAfterRound;
    expect(resolveRound(s, [IDLE, IDLE]).fatigue).toBe(0);
    s.round = BALANCE.fatigueAfterRound + 1;
    const r = resolveRound(s, [IDLE, IDLE]);
    expect(r.fatigue).toBe(BALANCE.fatigueDamage);
    expect(r.state.players.map((p) => p.life)).toEqual([100 - BALANCE.fatigueDamage, 100 - BALANCE.fatigueDamage]);
  });

  it('can knock out, and a double knockout is a draw', () => {
    const s = far();
    s.round = 12;
    s.players[1].life = BALANCE.fatigueDamage;
    expect(resolveRound(s, [IDLE, IDLE]).state.outcome).toEqual({ winner: 0 });
    s.players[0].life = BALANCE.fatigueDamage;
    expect(resolveRound(s, [IDLE, IDLE]).state.outcome).toEqual({ winner: null, draw: true });
  });

  it('does not apply after a knockout during the round', () => {
    const s = duel('classic', 'cinder', 'marin', { r: 1, c: 1 }, { r: 1, c: 2 });
    s.round = 15;
    s.players[1].life = 10;
    const r = resolveRound(s, [['cinderRing', 'guard', 'focus'], ['focus', 'guard', 'up']]);
    expect(r.fatigue).toBe(0);
    expect(r.state.players[0].life).toBe(100 - 5); // only Fire Ring's recoil
  });
});

describe('every arena plays', () => {
  it('the AI plans legally and matches finish on every arena', () => {
    const rng = new Rng(5);
    for (const def of ARENAS) {
      const s = createMatch({ fighterId: rng.pick(FIGHTERS).id }, { fighterId: rng.pick(FIGHTERS).id }, {}, def.id);
      expect(planError(s.players[1], choosePlan(s, 1, 'normal', rng))).toBeNull();
      const rec = runMatch({ fighterId: 'ferro' }, { fighterId: 'basalt' }, { profiles: [SIM_PROFILE, SIM_PROFILE], seed: 3, arenaId: def.id });
      expect(rec.rounds).toBeGreaterThan(0);
      expect(getArena(rec.final.arena.id).name).toBe(def.name);
    }
  }, 60_000);
});
