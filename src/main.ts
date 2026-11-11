import './styles.css';
import { setMusic } from './audio/music';
import { play } from './audio/sfx';
import { FIGHTERS, getFighter } from './content/cards';
import { STRINGS } from './content/strings';
import type { Difficulty } from './engine/ai';
import { randomSeed } from './engine/rng';
import { createMatch } from './engine/setup';
import type { MatchOutcome, Seat } from './engine/types';
import { CpuPlanSource, type PlanSource } from './net/transport';
import { isChampion, loadProgress, recordWin, resetProgress, rivalBonus, rivalsFor, type TournamentProgress } from './tournament';
import { createTutorialMatch, isTutorialDone, ScriptedPlanSource, setTutorialDone, TUTORIAL, tutorialHooks } from './tutorial';
import { BattleView, HumanPlanSource } from './ui/battle';
import { cardHtml, describeCard, passiveHtml } from './ui/card';
import { emblemHtml } from './ui/emblems';
import { applyEffectsClass, fullEffects } from './settings';
import { bindSettings, settingsHtml } from './ui/settingsPanel';

type Mode = 'cpu' | 'hotseat' | 'tournament';

const app = document.getElementById('app')!;
let difficulty: Difficulty = 'normal';

function screen(html: string, cls = ''): HTMLElement {
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  setMusic(cls === 'battle-screen' || cls === 'versus' ? 'battle' : 'menu');
  return app.firstElementChild as HTMLElement;
}

/** Simple modal for screens outside a battle (the battle view has its own). */
function modal(html: string, bind: (box: HTMLElement) => void = () => undefined): void {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box">${html}<button class="btn" data-close>${STRINGS.close}</button></div>`;
  app.appendChild(el);
  const close = () => el.remove();
  el.addEventListener('click', (e) => {
    if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) {
      play('click');
      close();
    }
  });
  bind(el.querySelector('.modal-box')!);
}

function openSettings(): void {
  modal(`<h2>${STRINGS.settings.title}</h2>${settingsHtml()}`, bindSettings);
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
  const banner = isTutorialDone()
    ? ''
    : `<div class="banner"><span>${STRINGS.tutorial.newHere}</span>
        <div class="row">
          <button class="btn primary" data-act="tutorial">${STRINGS.tutorial.playTutorial}</button>
          <button class="btn ghost-btn" data-act="no-tutorial">${STRINGS.tutorial.noThanks}</button>
        </div></div>`;
  const root = screen(
    `<div class="title-wrap">
      ${banner}
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
        <button class="btn ghost-btn" data-act="settings">${STRINGS.settings.title}</button>
      </div>
    </div>`,
    'title',
  );
  on(root, '[data-mode]', (el) => pickFighters(el.dataset.mode as Mode));
  on(root, '[data-act="howto"]', howTo);
  on(root, '[data-act="tutorial"]', startTutorial);
  on(root, '[data-act="no-tutorial"]', () => {
    setTutorialDone();
    root.querySelector('.banner')?.remove();
  });
  on(root, '[data-act="settings"]', openSettings);
}

function howTo(): void {
  const example = ['right', 'guard', 'focus', 'cinderJab', 'zephyrGust', 'basaltSpikes'].map((id) => cardHtml(id)).join('');
  const root = screen(
    `<h2>${STRINGS.howToPlay}</h2>
     <ol class="rules">${STRINGS.rules.map((r) => `<li>${r}</li>`).join('')}</ol>
     <div class="hand demo">${example}</div>
     <p class="note">The number in the corner is the card's energy cost. On every grid the outlined centre square is you. Move cards mark where you will step in blue; attack cards mark the squares they hit in red, with an arrow showing the side you face. Icons in the top corner show special effects: ⇥ push, ⇤ pull, ✷ stun, ↺ counter, ♥ drain.</p>
     <div class="row">
       <button class="btn primary" data-act="tutorial">${STRINGS.tutorial.playTutorial}</button>
       <button class="btn" data-act="back">${STRINGS.back}</button>
     </div>`,
    'howto',
  );
  on(root, '[data-act="back"]', title);
  on(root, '[data-act="tutorial"]', startTutorial);
}

// ---------- fighter selection ----------

function fighterGrid(selected?: string, locked: string[] = []): string {
  return `<div class="fighters">${FIGHTERS.map(
    (f) => `<button class="fighter${f.id === selected ? ' selected' : ''}" data-fighter="${f.id}" style="--clr:${f.color}" ${locked.includes(f.id) ? 'disabled' : ''}>
      ${emblemHtml(f)}
      <b>${f.name}</b><i>${f.title}</i><span>${f.blurb}</span>
      ${passiveHtml(f)}
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
    root.querySelectorAll<HTMLElement>('[data-fighter]').forEach((el) =>
      el.addEventListener('click', async () => {
        await animatePick(root, el);
        picks.push(el.dataset.fighter!);
        if (mode === 'tournament') return tournamentHub(picks[0]);
        if (picks.length === 2) return startMatch(mode, picks[0], picks[1]);
        step();
      }),
    );
  };
  step();
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Highlight the chosen fighter and fade the rest before moving on. */
async function animatePick(root: HTMLElement, chosen: HTMLElement): Promise<void> {
  const grid = root.querySelector('.fighters')!;
  if (grid.classList.contains('picking')) return;
  grid.classList.add('picking');
  chosen.classList.add('chosen');
  play('place');
  await wait(750);
}

/** Short "A vs B" splash before a match. Tap to skip. */
function versusSplash(a: string, b: string, names: [string, string]): Promise<void> {
  const fa = getFighter(a);
  const fb = getFighter(b);
  const root = screen(
    `<div class="vs-splash">
      <div class="vs-side left" style="--clr:${fa.color}">${emblemHtml(fa)}<b>${fa.name}</b><span>${names[0]}</span></div>
      <div class="vs-mark">${STRINGS.vs}</div>
      <div class="vs-side right" style="--clr:${fb.color}">${emblemHtml(fb)}<b>${fb.name}</b><span>${names[1]}</span></div>
    </div>
    <p class="note">${STRINGS.tapToContinue}</p>`,
    'versus',
  );
  play('reveal');
  return new Promise((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res();
    };
    root.addEventListener('click', finish);
    setTimeout(finish, 1900);
  });
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
  void versusSplash(p0.fighterId, p1.fighterId, names).then(() => {
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
  });
}

/** Guided first match against a scripted training dummy. */
function startTutorial(): void {
  let view: BattleView | null = null;
  const names: [string, string] = [STRINGS.player(1), STRINGS.tutorial.dummy];
  void versusSplash(TUTORIAL.player, TUTORIAL.dummy, names).then(() => {
    const container = screen('', 'battle-screen');
    view = new BattleView(
      container,
      createTutorialMatch(),
      [
        { name: names[0], source: new HumanPlanSource(() => view!) },
        { name: names[1], source: new ScriptedPlanSource() },
      ],
      (outcome) => {
        setTutorialDone();
        if (outcome.winner === 0) play('win');
        const heading = outcome.winner === 0 ? STRINGS.tutorial.done : outcomeText(outcome, names);
        resultScreen(heading, outcome.winner, [TUTORIAL.player, TUTORIAL.dummy], [
          { label: STRINGS.modeCpu, primary: true, fn: () => pickFighters('cpu') },
          { label: STRINGS.retry, fn: startTutorial },
          { label: STRINGS.menu, fn: title },
        ], `<p class="note">${STRINGS.tutorial.doneHint}</p>`, outcome.winner === 0);
      },
      title,
      { hooks: tutorialHooks(), noTimer: true },
    );
  });
}

/** Falling paper confetti in the winner's colour (skipped with reduced effects). */
function confetti(root: HTMLElement, color: string): void {
  if (!fullEffects()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = [color, '#ffd23d', '#ffffff', color];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}vw`);
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    p.style.setProperty('--delay', `${Math.random() * 0.6}s`);
    p.style.setProperty('--dur', `${2.2 + Math.random() * 1.6}s`);
    p.style.background = colors[i % colors.length];
    layer.appendChild(p);
  }
  root.appendChild(layer);
  setTimeout(() => layer.remove(), 4600);
}

function outcomeText(outcome: MatchOutcome, names: [string, string]): string {
  return outcome.winner === null ? STRINGS.draw : STRINGS.wins(names[outcome.winner]);
}

function startMatch(mode: Mode, a: string, b: string): void {
  runBattle(mode, { fighterId: a }, { fighterId: b }, (outcome) => {
    const names: [string, string] = [STRINGS.player(1), mode === 'hotseat' ? STRINGS.player(2) : STRINGS.cpu];
    if (outcome.winner === 0 || mode === 'hotseat') play('win');
    const celebrate = outcome.winner === 0 || (mode === 'hotseat' && outcome.winner !== null);
    resultScreen(outcomeText(outcome, names), outcome.winner, [a, b], [
      { label: STRINGS.rematch, primary: true, fn: () => startMatch(mode, a, b) },
      { label: STRINGS.menu, fn: title },
    ], '', celebrate);
  });
}

function resultScreen(
  heading: string,
  winner: Seat | null,
  fighters: [string, string],
  buttons: { label: string; primary?: boolean; fn: () => void }[],
  extra = '',
  celebrate = false,
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
  if (celebrate) confetti(root, winner === null ? '#ffd23d' : getFighter(fighters[winner]).color);
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
        const extra = card ? `<p>${STRINGS.newBonus}</p><div class="hand">${cardHtml(card)}</div><p class="note">${describeCard(card)}</p>` : '';
        resultScreen(outcomeText(outcome, names), 0, [progress.fighterId, rival], [
          { label: STRINGS.continue, primary: true, fn: () => tournamentHub(progress.fighterId) },
        ], extra, true);
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

applyEffectsClass();
title();
