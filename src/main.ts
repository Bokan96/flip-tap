import './theme.css';
import './styles.css';
import { setMusic } from './audio/music';
import { play } from './audio/sfx';
import { ACHIEVEMENTS } from './content/achievements';
import { ARENAS, DEFAULT_ARENA, getArena } from './content/arenas';
import { ASSETS, assetUrl } from './content/assets';
import { BALANCE } from './content/balance';
import { BONUS_CARD_IDS, FIGHTERS, getCard, getFighter } from './content/cards';
import { STRINGS } from './content/strings';
import type { Difficulty } from './engine/ai';
import { randomSeed } from './engine/rng';
import { createMatch, type MatchModifier, type SeatConfig } from './engine/setup';
import type { MatchLog, MatchOutcome, MatchState, Seat } from './engine/types';
import { unlockAchievements } from './meta/achievements';
import { dailyChallenge } from './meta/daily';
import { clearSavedMatch, loadSavedMatch, saveMatch, type SavedMatch } from './meta/savedMatch';
import {
  collection,
  dailyStreak,
  favouriteCard,
  isTutorialDone,
  ladder,
  loadout,
  profile,
  recordDaily,
  recordLadderWin,
  recordMatch,
  resetLadder,
  resetProfile,
  setTutorialDone,
  toggleLoadout,
  type MatchMode,
} from './meta/profile';
import { CpuPlanSource, type PlanSource } from './net/transport';
import { installMode, onInstallChange, promptInstall, registerServiceWorker } from './pwa';
import { applyEffectsClass, fullEffects } from './settings';
import { currentRival, rivalBonus, rivalsFor } from './tournament';
import { createTutorialMatch, ScriptedPlanSource, TUTORIAL, tutorialHooks } from './tutorial';
import { BattleView, HumanPlanSource, type BattleOptions } from './ui/battle';
import { cardHtml, describeCard, passiveHtml } from './ui/card';
import { emblemHtml, portraitHtml } from './ui/emblems';
import { bindSettings, settingsHtml } from './ui/settingsPanel';
import { applySkin, themeColor } from './ui/skin';
import { toast } from './ui/toast';

const app = document.getElementById('app')!;
let difficulty: Difficulty = 'normal';
let arenaId = DEFAULT_ARENA;

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
  el.addEventListener('click', (e) => {
    if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) {
      play('click');
      el.remove();
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
  const saved = loadSavedMatch();
  const resume = saved
    ? `<button class="btn primary big" data-act="resume">${STRINGS.resumeMatch.title}<small>${STRINGS.resumeMatch.hint(
        getFighter(saved.fighters[0]).name,
        getFighter(saved.fighters[1]).name,
        saved.state.round,
      )}</small></button>`
    : '';
  const today = dailyChallenge();
  const dailyDone = profile().daily.results[today.date] === 'win';
  const dailyHint = dailyDone
    ? STRINGS.daily.beatenToday(dailyStreak())
    : STRINGS.daily.hint(getFighter(today.fighter).name, getFighter(today.rival).name, today.modifier.name);
  const root = screen(
    `<div class="title-wrap">
      ${banner}
      <div class="logo-emblems">${logoEmblems}</div>
      ${
        ASSETS.logo
          ? `<h1 class="logo-wrap"><img class="logo-img" src="${assetUrl(ASSETS.logo)}" alt="${STRINGS.gameTitle}"></h1>`
          : `<h1 class="logo">${STRINGS.gameTitle}</h1>`
      }
      <p class="tagline">${STRINGS.tagline}</p>
      <nav class="menu">
        ${resume}
        <button class="btn${saved ? '' : ' primary'} big" data-mode="tournament">${STRINGS.modeTournament}<small>${STRINGS.modeTournamentHint}</small></button>
        <button class="btn big daily-btn${dailyDone ? ' done' : ''}" data-act="daily">${STRINGS.daily.title}<small>${dailyHint}</small></button>
        <button class="btn big" data-mode="cpu">${STRINGS.modeCpu}<small>${STRINGS.modeCpuHint}</small></button>
        <button class="btn big" data-mode="hotseat">${STRINGS.modeHotseat}<small>${STRINGS.modeHotseatHint}</small></button>
      </nav>
      <button class="btn install-btn hidden" data-act="install">⤓ ${STRINGS.install.button}<small>${STRINGS.install.hint}</small></button>
      <div class="row">
        <button class="btn ghost-btn" data-act="howto">${STRINGS.howToPlay}</button>
        <button class="btn ghost-btn" data-act="profile">${STRINGS.profile.title}</button>
        <button class="btn ghost-btn" data-act="settings">${STRINGS.settings.title}</button>
      </div>
    </div>`,
    'title',
  );
  on(root, '[data-mode]', (el) => pickFighters(el.dataset.mode as 'cpu' | 'hotseat' | 'tournament'));
  on(root, '[data-act="daily"]', dailyScreen);
  if (saved) on(root, '[data-act="resume"]', () => resumeMatch(saved));
  on(root, '[data-act="howto"]', howTo);
  on(root, '[data-act="profile"]', profileScreen);
  on(root, '[data-act="settings"]', openSettings);
  on(root, '[data-act="tutorial"]', startTutorial);
  bindInstallButton(root);
  on(root, '[data-act="no-tutorial"]', () => {
    setTutorialDone();
    root.querySelector('.banner')?.remove();
  });
}

/** "Install app": the browser's own install dialog where supported, instructions on iPhone/iPad. */
function bindInstallButton(root: HTMLElement): void {
  const btn = root.querySelector<HTMLElement>('[data-act="install"]')!;
  const refresh = () => btn.classList.toggle('hidden', installMode() === null);
  refresh();
  const stop = onInstallChange(() => (document.contains(btn) ? refresh() : stop()));
  btn.addEventListener('click', async () => {
    play('click');
    if (installMode() === 'prompt') {
      await promptInstall();
      refresh();
    } else {
      modal(`<h2>${STRINGS.install.iosTitle}</h2><ol class="rules">${STRINGS.install.iosSteps.map((s) => `<li>${s}</li>`).join('')}</ol>`);
    }
  });
}

function howTo(): void {
  const example = ['right', 'guard', 'focus', 'cinderJab', 'zephyrGust', 'basaltSpikes'].map((id) => cardHtml(id)).join('');
  const root = screen(
    `<h2>${STRINGS.howToPlay}</h2>
     <ol class="rules">${STRINGS.rules.map((r) => `<li>${r}</li>`).join('')}</ol>
     <div class="hand demo">${example}</div>
     <p class="note">${STRINGS.howToNote}</p>
     <div class="row">
       <button class="btn primary" data-act="tutorial">${STRINGS.tutorial.playTutorial}</button>
       <button class="btn" data-act="back">${STRINGS.back}</button>
     </div>`,
    'howto',
  );
  on(root, '[data-act="back"]', title);
  on(root, '[data-act="tutorial"]', startTutorial);
}

// ---------- fighter selection and loadout ----------

function fighterGrid(): string {
  return `<div class="fighters">${FIGHTERS.map((f) => {
    const champ = ladder(f.id).champion ? `<em class="champ" title="${STRINGS.championBadge}">★</em>` : '';
    return `<button class="fighter" data-fighter="${f.id}" style="--clr:${f.color}">
      ${champ}${portraitHtml(f)}
      <b>${f.name}</b><i>${f.title}</i><span>${f.blurb}</span>
      ${passiveHtml(f)}
    </button>`;
  }).join('')}</div>`;
}

function difficultyPicker(): string {
  return `<div class="difficulty"><span>${STRINGS.difficulty}:</span>${(['easy', 'normal', 'hard'] as Difficulty[])
    .map((d) => `<button class="chip${d === difficulty ? ' on' : ''}" data-diff="${d}">${STRINGS.difficultyNames[d]}</button>`)
    .join('')}</div>`;
}

function arenaPicker(): string {
  return `<div class="difficulty arena-pick"><span>${STRINGS.arena}:</span>${ARENAS.map(
    (a) => `<button class="chip${a.id === arenaId ? ' on' : ''}" data-arena="${a.id}" title="${a.text}">${a.name}</button>`,
  ).join('')}</div><p class="note arena-note">${getArena(arenaId).text}</p>`;
}

function bindArena(root: HTMLElement): void {
  on(root, '[data-arena]', (el) => {
    arenaId = el.dataset.arena!;
    root.querySelectorAll('[data-arena]').forEach((c) => c.classList.toggle('on', c === el));
    const note = root.querySelector('.arena-note');
    if (note) note.textContent = getArena(arenaId).text;
  });
}

function bindDifficulty(root: HTMLElement): void {
  on(root, '[data-diff]', (el) => {
    difficulty = el.dataset.diff as Difficulty;
    root.querySelectorAll('[data-diff]').forEach((c) => c.classList.toggle('on', c === el));
  });
}

/** Equip up to BALANCE.bonusSlots bonus cards from the collection. */
function loadoutHtml(showEmpty: boolean): string {
  const owned = collection();
  if (!owned.length) return showEmpty ? `<p class="note loadout">${STRINGS.loadout.empty}</p>` : '';
  const equipped = loadout();
  return `<div class="loadout">
    <h3>${STRINGS.loadout.title(equipped.length, BALANCE.bonusSlots)}</h3>
    <div class="loadout-cards">${owned
      .map((id) => `<div class="loadout-card${equipped.includes(id) ? ' on' : ''}" data-equip="${id}">${cardHtml(id, { small: true, readonly: true })}</div>`)
      .join('')}</div>
    <p class="note">${STRINGS.loadout.hint}</p>
  </div>`;
}

function bindLoadout(root: HTMLElement): void {
  root.querySelector('.loadout')?.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-equip]');
    if (!card) return;
    if (!toggleLoadout(card.dataset.equip!)) {
      play('deny');
      toast('!', STRINGS.loadout.fullTitle, STRINGS.loadout.full);
      return;
    }
    play('place');
    root.querySelector('.loadout')!.outerHTML = loadoutHtml(false);
    bindLoadout(root);
  });
}

function pickFighters(mode: 'cpu' | 'hotseat' | 'tournament'): void {
  const picks: string[] = [];
  const step = () => {
    const who = mode === 'hotseat' ? STRINGS.player(picks.length + 1) : picks.length === 0 ? STRINGS.player(1) : STRINGS.cpu;
    const first = picks.length === 0;
    const root = screen(
      `<h2>${STRINGS.pickFighter(who)}</h2>
       ${mode === 'cpu' && first ? difficultyPicker() : ''}
       ${mode !== 'tournament' && first ? arenaPicker() : ''}
       ${mode === 'cpu' && first ? loadoutHtml(false) : ''}
       ${fighterGrid()}
       <button class="btn ghost-btn" data-act="back">${STRINGS.back}</button>`,
      'select',
    );
    bindDifficulty(root);
    bindArena(root);
    bindLoadout(root);
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
      <div class="vs-side left" style="--clr:${fa.color}">${portraitHtml(fa)}<b>${fa.name}</b><span>${names[0]}</span></div>
      <div class="vs-mark">${STRINGS.vs}</div>
      <div class="vs-side right" style="--clr:${fb.color}">${portraitHtml(fb)}<b>${fb.name}</b><span>${names[1]}</span></div>
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

interface BattleSetup {
  mode: MatchMode;
  p0: SeatConfig;
  p1: SeatConfig;
  names: [string, string];
  /** CPU difficulty for seat 1, or null when seat 1 isn't the regular CPU. */
  difficulty: Difficulty | null;
  modifier?: MatchModifier;
  arenaId?: string;
  /** Custom start state and seat 1 source (tutorial). */
  state?: MatchState;
  opponent?: PlanSource;
  options?: BattleOptions;
  /** Tournament fighter or daily date, kept with a saved match. */
  context?: string | null;
  /** Continue this saved match instead of starting fresh. */
  resume?: SavedMatch;
  onEnd: (outcome: MatchOutcome, log: MatchLog) => void;
  onQuit?: () => void;
}

/** Run a match; afterwards update stats, unlock achievements and show their toasts. */
function runBattle(setup: BattleSetup): void {
  let view: BattleView | null = null;
  const human = new HumanPlanSource(() => view!);
  const opponent =
    setup.opponent ??
    (setup.mode === 'hotseat' ? new HumanPlanSource(() => view!) : new CpuPlanSource(setup.difficulty ?? 'normal', randomSeed()));
  // Every mode except the tutorial is saved at each round start, so it can be resumed.
  const save =
    setup.mode === 'tutorial'
      ? undefined
      : (state: MatchState, lastPlans: SavedMatch['lastPlans'], log: MatchLog) =>
          saveMatch({
            version: 1,
            mode: setup.mode as SavedMatch['mode'],
            fighters: [setup.p0.fighterId, setup.p1.fighterId],
            difficulty: setup.difficulty,
            context: setup.context ?? null,
            state,
            lastPlans,
            log,
          });
  const intro = setup.resume ? Promise.resolve() : versusSplash(setup.p0.fighterId, setup.p1.fighterId, setup.names);
  void intro.then(() => {
    const container = screen('', 'battle-screen');
    view = new BattleView(
      container,
      setup.resume?.state ?? setup.state ?? createMatch(setup.p0, setup.p1, setup.modifier, setup.arenaId),
      [
        { name: setup.names[0], source: human },
        { name: setup.names[1], source: opponent },
      ],
      (outcome, _state, log) => {
        clearSavedMatch();
        // The mode's own handler runs first (it may record a ladder win or daily result).
        setup.onEnd(outcome, log);
        recordMatch({ mode: setup.mode, fighterId: setup.p0.fighterId, outcome, log });
        const fresh = unlockAchievements({ mode: setup.mode, difficulty: setup.difficulty, outcome, log });
        fresh.forEach((a, i) =>
          setTimeout(() => {
            play('reveal');
            toast(a.icon, STRINGS.achievementUnlocked, a.name);
          }, 700 + i * 900),
        );
      },
      () => {
        clearSavedMatch();
        (setup.onQuit ?? title)();
      },
      {
        ...setup.options,
        onRoundStart: save,
        resume: setup.resume ? { lastPlans: setup.resume.lastPlans, log: setup.resume.log } : undefined,
      },
    );
  });
}

/** Pick a saved match back up in the mode it was played in. */
function resumeMatch(saved: SavedMatch): void {
  const [a, b] = saved.fighters;
  if (saved.difficulty) difficulty = saved.difficulty;
  if (saved.mode === 'tournament' && saved.context) return tournamentMatch(saved.context, saved);
  if (saved.mode === 'daily' && saved.context) return dailyMatch(saved.context, saved);
  if (saved.mode === 'cpu' || saved.mode === 'hotseat') return startMatch(saved.mode, a, b, saved);
  clearSavedMatch();
  title();
}

/** Guided first match against a scripted training dummy. */
function startTutorial(): void {
  const names: [string, string] = [STRINGS.player(1), STRINGS.tutorial.dummy];
  runBattle({
    mode: 'tutorial',
    p0: { fighterId: TUTORIAL.player },
    p1: { fighterId: TUTORIAL.dummy },
    names,
    difficulty: null,
    state: createTutorialMatch(),
    opponent: new ScriptedPlanSource(),
    options: { hooks: tutorialHooks(), noTimer: true },
    onEnd: (outcome) => {
      setTutorialDone();
      if (outcome.winner === 0) play('win');
      const heading = outcome.winner === 0 ? STRINGS.tutorial.done : outcomeText(outcome, names);
      resultScreen(heading, outcome.winner, [TUTORIAL.player, TUTORIAL.dummy], [
        { label: STRINGS.modeCpu, primary: true, fn: () => pickFighters('cpu') },
        { label: STRINGS.retry, fn: startTutorial },
        { label: STRINGS.menu, fn: title },
      ], `<p class="note">${STRINGS.tutorial.doneHint}</p>`, outcome.winner === 0);
    },
  });
}

function startMatch(mode: 'cpu' | 'hotseat', a: string, b: string, resume?: SavedMatch): void {
  const names: [string, string] = [STRINGS.player(1), mode === 'hotseat' ? STRINGS.player(2) : STRINGS.cpu];
  runBattle({
    mode,
    resume,
    p0: { fighterId: a, bonusCards: mode === 'cpu' ? loadout() : [] },
    p1: { fighterId: b },
    names,
    arenaId,
    difficulty: mode === 'cpu' ? difficulty : null,
    onEnd: (outcome) => {
      const celebrate = outcome.winner === 0 || (mode === 'hotseat' && outcome.winner !== null);
      if (celebrate) play('win');
      resultScreen(outcomeText(outcome, names), outcome.winner, [a, b], [
        { label: STRINGS.rematch, primary: true, fn: () => startMatch(mode, a, b) },
        { label: STRINGS.menu, fn: title },
      ], '', celebrate);
    },
  });
}

/** Falling paper confetti in the winner's colour (skipped with reduced effects). */
function confetti(root: HTMLElement, color: string): void {
  if (!fullEffects()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = [color, themeColor('--accent'), '#ffffff', color];
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

function resultScreen(
  heading: string,
  winner: Seat | null,
  fighters: [string, string],
  buttons: { label: string; primary?: boolean; fn: () => void }[],
  extra = '',
  celebrate = false,
): void {
  const fx = fighters
    .map((id, i) => `<div class="result-fighter${winner === i ? ' won' : winner === null ? '' : ' lost'}">${portraitHtml(getFighter(id))}</div>`)
    .join('<span class="vs">vs</span>');
  const root = screen(
    `<div class="result-row">${fx}</div>
     <h2>${heading}</h2>${extra}
     <div class="row">${buttons.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`,
    'result',
  );
  if (celebrate) confetti(root, winner === null ? themeColor('--accent') : getFighter(fighters[winner]).color);
  on(root, '[data-i]', (el) => buttons[Number(el.dataset.i)].fn());
}

// ---------- tournament ----------

function tournamentHub(fighterId: string): void {
  const rivals = rivalsFor(fighterId);
  const { wins, champion } = ladder(fighterId);
  const complete = wins >= rivals.length;
  const steps = rivals
    .map((id, i) => {
      const f = getFighter(id);
      const state = i < wins ? 'beaten' : i === wins ? 'current' : 'locked';
      return `<li class="${state}" style="--clr:${f.color}">${emblemHtml(f)}<b>${state === 'locked' ? '???' : f.name}</b></li>`;
    })
    .join('');
  const root = screen(
    `<h2>${STRINGS.tournamentTitle}: ${getFighter(fighterId).name}${champion ? ' <span class="champ inline">★</span>' : ''}</h2>
     <p>${complete ? STRINGS.champion : STRINGS.tournamentProgress(wins, rivals.length)}</p>
     <ol class="ladder">${steps}</ol>
     ${complete ? '' : difficultyPicker()}
     ${loadoutHtml(true)}
     <div class="row">
       ${complete ? '' : `<button class="btn primary" data-act="fight">${STRINGS.nextRival}</button>`}
       ${wins > 0 ? `<button class="btn ghost-btn" data-act="reset">${STRINGS.restartLadder}</button>` : ''}
       <button class="btn ghost-btn" data-act="menu">${STRINGS.menu}</button>
     </div>`,
    'tournament',
  );
  bindDifficulty(root);
  bindLoadout(root);
  on(root, '[data-act="menu"]', title);
  on(root, '[data-act="reset"]', () => {
    resetLadder(fighterId);
    tournamentHub(fighterId);
  });
  on(root, '[data-act="fight"]', () => tournamentMatch(fighterId));
}

function tournamentMatch(fighterId: string, resume?: SavedMatch): void {
  const rival = resume?.fighters[1] ?? currentRival(fighterId);
  if (!rival) return tournamentHub(fighterId);
  const rivals = rivalsFor(fighterId);
  const names: [string, string] = [STRINGS.player(1), getFighter(rival).name];
  runBattle({
    mode: 'tournament',
    context: fighterId,
    resume,
    p0: { fighterId, bonusCards: loadout() },
    p1: { fighterId: rival, bonusCards: rivalBonus(ladder(fighterId).wins) },
    names,
    difficulty,
    onQuit: () => tournamentHub(fighterId),
    onEnd: (outcome) => {
      if (outcome.winner !== 0) {
        resultScreen(outcomeText(outcome, names), outcome.winner, [fighterId, rival], [
          { label: STRINGS.retry, primary: true, fn: () => tournamentMatch(fighterId) },
          { label: STRINGS.menu, fn: () => tournamentHub(fighterId) },
        ]);
        return;
      }
      play('win');
      const { card, champion } = recordLadderWin(fighterId, rivals.length);
      const extra =
        (champion ? `<p class="champion-line">★ ${STRINGS.newChampion(getFighter(fighterId).name)}</p>` : '') +
        (card
          ? `<p>${STRINGS.newBonus}</p><div class="hand">${cardHtml(card)}</div>` +
            (describeCard(card) ? `<p class="note">${describeCard(card)}</p>` : '')
          : '');
      resultScreen(outcomeText(outcome, names), 0, [fighterId, rival], [
        { label: STRINGS.continue, primary: true, fn: () => tournamentHub(fighterId) },
      ], extra, true);
    },
  });
}

// ---------- daily challenge ----------

function dailyScreen(): void {
  const c = dailyChallenge();
  const f = getFighter(c.fighter);
  const r = getFighter(c.rival);
  const d = profile().daily;
  const beaten = d.results[c.date] === 'win';
  const root = screen(
    `<h2>${STRINGS.daily.title}</h2>
     <p class="note">${STRINGS.daily.sameForEveryone}</p>
     <div class="daily-vs">
       <div style="--clr:${f.color}">${portraitHtml(f)}<b>${f.name}</b><span>${STRINGS.daily.youPlay}</span></div>
       <span class="vs">vs</span>
       <div style="--clr:${r.color}">${portraitHtml(r)}<b>${r.name}</b><span>${STRINGS.daily.hardCpu}</span></div>
     </div>
     <div class="daily-rule"><small>${STRINGS.daily.rule}</small><b>${c.modifier.name}</b><span>${c.modifier.text}</span></div>
     <div class="daily-rule arena"><small>${STRINGS.arena}</small><b>${getArena(c.arena).name}</b><span>${getArena(c.arena).text}</span></div>
     <p>${STRINGS.daily.streak(dailyStreak(), d.best)}</p>
     ${beaten ? `<p class="champion-line">✓ ${STRINGS.daily.done}</p>` : ''}
     <div class="row">
       <button class="btn primary" data-act="play">${beaten ? STRINGS.daily.playAgain : STRINGS.daily.play}</button>
       <button class="btn ghost-btn" data-act="back">${STRINGS.back}</button>
     </div>`,
    'daily',
  );
  on(root, '[data-act="back"]', title);
  on(root, '[data-act="play"]', () => dailyMatch(c.date));
}

/** `date` is fixed when the match starts, so a match that crosses midnight counts for its own day. */
function dailyMatch(date: string, resume?: SavedMatch): void {
  const c = dailyChallenge(date);
  const names: [string, string] = [STRINGS.player(1), getFighter(c.rival).name];
  runBattle({
    mode: 'daily',
    context: date,
    resume,
    p0: { fighterId: c.fighter },
    p1: { fighterId: c.rival },
    names,
    difficulty: 'hard',
    modifier: c.modifier.modifier,
    arenaId: c.arena,
    options: { tag: c.modifier.name },
    onQuit: dailyScreen,
    onEnd: (outcome) => {
      const won = outcome.winner === 0;
      recordDaily(won ? 'win' : outcome.winner === null ? 'draw' : 'loss', date);
      if (won) play('win');
      const extra = `<p>${STRINGS.daily.streak(dailyStreak(), profile().daily.best)}</p>`;
      resultScreen(outcomeText(outcome, names), outcome.winner, [c.fighter, c.rival], [
        won ? { label: STRINGS.menu, primary: true, fn: title } : { label: STRINGS.retry, primary: true, fn: () => dailyMatch(date) },
        { label: STRINGS.daily.title, fn: dailyScreen },
      ], extra, won);
    },
  });
}

// ---------- profile ----------

function profileScreen(): void {
  const p = profile();
  const s = p.stats;
  const P = STRINGS.profile;
  const pct = (w: number, n: number) => (n ? `${Math.round((100 * w) / n)}%` : P.none);
  const fav = favouriteCard();
  const stat = (label: string, value: string | number) => `<div class="stat-tile"><b>${value}</b><span>${label}</span></div>`;
  const fighters = FIGHTERS.map((f) => {
    const rec = s.byFighter[f.id] ?? { played: 0, won: 0 };
    const l = ladder(f.id);
    return `<li style="--clr:${f.color}">${emblemHtml(f, 'hud-emblem')}
      <b>${f.name}${l.champion ? ' <span class="champ inline">★</span>' : ''}</b>
      <span>${P.record(rec.won, rec.played)}</span>
      <span>${P.ladder(l.wins, rivalsFor(f.id).length)}</span></li>`;
  }).join('');
  const unlocked = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
  const achievements = ACHIEVEMENTS.map(
    (a) => `<li class="${p.achievements[a.id] ? 'got' : ''}"><i>${a.icon}\uFE0E</i><div><b>${a.name}</b><span>${a.text}</span></div></li>`,
  ).join('');
  const cards = BONUS_CARD_IDS.map((id) =>
    p.collection.includes(id) ? cardHtml(id, { small: true, readonly: true }) : '<span class="card small placeholder unknown">?</span>',
  ).join('');
  const root = screen(
    `<h2>${P.title}</h2>
     <div class="stat-grid">
       ${stat(P.matches, s.matches)}
       ${stat(P.wins, s.wins)}
       ${stat(P.winRate, pct(s.wins, s.matches))}
       ${stat(P.bestStreak, s.bestStreak)}
       ${stat(P.damage, s.damageDealt)}
       ${stat(P.favourite, fav ? getCard(fav).name : P.none)}
     </div>
     <h3>${P.fighters}</h3>
     <ul class="fighter-records">${fighters}</ul>
     <h3>${P.achievements(unlocked, ACHIEVEMENTS.length)}</h3>
     <ul class="achievements">${achievements}</ul>
     <h3>${P.collection(p.collection.length, BONUS_CARD_IDS.length)}</h3>
     <div class="hand collection">${cards}</div>
     <div class="row">
       <button class="btn" data-act="back">${STRINGS.back}</button>
       <button class="btn danger" data-act="reset">${P.reset}</button>
     </div>`,
    'profile',
  );
  on(root, '[data-act="back"]', title);
  on(root, '[data-act="reset"]', () => {
    if (!confirm(P.resetConfirm)) return;
    resetProfile();
    profileScreen();
  });
}

/** Offer a newly downloaded version (installed app / offline cache). */
function showUpdate(apply: () => void): void {
  if (document.querySelector('.update-banner')) return;
  const el = document.createElement('div');
  el.className = 'update-banner';
  el.innerHTML = `<span>${STRINGS.update.ready}</span><button class="btn primary">${STRINGS.update.apply}</button>`;
  el.querySelector('button')!.addEventListener('click', () => {
    play('click');
    apply();
  });
  document.body.appendChild(el);
}

applySkin();
applyEffectsClass();
registerServiceWorker(showUpdate);
title();
