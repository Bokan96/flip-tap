import './styles.css';
import { isSoundEnabled, play, setSoundEnabled } from './audio/sfx';
import { FIGHTERS, getCard, getFighter } from './content/cards';
import { STRINGS } from './content/strings';
import type { Difficulty } from './engine/ai';
import { randomSeed } from './engine/rng';
import { createMatch } from './engine/setup';
import type { MatchOutcome, Seat } from './engine/types';
import { CpuPlanSource, type PlanSource } from './net/transport';
import { isChampion, loadProgress, recordWin, resetProgress, rivalBonus, rivalsFor, type TournamentProgress } from './tournament';
import { BattleView, HumanPlanSource } from './ui/battle';
import { cardHtml } from './ui/card';
import { emblemHtml } from './ui/emblems';

type Mode = 'cpu' | 'hotseat' | 'tournament';

const app = document.getElementById('app')!;
let difficulty: Difficulty = 'normal';

function screen(html: string, cls = ''): HTMLElement {
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  return app.firstElementChild as HTMLElement;
}

function on(root: HTMLElement, sel: string, fn: (el: HTMLElement) => void): void {
  root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
    el.addEventListener('click', () => {
      play('click');
      fn(el);
    }),
  );
}

// ---------- title ----------

function title(): void {
  const logoEmblems = FIGHTERS.map((f) => emblemHtml(f, 'logo-emblem')).join('');
  const root = screen(
    `<div class="title-wrap">
      <div class="logo-emblems">${logoEmblems}</div>
      <h1 class="logo">${STRINGS.gameTitle}</h1>
      <p class="tagline">${STRINGS.tagline}</p>
      <nav class="menu">
        <button class="btn primary big" data-mode="tournament">${STRINGS.modeTournament}<small>${STRINGS.modeTournamentHint}</small></button>
        <button class="btn big" data-mode="cpu">${STRINGS.modeCpu}<small>${STRINGS.modeCpuHint}</small></button>
        <button class="btn big" data-mode="hotseat">${STRINGS.modeHotseat}<small>${STRINGS.modeHotseatHint}</small></button>
      </nav>
      <div class="row">
        <button class="btn ghost-btn" data-act="howto">${STRINGS.howToPlay}</button>
        <button class="btn ghost-btn" data-act="sound">${isSoundEnabled() ? STRINGS.soundOn : STRINGS.soundOff}</button>
      </div>
    </div>`,
    'title',
  );
  on(root, '[data-mode]', (el) => pickFighters(el.dataset.mode as Mode));
  on(root, '[data-act="howto"]', howTo);
  on(root, '[data-act="sound"]', (el) => {
    setSoundEnabled(!isSoundEnabled());
    el.textContent = isSoundEnabled() ? STRINGS.soundOn : STRINGS.soundOff;
  });
}

function howTo(): void {
  const example = ['right', 'guard', 'focus', 'cinderJab', 'zephyrGust'].map((id) => cardHtml(id)).join('');
  const root = screen(
    `<h2>${STRINGS.howToPlay}</h2>
     <ol class="rules">${STRINGS.rules.map((r) => `<li>${r}</li>`).join('')}</ol>
     <div class="hand demo">${example}</div>
     <p class="note">The number in the corner is the card's energy cost. On attack cards, the grid shows which squares it hits (the centre square is you, facing your opponent).</p>
     <button class="btn" data-act="back">${STRINGS.back}</button>`,
    'howto',
  );
  on(root, '[data-act="back"]', title);
}

// ---------- fighter selection ----------

function fighterGrid(selected?: string, locked: string[] = []): string {
  return `<div class="fighters">${FIGHTERS.map(
    (f) => `<button class="fighter${f.id === selected ? ' selected' : ''}" data-fighter="${f.id}" style="--clr:${f.color}" ${locked.includes(f.id) ? 'disabled' : ''}>
      ${emblemHtml(f)}
      <b>${f.name}</b><i>${f.title}</i><span>${f.blurb}</span>
    </button>`,
  ).join('')}</div>`;
}

function difficultyPicker(): string {
  return `<div class="difficulty"><span>${STRINGS.difficulty}:</span>${(['easy', 'normal', 'hard'] as Difficulty[])
    .map((d) => `<button class="chip${d === difficulty ? ' on' : ''}" data-diff="${d}">${STRINGS.difficultyNames[d]}</button>`)
    .join('')}</div>`;
}

function bindDifficulty(root: HTMLElement): void {
  on(root, '[data-diff]', (el) => {
    difficulty = el.dataset.diff as Difficulty;
    root.querySelectorAll('[data-diff]').forEach((c) => c.classList.toggle('on', c === el));
  });
}

function pickFighters(mode: Mode): void {
  const picks: string[] = [];
  const step = () => {
    const who = mode === 'hotseat' ? STRINGS.player(picks.length + 1) : picks.length === 0 ? STRINGS.player(1) : STRINGS.cpu;
    const root = screen(
      `<h2>${STRINGS.pickFighter(who)}</h2>
       ${fighterGrid()}
       ${mode !== 'hotseat' && picks.length === 0 ? difficultyPicker() : ''}
       <button class="btn ghost-btn" data-act="back">${STRINGS.back}</button>`,
      'select',
    );
    bindDifficulty(root);
    on(root, '[data-act="back"]', title);
    on(root, '[data-fighter]', (el) => {
      picks.push(el.dataset.fighter!);
      if (mode === 'tournament') return tournamentHub(picks[0]);
      if (picks.length === 2) return startMatch(mode, picks[0], picks[1]);
      step();
    });
  };
  step();
}

// ---------- matches ----------

function seatsFor(mode: Mode, view: () => BattleView): [PlanSource, PlanSource] {
  const human = new HumanPlanSource(view);
  if (mode === 'hotseat') return [human, new HumanPlanSource(view)];
  return [human, new CpuPlanSource(difficulty, randomSeed())];
}

function runBattle(
  mode: Mode,
  p0: { fighterId: string; bonusCards?: string[] },
  p1: { fighterId: string; bonusCards?: string[] },
  onEnd: (outcome: MatchOutcome) => void,
  onQuit: () => void = title,
): void {
  let view: BattleView | null = null;
  const [s0, s1] = seatsFor(mode, () => view!);
  const names: [string, string] = [STRINGS.player(1), mode === 'hotseat' ? STRINGS.player(2) : STRINGS.cpu];
  const container = screen('', 'battle-screen');
  view = new BattleView(
    container,
    createMatch(p0, p1),
    [
      { name: names[0], source: s0 },
      { name: names[1], source: s1 },
    ],
    (outcome) => onEnd(outcome),
    onQuit,
  );
}

function outcomeText(outcome: MatchOutcome, names: [string, string]): string {
  return outcome.winner === null ? STRINGS.draw : STRINGS.wins(names[outcome.winner]);
}

function startMatch(mode: Mode, a: string, b: string): void {
  runBattle(mode, { fighterId: a }, { fighterId: b }, (outcome) => {
    const names: [string, string] = [STRINGS.player(1), mode === 'hotseat' ? STRINGS.player(2) : STRINGS.cpu];
    if (outcome.winner === 0 || mode === 'hotseat') play('win');
    resultScreen(outcomeText(outcome, names), outcome.winner, [a, b], [
      { label: STRINGS.rematch, primary: true, fn: () => startMatch(mode, a, b) },
      { label: STRINGS.menu, fn: title },
    ]);
  });
}

function resultScreen(
  heading: string,
  winner: Seat | null,
  fighters: [string, string],
  buttons: { label: string; primary?: boolean; fn: () => void }[],
  extra = '',
): void {
  const fx = fighters
    .map((id, i) => `<div class="result-fighter${winner === i ? ' won' : winner === null ? '' : ' lost'}">${emblemHtml(getFighter(id))}</div>`)
    .join('<span class="vs">vs</span>');
  const root = screen(
    `<div class="result-row">${fx}</div>
     <h2>${heading}</h2>${extra}
     <div class="row">${buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`,
    'result',
  );
  on(root, '[data-i]', (el) => buttons[Number(el.dataset.i)].fn());
}

// ---------- tournament ----------

function tournamentHub(fighterId: string): void {
  const progress = loadProgress(fighterId);
  const rivals = rivalsFor(fighterId);
  const ladder = rivals
    .map((id, i) => {
      const f = getFighter(id);
      const state = i < progress.wins ? 'beaten' : i === progress.wins ? 'current' : 'locked';
      return `<li class="${state}" style="--clr:${f.color}">${emblemHtml(f)}<b>${state === 'locked' ? '???' : f.name}</b></li>`;
    })
    .join('');
  const bonus = progress.bonus.length
    ? `<h3>${STRINGS.bonusCards}</h3><div class="hand">${progress.bonus.map((id) => cardHtml(id)).join('')}</div>`
    : '';
  const champion = isChampion(progress);
  const root = screen(
    `<h2>${STRINGS.tournamentTitle}: ${getFighter(fighterId).name}</h2>
     <p>${champion ? STRINGS.champion : STRINGS.tournamentProgress(progress.wins, rivals.length)}</p>
     <ol class="ladder">${ladder}</ol>
     ${champion ? '' : difficultyPicker()}
     ${bonus}
     <div class="row">
       ${champion ? '' : `<button class="btn primary" data-act="fight">${STRINGS.nextRival}</button>`}
       <button class="btn ghost-btn" data-act="reset">${STRINGS.resetProgress}</button>
       <button class="btn ghost-btn" data-act="menu">${STRINGS.menu}</button>
     </div>`,
    'tournament',
  );
  bindDifficulty(root);
  on(root, '[data-act="menu"]', title);
  on(root, '[data-act="reset"]', () => {
    resetProgress(fighterId);
    tournamentHub(fighterId);
  });
  on(root, '[data-act="fight"]', () => tournamentMatch(progress));
}

function tournamentMatch(progress: TournamentProgress): void {
  const rival = rivalsFor(progress.fighterId)[progress.wins];
  runBattle(
    'tournament',
    { fighterId: progress.fighterId, bonusCards: progress.bonus },
    { fighterId: rival, bonusCards: rivalBonus(progress) },
    (outcome) => {
      const names: [string, string] = [STRINGS.player(1), getFighter(rival).name];
      if (outcome.winner === 0) {
        play('win');
        const card = recordWin(progress);
        const extra = card ? `<p>${STRINGS.newBonus}</p><div class="hand">${cardHtml(card)}</div><p class="note">${getCard(card).text ?? ''}</p>` : '';
        resultScreen(outcomeText(outcome, names), 0, [progress.fighterId, rival], [
          { label: STRINGS.continue, primary: true, fn: () => tournamentHub(progress.fighterId) },
        ], extra);
      } else {
        resultScreen(outcomeText(outcome, names), outcome.winner, [progress.fighterId, rival], [
          { label: STRINGS.retry, primary: true, fn: () => tournamentMatch(progress) },
          { label: STRINGS.menu, fn: () => tournamentHub(progress.fighterId) },
        ]);
      }
    },
    () => tournamentHub(progress.fighterId),
  );
}

title();
