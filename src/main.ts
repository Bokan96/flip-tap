import './theme.css';
import './styles.css';
import { setMusic } from './audio/music';
import { play } from './audio/sfx';
import { ACHIEVEMENTS } from './content/achievements';
import { ARENAS, DEFAULT_ARENA, getArena } from './content/arenas';
import { ASSETS, assetUrl } from './content/assets';
import { BALANCE } from './content/balance';
import { BONUS_CARD_IDS, FIGHTERS, getCard, getFighter } from './content/cards';
import { MODIFIERS } from './content/modifiers';
import { STRINGS } from './content/strings';
import { DIFFICULTIES, type Difficulty } from './engine/ai';
import { randomSeed } from './engine/rng';
import { createMatch, type MatchModifier, type SeatConfig } from './engine/setup';
import type { MatchLog, MatchOutcome, MatchState, Seat } from './engine/types';
import { unlockAchievements } from './meta/achievements';
import { dailyChallenge } from './meta/daily';
import { matchStats, tradeRow, type MatchStats } from './meta/matchStats';
import {
  decodeReplay,
  encodeReplay,
  replayFromMatch,
  ReplayPlanSource,
  replayStart,
  runReplay,
  type Replay,
  type ReplayMode,
} from './meta/replay';
import { clearSavedMatch, loadSavedMatch, saveMatch, type SavedMatch } from './meta/savedMatch';
import {
  collection,
  dailyStreak,
  favouriteCard,
  isTutorialDone,
  ladder,
  loadout,
  profile,
  recentMatches,
  recordDaily,
  recordLadderWin,
  recordMatch,
  recordRecent,
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
import { arenaMiniHtml } from './ui/arenaPreview';
import { BattleView, HumanPlanSource, type BattleOptions } from './ui/battle';
import { cardHtml, describeCard, passiveHtml } from './ui/card';
import { emblemHtml, portraitHtml } from './ui/emblems';
import { retrigger } from './ui/fx';
import { renderSummary } from './ui/matchSummary';
import { gameUrl, replayCodeFromHash, replayUrl, shareOrCopy, type ShareResult } from './ui/share';
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
  on(root, '[data-mode]', (el) => matchSetup(el.dataset.mode as SetupMode));
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
    const mode = installMode();
    if (mode === 'prompt' && (await promptInstall()) !== 'unavailable') {
      refresh();
      return;
    }
    // iPhone/iPad, or the browser wouldn't open its dialog: explain how to do it from the browser.
    const steps = mode === 'ios' ? STRINGS.install.iosSteps : [STRINGS.install.manualSteps];
    modal(`<h2>${STRINGS.install.iosTitle}</h2><ol class="rules">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`);
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

function difficultyPicker(): string {
  return `<div class="difficulty"><span>${STRINGS.difficulty}:</span>${DIFFICULTIES.map(
    (d) => `<button class="chip${d === difficulty ? ' on' : ''}" data-diff="${d}">${STRINGS.difficultyNames[d]}</button>`,
  ).join('')}</div><p class="note diff-note">${STRINGS.difficultyHints[difficulty]}</p>`;
}

/** Arena choices, each with a small drawing of the board. */
function arenaPicker(): string {
  return `<div class="arena-pick"><span class="arena-pick-label">${STRINGS.arena}:</span><div class="arena-opts">${ARENAS.map(
    (a) => `<button class="arena-opt${a.id === arenaId ? ' on' : ''}" data-arena="${a.id}" title="${a.text}">${arenaMiniHtml(a)}<b>${a.name}</b></button>`,
  ).join('')}</div></div><p class="note arena-note">${getArena(arenaId).text}</p>`;
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
    const note = root.querySelector('.diff-note');
    if (note) note.textContent = STRINGS.difficultyHints[difficulty];
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

type SetupMode = 'cpu' | 'hotseat' | 'tournament';

/** The last picks per mode in this session, so coming back to setup keeps them. */
const lastPicks: Partial<Record<SetupMode, (string | null)[]>> = {};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stars(n: number): string {
  return `<span class="stars" title="${STRINGS.setup.complexity}">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
}

/**
 * Match setup: the fighter slots (tap one to change it), the roster with a Random tile, details of
 * the highlighted fighter, the mode's options and a Fight button. Nothing starts until Fight.
 */
function matchSetup(mode: SetupMode): void {
  const seats = mode === 'tournament' ? 1 : 2;
  const names = mode === 'hotseat' ? [STRINGS.player(1), STRINGS.player(2)] : mode === 'cpu' ? [STRINGS.setup.you, STRINGS.cpu] : [STRINGS.setup.you];
  const picks: (string | null)[] = [...(lastPicks[mode] ?? Array(seats).fill(null))];
  let active = picks.findIndex((p) => !p);
  if (active < 0) active = 0;
  let focus: string | null = picks[active] ?? picks[0];
  let busy = false;

  const heading = mode === 'cpu' ? STRINGS.modeCpu : mode === 'hotseat' ? STRINGS.modeHotseat : STRINGS.modeTournament;
  const tiles = FIGHTERS.map((f) => {
    const champ = ladder(f.id).champion ? `<em class="champ" title="${STRINGS.championBadge}">★</em>` : '';
    return `<button class="pick" data-pick="${f.id}" style="--clr:${f.color}">
      ${champ}<span class="pick-marks"></span>${portraitHtml(f, 'pick-emblem')}<b>${f.name}</b><small>${f.role}</small>
    </button>`;
  }).join('');
  const options =
    (mode === 'cpu' ? difficultyPicker() : '') + (mode !== 'tournament' ? arenaPicker() : '') + (mode === 'cpu' ? loadoutHtml(false) : '');
  const root = screen(
    `<h2>${heading}</h2>
     <div class="setup">
       <div class="setup-slots seats-${seats}"></div>
       <div class="roster">${tiles}
         <button class="pick random" data-random><span class="random-glyph">?</span><b>${STRINGS.setup.random}</b><small>&nbsp;</small></button>
       </div>
       <div class="fighter-detail"></div>
       ${options ? `<div class="setup-options">${options}</div>` : ''}
       <div class="row setup-actions">
         <button class="btn ghost-btn" data-act="back">${STRINGS.back}</button>
         <button class="btn primary fight-btn" data-act="fight">${mode === 'tournament' ? STRINGS.setup.next : STRINGS.setup.fight}</button>
       </div>
     </div>`,
    'setup-screen',
  );

  const render = () => {
    root.querySelector('.setup-slots')!.innerHTML = picks
      .map((id, i) => {
        const f = id ? getFighter(id) : null;
        const slot = `<button class="slot-card p${i}${i === active ? ' active' : ''}" data-seat="${i}"${f ? ` style="--clr:${f.color}"` : ''}>
          ${f ? emblemHtml(f, 'slot-emblem') : '<span class="slot-empty">?</span>'}
          <span class="slot-text"><small>${names[i]}</small><b>${f ? f.name : STRINGS.setup.choose}</b></span>
        </button>`;
        return i === 1 ? `<span class="setup-vs">${STRINGS.vs}</span>${slot}` : slot;
      })
      .join('');
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((tile) => {
      const id = tile.dataset.pick!;
      tile.classList.toggle('focus', id === focus);
      tile.querySelector('.pick-marks')!.innerHTML = picks
        .map((p, i) => (p === id ? `<i class="m${i}">${seats === 1 ? '✓' : i === 0 ? 'P1' : mode === 'cpu' ? 'CPU' : 'P2'}</i>` : ''))
        .join('');
    });
    const detail = root.querySelector<HTMLElement>('.fighter-detail')!;
    const f = focus ? getFighter(focus) : null;
    if (!f) {
      detail.style.removeProperty('--clr');
      detail.innerHTML = `<p class="detail-blurb">${STRINGS.setup.pickFor(names[active])}</p>`;
    } else {
      detail.style.setProperty('--clr', f.color);
      detail.innerHTML = `<div class="detail-head">${portraitHtml(f, 'detail-emblem')}
          <div><b>${f.name}</b><i>${f.title}</i><div class="detail-tags"><span class="role-tag">${f.role}</span>${stars(f.complexity)}</div></div>
          <span class="detail-stats">♥ ${f.lifeMax ?? BALANCE.lifeMax}<br>⚡ ${f.energyMax ?? BALANCE.energyMax}</span>
        </div>
        <p class="detail-blurb">${f.blurb}</p>
        ${passiveHtml(f)}`;
    }
    root.querySelector<HTMLButtonElement>('[data-act="fight"]')!.disabled = picks.some((p) => !p);
  };

  const choose = (id: string) => {
    const seat = active;
    picks[seat] = id;
    focus = id;
    // Move on to the next empty slot, if any.
    const next = picks.findIndex((p) => !p);
    if (next >= 0) active = next;
    render();
    retrigger(root.querySelector(`[data-pick="${id}"]`)!, 'picked');
    retrigger(root.querySelector(`.slot-card.p${seat}`)!, 'picked');
  };

  root.querySelector('.roster')!.addEventListener('click', async (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.pick');
    if (!tile || busy) return;
    if (tile.dataset.pick) {
      play('place');
      return choose(tile.dataset.pick);
    }
    // Random: flick through the roster, then land on one.
    busy = true;
    play('reveal');
    const all = [...root.querySelectorAll<HTMLElement>('[data-pick]')];
    const final = FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)].id;
    for (let k = 0; k < 9; k++) {
      all.forEach((t) => t.classList.remove('cycling'));
      all[Math.floor(Math.random() * all.length)].classList.add('cycling');
      await wait(60 + k * 12);
    }
    all.forEach((t) => t.classList.remove('cycling'));
    busy = false;
    play('place');
    choose(final);
  });
  root.querySelector('.setup-slots')!.addEventListener('click', (e) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-seat]');
    if (!slot) return;
    play('click');
    active = Number(slot.dataset.seat);
    focus = picks[active] ?? focus;
    render();
  });
  bindDifficulty(root);
  bindArena(root);
  bindLoadout(root);
  on(root, '[data-act="back"]', title);
  on(root, '[data-act="fight"]', () => {
    if (picks.some((p) => !p)) return;
    lastPicks[mode] = [...picks];
    if (mode === 'tournament') return tournamentHub(picks[0]!);
    startMatch(mode, picks[0]!, picks[1]!);
  });
  render();
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
  /** Daily rule twist id (kept in the replay). */
  modifierId?: string;
  /** Continue this saved match instead of starting fresh. */
  resume?: SavedMatch;
  /** `recap` is null in the tutorial (or if the match couldn't be recorded). */
  onEnd: (outcome: MatchOutcome, log: MatchLog, recap: Recap | null) => void;
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
      (outcome, state, log) => {
        clearSavedMatch();
        const recap = setup.mode === 'tutorial' ? null : recordReplay(setup, state, log, outcome);
        // The mode's own handler runs first (it may record a ladder win or daily result).
        setup.onEnd(outcome, log, recap);
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

/** Everything the result screen needs for the match summary, replay and share buttons. */
interface Recap {
  replay: Replay;
  code: string;
  stats: MatchStats;
  names: [string, string];
}

/**
 * Keep the finished match as a replay (in Recent matches) and work out its summary. The replay
 * is checked by re-running it; if it somehow doesn't end the same way, it isn't kept.
 */
function recordReplay(setup: BattleSetup, state: MatchState, log: MatchLog, outcome: MatchOutcome): Recap | null {
  try {
    const replay = replayFromMatch(state, log, {
      mode: setup.mode as ReplayMode,
      difficulty: setup.difficulty,
      modifier: setup.modifierId ?? null,
      date: setup.mode === 'daily' ? (setup.context ?? null) : null,
    });
    const check = runReplay(replay);
    if (!check || JSON.stringify(check.outcome) !== JSON.stringify(outcome)) return null;
    const code = encodeReplay(replay);
    recordRecent(code);
    return { replay, code, stats: matchStats(replayStart(replay), log), names: setup.names };
  } catch {
    return null;
  }
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
        { label: STRINGS.modeCpu, primary: true, fn: () => matchSetup('cpu') },
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
    onEnd: (outcome, _log, recap) => {
      const celebrate = outcome.winner === 0 || (mode === 'hotseat' && outcome.winner !== null);
      if (celebrate) play('win');
      resultScreen(outcomeText(outcome, names), outcome.winner, [a, b], [
        { label: STRINGS.rematch, primary: true, fn: () => startMatch(mode, a, b) },
        { label: STRINGS.menu, fn: title },
      ], '', celebrate, recap);
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

type ResultButton = { label: string; primary?: boolean; fn: () => void };

/**
 * The end of a match: both fighters, the outcome and the mode's buttons, then (when the match was
 * recorded) the match summary with Watch replay and Share buttons.
 */
function resultScreen(
  heading: string,
  winner: Seat | null,
  fighters: [string, string],
  buttons: ResultButton[],
  extra = '',
  celebrate = false,
  recap: Recap | null = null,
  /** Extra summary actions (e.g. the daily challenge's Share result). */
  more: ResultButton[] = [],
  /** Add Watch replay and Share replay next to the summary title (off when `buttons` has them). */
  replayButtons = true,
): void {
  const fx = fighters
    .map((id, i) => `<div class="result-fighter${winner === i ? ' won' : winner === null ? '' : ' lost'}">${portraitHtml(getFighter(id))}</div>`)
    .join('<span class="vs">vs</span>');
  const again = () => resultScreen(heading, winner, fighters, buttons, extra, false, recap, more, replayButtons);
  const actions: ResultButton[] =
    recap && replayButtons
      ? [
          ...more,
          { label: STRINGS.replays.watch, fn: () => watchReplay(recap.code, again) },
          { label: STRINGS.replays.share, fn: () => void shareReplay(recap.code) },
        ]
      : more;
  const btn = (b: ResultButton, key: string) => `<button class="btn${b.primary ? ' primary' : ''}" data-${key}>${b.label}</button>`;
  const root = screen(
    `<div class="result-row">${fx}</div>
     <h2>${heading}</h2>${extra}
     <div class="row">${buttons.map((b, i) => btn(b, `i="${i}"`)).join('')}</div>
     ${
       recap
         ? `<section class="match-summary">
              <div class="summary-head"><h3>${STRINGS.summary.title}</h3>
                ${actions.length ? `<div class="row">${actions.map((b, i) => btn(b, `a="${i}"`)).join('')}</div>` : ''}</div>
              <div class="summary-body"></div>
            </section>`
         : ''
     }`,
    'result',
  );
  if (recap) renderSummary(root.querySelector('.summary-body')!, { stats: recap.stats, names: recap.names, fighters });
  if (celebrate) confetti(root, winner === null ? themeColor('--accent') : getFighter(fighters[winner]).color);
  on(root, '[data-i]', (el) => buttons[Number(el.dataset.i)].fn());
  on(root, '[data-a]', (el) => actions[Number(el.dataset.a)].fn());
}

// ---------- replays ----------

/** Seat names as the match showed them. */
function replayNames(r: Replay): [string, string] {
  const p1 = STRINGS.player(1);
  if (r.mode === 'hotseat') return [p1, STRINGS.player(2)];
  if (r.mode === 'cpu') return [p1, STRINGS.cpu];
  return [p1, getFighter(r.fighters[1]).name];
}

function replayTag(r: Replay): string {
  const mod = r.modifier ? MODIFIERS.find((m) => m.id === r.modifier)?.name : null;
  return mod ? `${STRINGS.replays.tag} · ${mod}` : STRINGS.replays.tag;
}

function replayInvalid(back: () => void): void {
  back();
  modal(`<h2>${STRINGS.replays.invalidTitle}</h2><p>${STRINGS.replays.invalid}</p>`);
}

/** Show the outcome of a share: a toast when copied, or the text to copy by hand. */
function afterShare(res: ShareResult, full: string): void {
  if (res === 'copied') return toast('✓', STRINGS.replays.copied, STRINGS.replays.copiedHint);
  if (res !== 'failed') return;
  modal(`<h2>${STRINGS.replays.copyTitle}</h2><textarea class="share-text" readonly rows="5"></textarea>`, (box) => {
    const area = box.querySelector('textarea')!;
    area.value = full;
    area.focus();
    area.select();
  });
}

async function shareReplay(code: string): Promise<void> {
  const r = decodeReplay(code);
  if (!r) return;
  const text = STRINGS.replays.shareText(getFighter(r.fighters[0]).name, getFighter(r.fighters[1]).name);
  const url = replayUrl(code);
  afterShare(await shareOrCopy({ title: STRINGS.replays.shareTitle, text, url }), `${text}\n${url}`);
}

/**
 * Watch a replay on the battle screen with playback controls. Skipping to another round starts a
 * fresh view at that round's start. `after` runs when the viewer exits or the replay ends.
 */
function watchReplay(code: string, after: () => void): void {
  const r = decodeReplay(code);
  const run = r && runReplay(r);
  if (!r || !run) return replayInvalid(after);
  const names = replayNames(r);
  const ctl = { speed: 1, paused: false };
  let view: BattleView | null = null;
  let container: HTMLElement;
  const leave = () => {
    view?.destroy();
    view = null;
    after();
  };
  const open = (round: number) => {
    view?.destroy();
    if (round > r.rounds.length) return leave();
    const k = round - 1;
    const source = new ReplayPlanSource(r.rounds);
    view = new BattleView(
      container,
      structuredClone(run.states[k]),
      [
        { name: names[0], source },
        { name: names[1], source },
      ],
      () => {
        view = null;
        after();
      },
      leave,
      {
        tag: replayTag(r),
        resume: { lastPlans: k ? run.log.rounds[k - 1].plans : null, log: { rounds: run.log.rounds.slice(0, k) } },
        replay: {
          rounds: r.rounds.length,
          speed: ctl.speed,
          paused: ctl.paused,
          onChange: (speed, paused) => Object.assign(ctl, { speed, paused }),
          seek: open,
          exit: leave,
        },
      },
    );
  };
  void versusSplash(r.fighters[0], r.fighters[1], names).then(() => {
    container = screen('', 'battle-screen');
    open(1);
  });
}

/** A recorded match: outcome, summary and Watch / Share buttons. */
function replayScreen(code: string, back: () => void): void {
  const r = decodeReplay(code);
  const run = r && runReplay(r);
  if (!r || !run) return replayInvalid(back);
  const names = replayNames(r);
  const recap: Recap = { replay: r, code, stats: matchStats(run.states[0], run.log), names };
  const self = () => replayScreen(code, back);
  const meta = [STRINGS.replays.modeNames[r.mode], getArena(r.arena).name, r.date].filter(Boolean).join(' · ');
  resultScreen(
    outcomeText(run.outcome, names),
    run.outcome.winner,
    r.fighters,
    [
      { label: STRINGS.replays.watch, primary: true, fn: () => watchReplay(code, self) },
      { label: STRINGS.replays.share, fn: () => void shareReplay(code) },
      { label: STRINGS.back, fn: back },
    ],
    `<p class="note">${meta}</p>${r.stale ? `<p class="note warn">${STRINGS.replays.stale}</p>` : ''}`,
    false,
    recap,
    [],
    false,
  );
}

/** Opened from a #replay= link: who played where, without giving away the result. */
function sharedReplay(code: string): void {
  const r = decodeReplay(code);
  if (!r || !runReplay(r)) return replayInvalid(title);
  const names = replayNames(r);
  const side = (i: number) => {
    const f = getFighter(r.fighters[i]);
    return `<div style="--clr:${f.color}">${portraitHtml(f)}<b>${f.name}</b><span>${names[i] === f.name ? '&nbsp;' : names[i]}</span></div>`;
  };
  const arena = getArena(r.arena);
  const mod = r.modifier ? MODIFIERS.find((m) => m.id === r.modifier) : null;
  const self = () => sharedReplay(code);
  const root = screen(
    `<h2>${STRINGS.replays.sharedTitle}</h2>
     <p class="note">${STRINGS.replays.sharedHint}</p>
     <div class="daily-vs">${side(0)}<span class="vs">vs</span>${side(1)}</div>
     ${mod ? `<div class="daily-rule"><small>${STRINGS.replays.rule}</small><b>${mod.name}</b><span>${mod.text}</span></div>` : ''}
     <div class="daily-rule arena">${arenaMiniHtml(arena)}<div><small>${STRINGS.arena}</small><b>${arena.name}</b><span>${arena.text}</span></div></div>
     ${r.stale ? `<p class="note warn">${STRINGS.replays.stale}</p>` : ''}
     <div class="row">
       <button class="btn primary" data-act="watch">${STRINGS.replays.watch}</button>
       <button class="btn" data-act="result">${STRINGS.replays.showResult}</button>
       <button class="btn ghost-btn" data-act="menu">${STRINGS.menu}</button>
     </div>`,
    'daily',
  );
  on(root, '[data-act="watch"]', () => watchReplay(code, () => replayScreen(code, self)));
  on(root, '[data-act="result"]', () => replayScreen(code, self));
  on(root, '[data-act="menu"]', title);
}

/** Open a #replay= link (on start, or pasted while the game is open). */
function openReplayLink(): boolean {
  const code = replayCodeFromHash();
  if (!code) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  sharedReplay(code);
  return true;
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
    onEnd: (outcome, _log, recap) => {
      if (outcome.winner !== 0) {
        resultScreen(outcomeText(outcome, names), outcome.winner, [fighterId, rival], [
          { label: STRINGS.retry, primary: true, fn: () => tournamentMatch(fighterId) },
          { label: STRINGS.menu, fn: () => tournamentHub(fighterId) },
        ], '', false, recap);
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
      ], extra, true, recap);
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
     <div class="daily-rule arena">${arenaMiniHtml(getArena(c.arena))}<div><small>${STRINGS.arena}</small><b>${getArena(c.arena).name}</b><span>${getArena(c.arena).text}</span></div></div>
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
    modifierId: c.modifier.id,
    arenaId: c.arena,
    options: { tag: c.modifier.name },
    onQuit: dailyScreen,
    onEnd: (outcome, _log, recap) => {
      const won = outcome.winner === 0;
      recordDaily(won ? 'win' : outcome.winner === null ? 'draw' : 'loss', date);
      if (won) play('win');
      const extra = `<p>${STRINGS.daily.streak(dailyStreak(), profile().daily.best)}</p>`;
      const share = recap ? [{ label: STRINGS.daily.share, fn: () => void shareDaily(date, outcome, recap.stats) }] : [];
      resultScreen(outcomeText(outcome, names), outcome.winner, [c.fighter, c.rival], [
        won ? { label: STRINGS.menu, primary: true, fn: title } : { label: STRINGS.retry, primary: true, fn: () => dailyMatch(date) },
        { label: STRINGS.daily.title, fn: dailyScreen },
      ], extra, won, recap, share);
    },
  });
}

/** The daily result as text with one square per round (no spoilers beyond the outcome). */
async function shareDaily(date: string, outcome: MatchOutcome, stats: MatchStats): Promise<void> {
  const c = dailyChallenge(date);
  const D = STRINGS.daily;
  const result = outcome.winner === 0 ? D.won(stats.rounds) : outcome.winner === null ? D.drew(stats.rounds) : D.lost(stats.rounds);
  const matchup = `${getFighter(c.fighter).name} vs ${getFighter(c.rival).name} · ${c.modifier.name}`;
  const text = D.shareText(date, matchup, tradeRow(stats.trades), result, dailyStreak());
  const url = gameUrl();
  afterShare(await shareOrCopy({ title: D.shareTitle, text, url }), `${text}\n${url}`);
}

// ---------- profile ----------

/** "Today 14:05", "Yesterday 09:12" or a short date. */
function whenText(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return `${STRINGS.replays.today} ${time}`;
  if (diff === 1) return `${STRINGS.replays.yesterday} ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function recentHtml(): string {
  const R = STRINGS.replays;
  const rows = recentMatches()
    .map((m, i) => {
      const r = decodeReplay(m.code);
      const run = r && runReplay(r);
      if (!r || !run) return '';
      const [fa, fb] = r.fighters.map(getFighter);
      const w = run.outcome.winner;
      const result = r.mode === 'hotseat' ? (w === null ? R.result.draw : R.wonBy(replayNames(r)[w])) : R.result[w === null ? 'draw' : w === 0 ? 'win' : 'loss'];
      const cls = r.mode === 'hotseat' || w === null ? 'draw' : w === 0 ? 'win' : 'loss';
      return `<li class="recent-row ${cls}" data-recent="${i}">
          <span class="recent-vs">${emblemHtml(fa, 'hud-emblem')}${emblemHtml(fb, 'hud-emblem')}</span>
          <span class="recent-text"><b>${result} · ${fa.name} vs ${fb.name}</b>
            <span>${R.modeNames[r.mode]} · ${R.roundsN(r.rounds.length)} · ${whenText(m.at)}</span></span>
          <button class="btn icon-ctl" data-watch="${i}" aria-label="${R.watchShort}" title="${R.watchShort}">▶\uFE0E</button>
          <button class="btn icon-ctl" data-share="${i}" aria-label="${R.shareShort}" title="${R.shareShort}">↗</button>
        </li>`;
    })
    .join('');
  return rows ? `<ul class="recent-list">${rows}</ul>` : `<p class="note">${R.noRecent}</p>`;
}

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
     <h3>${STRINGS.replays.recent}</h3>
     ${recentHtml()}
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
  const recent = recentMatches();
  root.querySelector('.recent-list')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('[data-recent]');
    if (!row) return;
    play('click');
    const code = recent[Number(row.dataset.recent)].code;
    if (t.closest('[data-watch]')) return watchReplay(code, profileScreen);
    if (t.closest('[data-share]')) return void shareReplay(code);
    replayScreen(code, profileScreen);
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
if (!openReplayLink()) title();
window.addEventListener('hashchange', () => void openReplayLink());
