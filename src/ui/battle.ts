import { duckMusic } from '../audio/music';
import { play } from '../audio/sfx';
import type { SoundId } from '../content/assets';
import { BALANCE } from '../content/balance';
import { getCard, getFighter } from '../content/cards';
import { STRINGS } from '../content/strings';
import {
  attackArea,
  autoFillPlan,
  canPlace,
  energyRecovery,
  fatigueAfterRound,
  fatigueDamage,
  heldCard,
  isSpent,
  faceTowards,
  movePos,
  partialPlanOk,
  placeIssue,
  planError,
  playerTrace,
  resolveRound,
  samePos,
  stepsPerRound,
} from '../engine/rules';
import type { PlaceIssue } from '../engine/rules';
import type { Facing, MatchLog, MatchOutcome, MatchState, Plan, Pos, RoundResult, Seat, StepResult, Trap } from '../engine/types';
import { markTipSeen, tipSeen } from '../meta/profile';
import type { PlanSource } from '../net/transport';
import { fullEffects, getPlanTimer, isInstantSelect, speedMultiplier } from '../settings';
import { cardHtml, describeCard, groupedCardsHtml, handRowLength, passiveHtml } from './card';
import { enableDrag } from './drag';
import { Fx, fxKind, haptic, retrigger, type FxKind } from './fx';
import { bindSettings, settingsHtml } from './settingsPanel';
import { themeColor } from './skin';
import { emblemHtml, tokenArtHtml } from './emblems';
import { beatCaption, beatStamp, endCaption, partLabel, roundTips, whyNotText } from './narrate';
import { closeTip, showTip } from './tips';

export interface BattleSeat {
  name: string;
  source: PlanSource;
}

/** Optional callbacks, used by the tutorial to coach the player. Async hooks are awaited. */
export interface BattleHooks {
  /** A human's planner is on screen and ready. */
  planStart?(view: BattleView, round: number, seat: Seat): void | Promise<void>;
  /** A human changed their plan. */
  planChanged?(view: BattleView, plan: Plan, seat: Seat): void;
  /** The round recap is on screen. */
  roundEnd?(view: BattleView, round: number, result: RoundResult): void | Promise<void>;
}

export interface BattleOptions {
  hooks?: BattleHooks;
  /** Ignore the plan timer setting (e.g. in the tutorial). */
  noTimer?: boolean;
  /** Always select a tapped card before adding it, whatever the Instant select setting (the tutorial's tips say "tap it again"). */
  confirmTap?: boolean;
  /** Short label under the round counter, e.g. the daily challenge's rule twist. */
  tag?: string;
  /** The guided tutorial: no round banners or first-time tips (it coaches by itself). */
  tutorial?: boolean;
  /** Continue a saved match: the previous round's plans and the log so far. */
  resume?: { lastPlans: [Plan, Plan] | null; log: MatchLog };
  /** Called at the start of every round, before anyone plans (used to save the match). */
  onRoundStart?: (state: MatchState, lastPlans: [Plan, Plan] | null, log: MatchLog) => void;
  /** Replay viewer: recorded plans play out with playback controls instead of the recap buttons. */
  replay?: ReplayControls;
}

/** Playback state and controls for the replay viewer (owned by whoever builds the view). */
export interface ReplayControls {
  /** Rounds in the whole replay. */
  rounds: number;
  /** One of REPLAY_SPEEDS. The view changes these two and reports them with onChange. */
  speed: number;
  paused: boolean;
  onChange(speed: number, paused: boolean): void;
  /** Restart playback at the start of this round (1-based); past the last round = the result. */
  seek(round: number): void;
  /** Play just the first round, over and over, with no previous/next buttons (the match summary's highlights). */
  single?: boolean;
  exit(): void;
}

export const REPLAY_SPEEDS = [1, 2, 4];

/** Free cards the plan timer uses to finish a plan, in order of preference. */
const AUTO_FILL = ['guard', 'up', 'down', 'left', 'right', 'focus'];

/**
 * What the battle screen is doing; drives which panels are visible (see styles.css).
 * plan: a human picks cards · wait: CPU thinking · pass: hot-seat hand-over
 * reveal: cards resolve step by step · summary: round recap.
 */
type Mode = 'idle' | 'plan' | 'wait' | 'pass' | 'reveal' | 'summary';

/** Base animation timings in ms at "normal" speed. */
const TIMING = { intro: 500, hit: 1000, energy: 900 };
/** Every card (in the reveal, the recap and replays) gets at least this long on the board at normal speed. */
const CARD_MS = 1700;
/** Pause between a card turning face up (or coming into the spotlight) and its effect. */
const READ_MS = 550;
/** How long a floating number or word stays up, and how far it rises meanwhile (the `rise` animation in styles.css). */
const FLOAT_MS = 2000;
const FLOAT_RISE = 36;
/** Texts over the same square start at least this far apart, one after another (ms at normal speed). */
const FLOAT_GAP = 320;
/** Space kept around each floating text (px). */
const FLOAT_PAD = 6;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Thrown by a recap's waits once it has been stopped or restarted. */
const CANCELLED = Symbol('cancelled');
/** Corner icon on a greyed-out card, by why it can't be planned (see placeIssue). */
const WHY_ICONS: Partial<Record<PlaceIssue['kind'], string>> = { energy: '⚡', later: '⚡', reload: '⟳', planted: '⊥' };

/** One-shot animations on a fighter's piece (class = keyframes name): one plays at a time (see tokenAnim). */
const TOKEN_ANIMS = ['hop', 'skid', 'lunge', 'hurt'];
/** Animation name → the class that plays it, taken off when it ends so lasting looks (the hex glow) come back. */
const ANIM_CLASS: Record<string, string> = { ...Object.fromEntries(TOKEN_ANIMS.map((a) => [a, a])), 'focus-glow': 'focusing' };

/** What the board and HUD show while a round plays, carried from card to card. */
interface BoardView {
  pos: [Pos, Pos];
  facing: [Facing, Facing];
  lives: [number, number];
  energies: [number, number];
}

/** The board and HUD as a round starts (the recap rewinds to this). */
interface RoundStart extends BoardView {
  traps: Trap[];
  hex: [number, number];
}

/** A fresh, independent copy of a round's starting view. */
const boardView = (s: BoardView): BoardView => ({
  pos: [{ ...s.pos[0] }, { ...s.pos[1] }],
  facing: [...s.facing],
  lives: [...s.lives],
  energies: [...s.energies],
});

/** How a step plays (see playStep): the reveal (live: sounds, haptics, cards flip) or the silent recap. */
interface Playback {
  live: boolean;
  /** Wait this many normal-speed ms (scaled by the speed settings; holds while paused). */
  wait(ms: number): Promise<void>;
  /** Real ms per normal-speed ms right now. */
  pace(): number;
}

/** Human input, fed by the planner UI below. */
export class HumanPlanSource implements PlanSource {
  readonly kind = 'human' as const;
  constructor(private battle: () => BattleView) {}
  requestPlan(state: MatchState, seat: Seat): Promise<Plan> {
    return this.battle().askHuman(state, seat);
  }
}

export class BattleView {
  private state: MatchState;
  private el: HTMLElement;
  private plan: Plan = [];
  private planSeat: Seat = 0;
  private resolvePlan: ((p: Plan) => void) | null = null;
  private hovered: { slot: number; card: string } | null = null;
  private previewCard: string | null = null;
  private paused = false;
  private destroyed = false;
  /** Both players' plans from the previous round (shown in the deck viewer). */
  private lastPlans: [Plan, Plan] | null = null;
  private log: MatchLog = { rounds: [] };
  private timerId: number | null = null;
  private coachHighlight: string | null = null;
  private fx!: Fx;
  /** Slow-motion factor for the knockout step. */
  private slow = 1;
  /** Bumped to cancel a running recap replay. */
  private replayRun = 0;
  /** Traps currently drawn on the board (to spot newly placed ones, and for tapping one). */
  private shownTraps: Trap[] = [];
  /** Floating texts still rising: their board row and width (px), when each started, how high it sits, how tall it is. */
  private floatsLive: { row: number; x0: number; x1: number; start: number; lift: number; h: number }[] = [];
  /** When the next floating text may start over each square (they come one after another). */
  private floatNext = new Map<string, number>();
  /** Hex on each fighter as drawn (it changes mid-reveal, before `state` catches up). */
  private shownHex: [number, number] = [0, 0];
  /** The round being revealed or recapped. */
  private shownRound = 0;
  /** Settles when this round's start banner has gone (the plan timer waits for it). */
  private bannerDone: Promise<void> = Promise.resolve();
  /** The round the recap plays (for its loop, the tap-a-card replay and restoring the stamps). */
  private recap: { result: RoundResult; start: RoundStart } | null = null;
  /** On touch, a tapped hand card is first only selected (previewed); a second tap adds it (unless Instant select is on). */
  private armed: string | null = null;
  /** Pointer type of the latest press, so a mouse click can still add a card straight away. */
  private lastPointer = 'mouse';

  constructor(
    private root: HTMLElement,
    initial: MatchState,
    private seats: [BattleSeat, BattleSeat],
    private onEnd: (outcome: MatchOutcome, state: MatchState, log: MatchLog) => void,
    private onQuit: () => void,
    private opts: BattleOptions = {},
  ) {
    this.state = initial;
    if (opts.resume) {
      this.lastPlans = opts.resume.lastPlans;
      this.log = opts.resume.log;
    }
    this.el = document.createElement('div');
    this.el.className = opts.replay ? 'battle replay' : 'battle';
    // A replay goes straight to the reveal layout (no zoom from the planning layout).
    if (opts.replay) this.el.dataset.mode = 'reveal';
    this.root.replaceChildren(this.el);
    this.renderShell();
    this.renderHud();
    this.setMode(opts.replay ? 'reveal' : 'idle');
    if (opts.replay) this.bindReplayControls();
    // Start after construction so plan sources can reference this view.
    setTimeout(() => void this.loop(), 0);
  }

  /** Sleep that respects the speed setting and holds while a menu or deck viewer is open. */
  private sleep(key: keyof typeof TIMING): Promise<void> {
    return this.hold(TIMING[key]);
  }

  /** Animation time factor: the speed setting, slow motion and the replay speed. */
  private pace(): number {
    return (speedMultiplier() * this.slow) / (this.opts.replay?.speed ?? 1);
  }

  private async hold(ms: number): Promise<void> {
    await wait(ms * this.pace());
    while ((this.paused || this.opts.replay?.paused) && !this.destroyed) await wait(100);
    // A view that was closed (quit, or a replay jumping to another round) never wakes up again.
    if (this.destroyed) await new Promise(() => undefined);
  }

  /** Stop everything (the screen is about to be replaced). */
  destroy(): void {
    this.destroyed = true;
    this.paused = false;
    this.replayRun++;
    this.stopTimer();
    closeTip();
    duckMusic(false);
  }

  private setMode(mode: Mode): void {
    // The reveal and recap use a different layout (the board grows); zoom the board between them.
    const playing = (m?: string) => m === 'reveal' || m === 'summary';
    const from = playing(this.el.dataset.mode) !== playing(mode) && fullEffects() ? this.q('.arena').getBoundingClientRect() : null;
    this.el.dataset.mode = mode;
    closeTip();
    this.el.querySelector('.status')?.classList.remove('why');
    if (from) this.zoomBoardFrom(from);
    if (mode !== 'plan') {
      // Never leave a planned path, planned energy or hover highlight for the other player to see.
      this.clearPath();
      this.clearAreas();
      this.showPlannedEnergy(null);
      this.stopTimer();
    }
  }

  /** Animate the board from its old box to where the new layout put it (FLIP). */
  private zoomBoardFrom(old: DOMRect): void {
    const arena = this.q('.arena');
    const now = arena.getBoundingClientRect();
    if (!old.width || !now.width || typeof arena.animate !== 'function') return;
    const s = old.width / now.width;
    if (Math.abs(s - 1) < 0.02 && Math.abs(old.left - now.left) < 2 && Math.abs(old.top - now.top) < 2) return;
    arena.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${old.left - now.left}px, ${old.top - now.top}px) scale(${s})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 380, easing: 'cubic-bezier(.2, .8, .3, 1)' },
    );
  }

  // ---------- main loop ----------

  private async loop(): Promise<void> {
    // A one-round replay starts that round over each time it ends.
    const again = this.opts.replay?.single ? structuredClone(this.state) : null;
    while (!this.state.outcome) {
      this.opts.onRoundStart?.(this.state, this.lastPlans, this.log);
      this.setRoundLabel();
      const plans: Plan[] = [];
      const bothHuman = this.seats.every((s) => s.source.kind === 'human');
      // The CPU starts thinking right away (in a worker), so it is usually done by the time you lock in.
      const early = ([0, 1] as Seat[]).map((seat) => {
        const src = this.seats[seat].source;
        return src.kind === 'cpu' ? src.requestPlan(this.state, seat, this.log) : null;
      });
      // From round 2: a short banner with what carries into this round.
      // The next screen comes up underneath it, tinted and out of reach until it goes.
      this.bannerDone = this.state.round > 1 && this.tipsOn() ? this.roundBanner() : Promise.resolve();
      for (const seat of [0, 1] as Seat[]) {
        const src = this.seats[seat].source;
        if (src.kind === 'human' && bothHuman) await this.passScreen(seat);
        if (src.kind === 'cpu' || src.kind === 'remote') {
          this.setMode('wait');
          this.q('.status').textContent = STRINGS.cpuThinking;
        }
        const plan = await (early[seat] ?? src.requestPlan(this.state, seat, this.log));
        if (this.destroyed) return;
        const err = planError(this.state.players[seat], plan);
        if (err) throw new Error(err);
        plans[seat] = plan;
      }
      if (bothHuman) await this.passScreen(null);
      await this.animateRound(plans as [Plan, Plan]);
      if (this.destroyed) return;
      if (again) {
        this.state = structuredClone(again);
        this.log = { rounds: [] };
        this.lastPlans = null;
        this.restoreBoard();
      }
    }
    this.onEnd(this.state.outcome!, this.state, this.log);
  }

  // ---------- static layout ----------

  private renderShell(): void {
    const A = this.state.arena;
    const tiles = Array.from({ length: A.rows * A.cols }, (_, i) => {
      const r = Math.floor(i / A.cols);
      const c = i % A.cols;
      if (A.blocked.includes(i)) return `<div class="tile blocked" data-r="${r}" data-c="${c}" title="${STRINGS.tileNames.blocked}"></div>`;
      const kind = A.tiles[i];
      const icon = kind ? `<span class="tile-icon">${STRINGS.tileIcons[kind]}</span>` : '';
      return `<div class="tile${kind ? ` tile-${kind}` : ''}" data-r="${r}" data-c="${c}"${kind ? ` title="${STRINGS.tileNames[kind]}" data-tip="${kind}"` : ''}>${icon}</div>`;
    }).join('');
    // Plain pieces in the player's colour (no fighter emblem); a reskin may still give them a picture.
    const tokens = this.state.players
      .map((p, i) => `<div class="token p${i}" data-seat="${i}" title="${this.seats[i].name}">
          <span class="token-ring"></span><span class="token-body">${tokenArtHtml(getFighter(p.fighterId))}</span><span class="facing"></span>
          <span class="hex-mark" title="${STRINGS.effectNames.hex}">${STRINGS.effectIcons.hex}</span></div>`)
      .join('');
    // Each player's cards for the round, one per step: face down until that step plays.
    const playCol = (i: number) => `<div class="play-col p${i}" data-seat="${i}">
        <span class="play-name">${this.seats[i].name}</span>
        <div class="play-cards">${Array.from(
          { length: BALANCE.slotsPerRound },
          (_, s) => `<div class="play-card face-down" data-step="${s}"><span class="play-step">${STRINGS.slot(s + 1)}</span><div class="play-face"></div></div>`,
        ).join('')}</div>
      </div>`;
    this.el.style.setProperty('--aspect', String(A.cols / A.rows));
    this.el.style.setProperty('--row-n', String(handRowLength(this.state.players[0].deck)));
    this.el.innerHTML = `
      <header class="hud">
        <div class="panel p0" data-seat="0"></div>
        <div class="hud-center">
          <div class="round-label"></div>
          <div class="step-label"></div>
          <div class="fatigue-tag hidden"></div>
          ${this.opts.tag ? `<div class="match-tag">${this.opts.tag}</div>` : ''}
          <button class="icon-btn" data-act="menu" aria-label="${STRINGS.menuTitle}">☰</button>
        </div>
        <div class="panel p1" data-seat="1"></div>
      </header>
      <div class="slots"></div>
      <div class="arena-wrap">
        <div class="arena" style="--rows:${A.rows};--cols:${A.cols};aspect-ratio:${A.cols} / ${A.rows}">
          ${tiles}
          <svg class="path" viewBox="0 0 ${A.cols} ${A.rows}" preserveAspectRatio="none"><polyline points=""></polyline></svg>
          ${'<div class="ghost hidden"></div>'.repeat(BALANCE.slotsPerRound)}
          ${tokens}
          <div class="fx-layer"></div>
          <div class="floats"></div>
        </div>
      </div>
      <div class="card-preview"></div>
      ${playCol(0)}${playCol(1)}
      <section class="planner">
        <div class="time-bar"></div>
        <div class="status-row">
          <div class="status"></div>
          <div class="plan-clock hidden" title="${STRINGS.planTimer}">
            <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"></circle><circle class="left" cx="18" cy="18" r="15.5" pathLength="100"></circle></svg>
            <b></b>
          </div>
        </div>
        <div class="hand grouped"></div>
        <div class="actions">
          <button class="btn ghost-btn" data-act="clear">${STRINGS.clear}</button>
          <button class="btn primary" data-act="lock">${STRINGS.lockIn}</button>
        </div>
      </section>
      <section class="pass"></section>
      <section class="summary"></section>
      <div class="coach hidden"><div class="coach-box"><p></p><button class="btn primary">${STRINGS.gotIt}</button></div></div>
      <div class="modal hidden"><div class="modal-box"></div></div>`;
    this.placeTokens(this.state.players.map((p) => p.pos) as [Pos, Pos]);
    this.fx = new Fx(this.q('.arena'), this.q('.fx-layer'));
    this.resetPlayCards();
    // The layout sizes everything from the space left under the HUD, so keep its height current.
    const hud = this.q('.hud');
    const measure = () => this.el.style.setProperty('--hud-h', `${hud.offsetHeight}px`);
    measure();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(hud);
    this.renderTraps(this.state.arena.traps);
    this.showHexes([this.state.players[0].hex, this.state.players[1].hex]);
    this.el.querySelectorAll<HTMLElement>('.token').forEach((t) =>
      t.addEventListener('animationend', (e) => {
        const cls = ANIM_CLASS[e.animationName];
        if (cls) t.classList.remove(cls);
      }),
    );

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.modal, .pass, .summary, .round-cover')) return;
      if (t.closest('[data-act="menu"]')) return this.openMenu();
      if (t.closest('.planner, .slots')) return this.onPlannerClick(e);
      // A fighter standing on a trap sits above it, so tapping that square opens the fighter.
      const trapEl = t.closest<HTMLElement>('.trap-mark');
      if (trapEl) return this.showTrap(Number(trapEl.dataset.at));
      // Icons explain themselves: card badges, status chips, square effects.
      const tipEl = t.closest<HTMLElement>('[data-tip]');
      if (tipEl) return showTip(tipEl.dataset.tip!, tipEl);
      const seatEl = t.closest<HTMLElement>('.token, .panel');
      if (seatEl) return this.showDeck(Number(seatEl.dataset.seat) as Seat);
      const cardEl = t.closest<HTMLElement>('.play-card');
      if (cardEl) this.onPlayCardTap(cardEl);
    });
    this.el.addEventListener('pointerdown', (e) => (this.lastPointer = e.pointerType), true);
    this.el.addEventListener('pointerover', (e) => {
      if ((e.target as HTMLElement).closest('.planner, .slots')) this.onPlannerHover(e);
    });
    for (const sel of ['.planner', '.slots']) {
      this.q(sel).addEventListener('pointerleave', (e) => {
        // Touch "leaves" right after every tap; keep its preview until the next touch.
        if ((e as PointerEvent).pointerType !== 'mouse') return;
        this.hovered = null;
        this.renderPreview();
      });
    }
    enableDrag(this.el, {
      source: (t) => (this.resolvePlan ? t.closest<HTMLElement>('.planner .hand .card[data-card], .slots .card[data-card]') : null),
      over: (under, src) => this.onDragOver(under, src),
      drop: (under, src) => this.onDrop(under, src),
      end: () => this.el.querySelectorAll('.slot').forEach((sl) => sl.classList.remove('drop-ok', 'drop-bad')),
    });
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private setRoundLabel(): void {
    const round = this.state.round;
    this.q('.round-label').textContent = STRINGS.round(round);
    // Warn one round ahead, then show the fatigue rule while it applies.
    const tag = this.q('.fatigue-tag');
    const after = fatigueAfterRound(this.state);
    tag.textContent = round > after ? STRINGS.fatigueTag(fatigueDamage(this.state)) : round === after ? STRINGS.fatigueSoon : '';
    tag.classList.toggle('hidden', round < after);
    tag.classList.toggle('active', round > after);
  }

  // ---------- HUD ----------

  private renderHud(lives?: [number, number], energies?: [number, number]): void {
    this.state.players.forEach((p, i) => {
      const f = getFighter(p.fighterId);
      const life = lives?.[i] ?? p.life;
      const energy = energies?.[i] ?? p.energy;
      const panel = this.q(`.panel.p${i}`);
      if (!panel.dataset.ready) {
        panel.innerHTML = `${emblemHtml(f, 'hud-emblem')}
          <div class="who"><b>${this.seats[i].name}</b><span>${f.name}</span><div class="status-chips"></div></div>
          <div class="bars">
            <div class="bar life"><b class="chip"></b><i></i><span></span></div>
            <div class="bar energy"><i></i><em class="planned"></em><span></span></div>
          </div>`;
        panel.style.setProperty('--clr', f.color);
        // One segment per 10 energy (10 segments for a standard 100 max).
        panel.querySelector<HTMLElement>('.bar.energy')!.style.setProperty('--seg', String(Math.max(1, Math.round(p.energyMax / 10))));
        panel.title = STRINGS.tapHint;
        panel.dataset.ready = '1';
      }
      const lb = panel.querySelector('.bar.life')!;
      const lifePct = `${(life / p.lifeMax) * 100}%`;
      (lb.querySelector('i') as HTMLElement).style.width = lifePct;
      // The pale "chip" trails behind so the damage just taken stays visible for a moment.
      (lb.querySelector('.chip') as HTMLElement).style.width = lifePct;
      // The number rides the end of the fill (see .bar span), so the bar tells it where that is.
      (lb as HTMLElement).style.setProperty('--pct', String((life / p.lifeMax) * 100));
      lb.querySelector('span')!.textContent = String(life);
      // Low on life: the bar pulses red.
      panel.classList.toggle('low', life > 0 && life <= p.lifeMax * 0.3);
      const eb = panel.querySelector('.bar.energy')!;
      (eb.querySelector('i') as HTMLElement).style.width = `${(energy / p.energyMax) * 100}%`;
      (eb as HTMLElement).style.setProperty('--pct', String((energy / p.energyMax) * 100));
      eb.querySelector('span')!.textContent = String(energy);
    });
    this.renderChips();
  }

  /** Status chips under each fighter's name: hex, stun, their traps on the board, spent shots. */
  private renderChips(): void {
    const chip = (key: string, text: string) => `<i class="chip-fx ${key}" data-tip="${key}">${text}</i>`;
    for (const i of [0, 1]) {
      const box = this.el.querySelector(`.panel.p${i} .status-chips`);
      if (!box) continue;
      const p = this.state.players[i];
      const traps = this.shownTraps.filter((t) => t.owner === i).length;
      const spent = p.mods.ammo ? p.spent.length : 0;
      box.innerHTML = [
        this.shownHex[i] ? chip('hex', `${STRINGS.effectIcons.hex}+${this.shownHex[i]}`) : '',
        this.q(`.token.p${i}`).classList.contains('dazed') ? chip('stun', STRINGS.effectIcons.stun) : '',
        traps ? chip('trap', `${STRINGS.effectIcons.trap}${traps}`) : '',
        spent ? chip('spent', `⟳${spent}`) : '',
      ].join('');
    }
  }

  /** Set the bars straight to these numbers, without sliding (the recap rewinding to a round's start). */
  private snapHud(lives: [number, number], energies: [number, number]): void {
    const panels = this.el.querySelectorAll<HTMLElement>('.hud .panel');
    panels.forEach((p) => p.classList.add('snap'));
    this.renderHud(lives, energies);
    void panels[0]?.offsetWidth; // apply the new widths before transitions come back
    requestAnimationFrame(() => panels.forEach((p) => p.classList.remove('snap')));
  }

  /** Striped segment on the planner's energy bar from current energy to what the plan leaves. */
  private showPlannedEnergy(after: number | null): void {
    this.el.querySelectorAll<HTMLElement>('.bar.energy .planned').forEach((el) => (el.style.display = 'none'));
    if (after === null) return;
    const p = this.state.players[this.planSeat];
    if (after === p.energy) return;
    const el = this.q(`.panel.p${this.planSeat} .bar.energy .planned`);
    const lo = Math.min(after, p.energy) / p.energyMax;
    const hi = Math.max(after, p.energy) / p.energyMax;
    el.style.display = 'block';
    // Player 2's bars fill from the right.
    el.style.left = this.planSeat === 0 ? `${lo * 100}%` : '';
    el.style.right = this.planSeat === 1 ? `${lo * 100}%` : '';
    el.style.width = `${(hi - lo) * 100}%`;
    el.classList.toggle('gain', after > p.energy);
  }

  // ---------- board ----------

  /** The hex mark on each fighter's token. */
  private showHexes(hex: [number, number]): void {
    hex.forEach((h, i) => this.setHex(i, h));
  }

  private setHex(seat: number, hex: number): void {
    this.shownHex[seat] = hex;
    this.q(`.token.p${seat}`).classList.toggle('hexed', hex > 0);
    this.renderChips();
  }

  /** Mark (or clear) a fighter as stunned: their next card is cancelled. */
  private setDazed(seat: number, on: boolean): void {
    this.q(`.token.p${seat}`).classList.toggle('dazed', on);
    this.renderChips();
  }

  /** The caption line under the board: what the card playing now does. */
  private setCaption(text: string): void {
    const el = this.el.querySelector('.summary .caption');
    if (el) el.textContent = text;
  }

  /** Stamp a played card with its outcome, replacing any earlier stamp. */
  private stamp(seat: number, slot: number, kind: string, text: string): void {
    const face = this.playCard(seat, slot).querySelector('.play-face')!;
    face.querySelector('.play-stamp')?.remove();
    const el = document.createElement('span');
    el.className = `play-stamp ${kind}`;
    el.textContent = text;
    face.appendChild(el);
  }

  /** Every played card of the recapped round with its stamp (after the recap stops part-way). */
  private stampAll(): void {
    for (const step of this.recap?.result.steps ?? []) {
      for (const i of [0, 1] as Seat[]) {
        const st = beatStamp(step, i);
        if (st) this.stamp(i, step.slot, st.kind, st.text);
      }
    }
  }

  /** Banners and first-time tips: real matches only (the tutorial coaches by itself). */
  private tipsOn(): boolean {
    return !this.opts.tutorial && !this.opts.replay;
  }

  /** A short banner as a round starts: the round number and what carries into it. */
  private async roundBanner(): Promise<void> {
    const B = STRINGS.banner;
    const st = this.state;
    const names = [this.seats[0].name, this.seats[1].name];
    const gain = st.players.map(energyRecovery);
    const lines = [gain[0] === gain[1] ? B.energy(gain[0]) : B.energyEach(names[0], gain[0], names[1], gain[1])];
    if (st.arena.traps.some((t) => t.until === st.round)) lines.push(B.trapsFade);
    st.players.forEach((p, i) => {
      if (p.hex) lines.push(B.hexed(names[i], p.hex));
      if (p.dazed && heldCard(p)) lines.push(B.stunned(names[i]));
    });
    const after = fatigueAfterRound(st);
    if (st.round === after) lines.push(B.fatigueSoon);
    else if (st.round > after) lines.push(B.fatigue(fatigueDamage(st)));
    const cover = document.createElement('div');
    cover.className = 'round-cover';
    cover.innerHTML = `<div class="round-banner"><b>${STRINGS.round(st.round)}</b>${lines.map((l) => `<span>${l}</span>`).join('')}</div>`;
    this.el.appendChild(cover);
    // Gone after a moment, or at a tap.
    await new Promise<void>((res) => {
      cover.addEventListener('click', () => res());
      void this.hold(1800).then(res);
    });
    cover.classList.add('out');
    setTimeout(() => cover.remove(), 260);
  }

  /** Play a one-shot animation on a fighter's piece, cutting off any other one still playing. */
  private tokenAnim(seat: number, cls: string): void {
    const t = this.q(`.token.p${seat}`);
    t.classList.remove(...TOKEN_ANIMS);
    retrigger(t, cls);
  }

  /**
   * The fighter whose card is playing lights up with it (a ring on the piece, its HUD panel); an
   * attacker also grows while its target dims.
   */
  private actingFx(seat: number, attack: boolean): void {
    const t = this.q(`.token.p${seat}`);
    t.classList.add('playing');
    t.classList.toggle('attacking', attack);
    this.q(`.panel.p${seat}`).classList.add('acting');
    this.q(`.token.p${seat === 0 ? 1 : 0}`).classList.toggle('dimmed', attack);
  }

  /**
   * A fighter takes damage: a red flash on the piece (knocked away from `from`, if a fighter hit it)
   * and a jolt on its HUD panel.
   */
  private hurtFx(seat: number, at: Pos, from: Pos | null): void {
    const t = this.q(`.token.p${seat}`);
    // Knocked away from the attacker; on the same column, back from the way it faces.
    const away = from ? Math.sign(at.c - from.c) || (t.classList.contains('face-left') ? 1 : -1) : 0;
    t.style.setProperty('--kx', String(away));
    this.tokenAnim(seat, 'hurt');
    if (from) this.fx.ring(at, 'impact');
    retrigger(this.q(`.panel.p${seat}`), 'hurt');
  }

  /** Pop a player's card for this step: its effect is happening on the board right now. */
  private cardActs(seat: number, slot: number): void {
    retrigger(this.playCard(seat, slot), 'acting');
  }

  private placeTokens(pos: [Pos, Pos], facing?: [number, number]): void {
    const shared = pos[0].r === pos[1].r && pos[0].c === pos[1].c;
    for (const i of [0, 1]) {
      const t = this.q(`.token.p${i}`);
      t.style.setProperty('--r', String(pos[i].r));
      t.style.setProperty('--c', String(pos[i].c));
      t.classList.toggle('shared', shared);
      const f = facing?.[i] ?? this.state.players[i].facing;
      t.classList.toggle('face-left', f === -1);
    }
  }

  /** Put the tokens somewhere instantly (no sliding), e.g. when a replay starts over. */
  private snapTokens(pos: [Pos, Pos], facing?: [number, number]): void {
    const tokens = this.el.querySelectorAll<HTMLElement>('.token');
    tokens.forEach((t) => t.classList.add('snap'));
    this.placeTokens(pos, facing);
    void tokens[0]?.offsetWidth; // apply the new position before transitions come back
    requestAnimationFrame(() => tokens.forEach((t) => t.classList.remove('snap')));
  }

  /** Clear highlighted squares, and the attacker and target marks that go with an attack's squares. */
  private clearAreas(): void {
    this.el
      .querySelectorAll('.token.playing, .token.attacking, .token.dimmed, .panel.acting')
      .forEach((e) => e.classList.remove('playing', 'attacking', 'dimmed', 'acting'));
    this.el.querySelectorAll<HTMLElement>('.tile').forEach((t) => {
      t.classList.remove('area-p0', 'area-p1', 'move-target', 'preview', 'preview-atk', 'preview-move', 'preview-trap', 'fx-slash', 'fx-burst', 'fx-wave', 'fx-beam', 'fx-quake');
      t.style.removeProperty('--d');
      t.style.removeProperty('--sx');
    });
  }

  /**
   * Show the traps on the board, marked in their owner's colour. With `announce`, traps that weren't
   * shown before pop in; returns whether there were any.
   */
  private renderTraps(traps: Trap[], announce = false): boolean {
    const key = (t: Trap) => `${t.at}:${t.owner}`;
    const shown = new Set(this.shownTraps.map(key));
    const fresh = new Set(announce ? traps.filter((t) => !shown.has(key(t))).map(key) : []);
    this.shownTraps = traps.map((t) => ({ ...t }));
    this.el.querySelectorAll('.trap-mark').forEach((m) => m.remove());
    const cols = this.state.arena.cols;
    for (const t of traps) {
      const tile = this.q(`.tile[data-r="${Math.floor(t.at / cols)}"][data-c="${t.at % cols}"]`);
      // Covers the whole square, quietly; tapping it explains the trap (see showTrap).
      const mark = document.createElement('span');
      mark.className = `trap-mark p${t.owner}${fresh.has(key(t)) ? ' new' : ''}`;
      mark.dataset.at = String(t.at);
      mark.title = `${STRINGS.effectNames.trap} ${t.damage}`;
      mark.innerHTML = `<b>${STRINGS.effectIcons.trap} ${t.damage}</b>`;
      tile.appendChild(mark);
    }
    this.renderChips();
    return fresh.size > 0;
  }

  /** What the traps on a square do, and whose they are. */
  private showTrap(at: number): void {
    const traps = this.shownTraps.filter((t) => t.at === at);
    if (!traps.length) return;
    play('click');
    const T = STRINGS.trapInfo;
    const who = (seat: number) => `<b class="seat-name p${seat}">${this.seats[seat].name}</b>`;
    const info = traps
      .map((t) => {
        const victim = t.owner === 0 ? 1 : 0;
        return `<div class="trap-info p${t.owner}">
          <p>${T.text(who(t.owner), who(victim), t.damage)}</p>
          <p>${T.breaks(who(victim))}</p>
          <p class="trap-until">${T.lasts(t.until)}</p>
        </div>`;
      })
      .join('');
    this.openModal(
      `<h2>${STRINGS.effectIcons.trap} ${T.title}</h2>${info}<button class="btn" data-modal="close">${STRINGS.close}</button>`,
    );
  }

  /** Highlight squares. Attack areas light up outward from the attacker in the card's style. */
  private showArea(cells: Pos[], cls: string, origin?: Pos, kind?: FxKind): void {
    for (const p of cells) {
      const tile = this.q(`.tile[data-r="${p.r}"][data-c="${p.c}"]`);
      tile.classList.add(cls);
      if (!origin || !kind) continue;
      tile.classList.add(`fx-${kind}`);
      tile.style.setProperty('--d', String(Math.max(Math.abs(p.r - origin.r), Math.abs(p.c - origin.c))));
      tile.style.setProperty('--sx', String(Math.sign(p.c - origin.c) || 1));
    }
  }

  /** Rising text over a square. `stack` offsets extra labels so they don't overlap. */
  /**
   * Rising text over a square (a fighter's damage, energy, status...). Texts never overlap: over the
   * same square each starts a moment after the one before it, and every text starts at the lowest
   * height clear of the texts still rising in its row that it would touch (wide ones reach over the
   * next square). They all rise at the same speed, so they stay apart. `more` adds lines under the
   * text that belong with it (a hit's bonus damage), each in its own style.
   */
  private floatText(pos: Pos, text: string, cls: string, amount = 0, more: { text: string; cls: string }[] = []): void {
    const key = `${pos.r},${pos.c}`;
    const now = performance.now();
    const at = Math.max(now, this.floatNext.get(key) ?? 0);
    this.floatNext.set(key, at + FLOAT_GAP * Math.min(1, this.pace()));
    const show = (tries = 0) => {
      if (this.destroyed) return;
      const f = document.createElement('div');
      f.className = `float ${cls}`;
      const label = document.createElement('span');
      if (more.length) {
        for (const l of [{ text, cls: '' }, ...more]) {
          const line = document.createElement('span');
          line.className = `line ${l.cls}`.trim();
          line.textContent = l.text;
          label.appendChild(line);
        }
      } else label.textContent = text;
      f.appendChild(label);
      // Bigger hits get bigger numbers.
      f.style.setProperty('--size', String(1 + Math.min(amount, 60) / 80));
      f.style.setProperty('--r', String(pos.r));
      f.style.setProperty('--c', String(pos.c));
      this.q('.floats').appendChild(f);
      // Its size (offset sizes ignore the pop-in scale) and where it spans across the board.
      const h = label.offsetHeight;
      const arena = this.q('.arena');
      const cellW = (arena.clientWidth - 8) / this.state.arena.cols;
      const cellH = (arena.clientHeight - 8) / this.state.arena.rows;
      const cx = 4 + (pos.c + 0.5) * cellW;
      const x0 = cx - label.offsetWidth / 2 - FLOAT_PAD;
      const x1 = cx + label.offsetWidth / 2 + FLOAT_PAD;
      const t = performance.now();
      this.floatsLive = this.floatsLive.filter((x) => t - x.start < FLOAT_MS);
      // Where the texts it would touch are now (bottom, top, in px above this text's start line); a
      // text from a lower row has risen toward this one, one from a higher row starts a square up.
      const spans = this.floatsLive
        .filter((x) => x.x1 > x0 && x.x0 < x1)
        .map((x) => {
          const y = (pos.r - x.row) * cellH + x.lift + (FLOAT_RISE * (t - x.start)) / FLOAT_MS;
          return { lo: y, hi: y + x.h };
        })
        .sort((p, q) => p.lo - q.lo);
      // The lowest height that clears them all, so the texts stay close to the piece.
      let lift = 0;
      for (const { lo, hi } of spans) {
        if (lift + h + FLOAT_PAD <= lo) break;
        lift = Math.max(lift, hi + FLOAT_PAD);
      }
      // No room within a square above the piece: wait a moment for the others to rise.
      if (lift > cellH && tries < 10) {
        f.remove();
        setTimeout(() => show(tries + 1), 160);
        return;
      }
      this.floatsLive.push({ row: pos.r, x0, x1, start: t, lift, h });
      f.style.setProperty('--lift', `${lift}px`);
      setTimeout(() => f.remove(), FLOAT_MS);
    };
    if (at > now) setTimeout(() => show(), at - now);
    else show();
  }

  // ---------- overlays ----------

  /** Hot-seat hand-over. Board and stats stay visible; only the card area is replaced. */
  private passScreen(seat: Seat | null): Promise<void> {
    this.setMode('pass');
    const pass = this.q('.pass');
    const title = seat === null ? STRINGS.reveal : STRINGS.passDevice(this.seats[seat].name);
    const hint = seat === null ? '' : `<p>${STRINGS.passDeviceHint}</p>`;
    pass.dataset.seat = seat === null ? '' : String(seat);
    pass.innerHTML = `<h2>${title}</h2>${hint}<button class="btn primary huge">${STRINGS.ready}</button>`;
    return new Promise((res) => {
      pass.querySelector('button')!.addEventListener('click', () => {
        play('click');
        this.setMode('idle');
        res();
      });
    });
  }

  private openModal(html: string, bind: (box: HTMLElement) => void = () => undefined): void {
    const modal = this.q('.modal');
    const box = modal.querySelector<HTMLElement>('.modal-box')!;
    box.innerHTML = html;
    modal.classList.remove('hidden');
    this.paused = true;
    duckMusic(true);
    const close = () => {
      modal.classList.add('hidden');
      this.paused = false;
      duckMusic(false);
    };
    modal.onclick = (e) => {
      if (e.target === modal) close();
    };
    box.querySelectorAll<HTMLElement>('[data-modal="close"]').forEach((b) =>
      b.addEventListener('click', () => {
        play('click');
        close();
      }),
    );
    bind(box);
  }

  private showDeck(seat: Seat): void {
    play('click');
    const p = this.state.players[seat];
    const f = getFighter(p.fighterId);
    this.openModal(
      `<div class="deck-head" style="--clr:${f.color}">${emblemHtml(f, 'hud-emblem')}<h2>${STRINGS.deckOf(this.seats[seat].name, f.name)}</h2></div>
       ${this.statusHtml(seat)}
       ${passiveHtml(f)}
       ${
         this.lastPlans
           ? `<h3>${STRINGS.lastRound}</h3><div class="hand last-round">${this.lastPlans[seat]
               .slice(0, stepsPerRound(this.state)) // Two-tap: the held-over card stays secret
               .map((id) => cardHtml(id, { facing: p.facing, small: true, readonly: true }))
               .join('')}</div>`
           : ''
       }
       <div class="hand grouped" style="--row-n:${handRowLength(p.deck)}">${groupedCardsHtml(p.deck, (id) => cardHtml(id, { facing: p.facing, readonly: true, spent: isSpent(p, id) }))}</div>
       <button class="btn" data-modal="close">${STRINGS.close}</button>`,
      (box) =>
        box.addEventListener('click', (e) => {
          const tip = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
          if (tip) showTip(tip.dataset.tip!, tip);
        }),
    );
  }

  /** The status effects on a fighter right now, as the board shows them (empty if none). */
  private statusHtml(seat: Seat): string {
    const S = STRINGS.status;
    const name = this.seats[seat].name;
    const rows: string[] = [];
    const hex = this.shownHex[seat];
    if (hex > 0) rows.push(`<p class="status-fx hex"><b>${STRINGS.effectIcons.hex} ${S.hex}</b> ${S.hexText(name, hex)}</p>`);
    if (this.q(`.token.p${seat}`).classList.contains('dazed')) {
      rows.push(`<p class="status-fx stun"><b>${STRINGS.effectIcons.stun} ${S.stun}</b> ${S.stunText(name)}</p>`);
    }
    return rows.length ? `<div class="status-list"><h3>${S.title}</h3>${rows.join('')}</div>` : '';
  }

  private openMenu(): void {
    play('click');
    this.openModal(
      `<h2>${STRINGS.menuTitle}</h2>
       <div class="menu-list">
         <button class="btn primary" data-modal="close">${STRINGS.resume}</button>
         ${settingsHtml()}
         <details class="menu-rules"><summary>${STRINGS.howToPlay}</summary><ol class="rules">${this.rules()
           .map((r) => `<li>${r}</li>`)
           .join('')}</ol></details>
         <button class="btn danger" data-m="quit">${this.opts.replay ? STRINGS.replays.exit : STRINGS.quit}</button>
       </div>`,
      (box) => {
        bindSettings(box);
        box.querySelector('[data-m="quit"]')!.addEventListener('click', () => {
          play('click');
          this.destroy();
          this.onQuit();
        });
      },
    );
  }

  /** How-to-play lines for the pause menu, with the Two-tap rule first in a Two-tap match. */
  private rules(): string[] {
    return this.state.variant === 'twoTap' ? [STRINGS.twoTap.rule, ...STRINGS.rules] : STRINGS.rules;
  }

  // ---------- human planning ----------

  askHuman(state: MatchState, seat: Seat): Promise<Plan> {
    this.state = state;
    this.planSeat = seat;
    this.plan = Array(BALANCE.slotsPerRound).fill('');
    // Two-tap: the card locked in last round fills the first slot and can't be changed.
    const held = heldCard(state.players[seat]);
    if (held) this.plan[0] = held;
    this.hovered = null;
    this.previewCard = null;
    this.armed = null;
    this.el.dataset.seat = String(seat);
    this.q('.status').textContent = this.planningText();
    this.setMode('plan');
    return new Promise((res) => {
      this.resolvePlan = res;
      this.renderPlanner();
      void (async () => {
        await this.opts.hooks?.planStart?.(this, state.round, seat);
        await this.bannerDone;
        if (held && this.tipsOn() && !tipSeen('twoTap') && this.resolvePlan === res) {
          await this.coach(STRINGS.firstTips.twoTap);
          markTipSeen('twoTap');
        }
        if (this.resolvePlan === res) this.startTimer();
      })();
    });
  }

  /** Commit the current plan (it must be complete and legal). */
  private lockIn(): void {
    const me = this.state.players[this.planSeat];
    if (!this.resolvePlan || planError(me, this.plan)) return play('deny');
    play('click');
    const res = this.resolvePlan;
    this.resolvePlan = null;
    this.setMode('idle');
    res([...this.plan]);
  }

  private setPlan(plan: Plan): void {
    this.plan = plan;
    this.hovered = null;
    this.armed = null;
    this.renderPlanner();
    this.opts.hooks?.planChanged?.(this, [...plan], this.planSeat);
  }

  // ---------- plan timer ----------

  /**
   * Plan timer: a ring countdown next to the planner title and a bar draining across the top of
   * the planner, both turning red and pulsing for the last 10 seconds.
   */
  private startTimer(): void {
    const total = this.opts.noTimer ? 0 : getPlanTimer();
    if (!total) return;
    const planner = this.q('.planner');
    const clock = this.q('.plan-clock');
    const ring = clock.querySelector('.left')!;
    let left = total * 1000;
    let lastSecond = Math.ceil(left / 1000);
    planner.classList.add('timed');
    clock.classList.remove('hidden');
    const tick = 250;
    const update = () => {
      const t = left / (total * 1000);
      planner.style.setProperty('--t', String(t));
      ring.setAttribute('stroke-dasharray', `${(t * 100).toFixed(1)} 100`);
      const sec = Math.ceil(left / 1000);
      clock.querySelector('b')!.textContent = String(sec);
      planner.classList.toggle('urgent', sec <= 10);
      if (sec !== lastSecond && sec <= 10 && sec > 0) play('tick');
      lastSecond = sec;
    };
    update();
    this.timerId = window.setInterval(() => {
      if (this.paused || this.coachOpen()) return;
      left -= tick;
      update();
      if (left > 0) return;
      this.stopTimer();
      const me = this.state.players[this.planSeat];
      this.plan = autoFillPlan(me, this.plan, AUTO_FILL);
      this.renderPlanner();
      this.lockIn();
    }, tick);
  }

  private stopTimer(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
    const planner = this.el.querySelector<HTMLElement>('.planner');
    if (!planner) return;
    planner.classList.remove('timed', 'urgent');
    planner.style.removeProperty('--t');
    this.q('.plan-clock').classList.add('hidden');
  }

  // ---------- coaching (tutorial) ----------

  private coachOpen(): boolean {
    return !this.q('.coach').classList.contains('hidden');
  }

  /** Show a tip over the screen; resolves when the player taps "Got it". */
  coach(text: string): Promise<void> {
    const box = this.q('.coach');
    box.querySelector('p')!.textContent = text;
    box.classList.remove('hidden');
    return new Promise((res) => {
      box.querySelector('button')!.onclick = () => {
        play('click');
        box.classList.add('hidden');
        res();
      };
    });
  }

  /** Pulse the elements matching `selector` (re-applied after every planner render). */
  setHighlight(selector: string | null): void {
    this.coachHighlight = selector;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    this.el.querySelectorAll('.coach-hl').forEach((e) => e.classList.remove('coach-hl'));
    if (this.coachHighlight) this.el.querySelectorAll(this.coachHighlight).forEach((e) => e.classList.add('coach-hl'));
  }

  /** Why `id` can't go into `slot` of `plan` right now, in words (null if it can). */
  private whyNot(id: string, plan = this.plan, slot = this.nextEmptySlot()): string | null {
    const issue = placeIssue(this.state.players[this.planSeat], plan, slot, id);
    return issue && whyNotText(issue, getCard(id).name);
  }

  /** Refuse a card: a buzz, and the reason in the status line. */
  private deny(id: string, plan?: Plan, slot?: number): void {
    play('deny');
    const why = this.whyNot(id, plan, slot);
    if (why) this.setStatus(why, true);
  }

  /** The planner's status line; a reason a card can't be planned reads as a plain sentence. */
  private setStatus(text: string, why = false): void {
    const el = this.q('.status');
    el.textContent = text;
    el.classList.toggle('why', why);
  }

  private nextEmptySlot(): number {
    return this.plan.findIndex((id) => !id);
  }

  /** "P1: plan your 3 moves" (2 when a Two-tap card is already locked in). */
  private planningText(): string {
    return STRINGS.planning(this.seats[this.planSeat].name, BALANCE.slotsPerRound - (this.isLocked(0) ? 1 : 0));
  }

  /** Two-tap: is this slot the card locked in last round (it can't be moved or removed)? */
  private isLocked(slot: number): boolean {
    return slot === 0 && !!heldCard(this.state.players[this.planSeat]);
  }

  private renderPlanner(): void {
    const me = this.state.players[this.planSeat];
    const facings = this.projectedPath().facing;
    const trace = playerTrace(me, this.plan);
    const twoTap = this.state.variant === 'twoTap';
    const steps = stepsPerRound(this.state);
    this.q('.slots').innerHTML = this.plan
      .map((id, i) => {
        const inner = id ? cardHtml(id, { facing: facings[i], small: true }) : `<span class="empty"><b>${i + 1}</b>${STRINGS.emptySlot}</span>`;
        const next = i === this.nextEmptySlot() ? ' next' : '';
        const energy = id && trace ? `<span class="slot-energy" title="${STRINGS.energyAfter}">⚡ ${trace[i]}</span>` : '';
        // Two-tap: the first slot holds last round's locked-in card; the last one plays next round.
        const locked = this.isLocked(i);
        const cls = locked ? ' locked' : twoTap && i === steps ? ' held-next' : '';
        const label = locked ? STRINGS.twoTap.locked : twoTap && i === steps ? STRINGS.twoTap.nextRound : STRINGS.slot(i + 1);
        const stun = locked && me.dazed ? `<span class="play-tag">${STRINGS.stunned}</span>` : '';
        const chip = cls ? `<span class="slot-chip" title="${locked ? STRINGS.twoTap.locked : STRINGS.twoTap.heldTitle}">${locked ? '🔒' : '⏭'}</span>` : '';
        return `<div class="slot${next}${cls}" data-slot="${i}"><span class="slot-label">${label}</span>${inner}${energy}${chip}${stun}</div>`;
      })
      .join('');
    const filled = this.plan.some(Boolean);
    this.showPlannedEnergy(filled && trace ? trace[trace.length - 1] : null);
    const target = this.nextEmptySlot();
    this.el.style.setProperty('--row-n', String(handRowLength(me.deck)));
    this.q('.hand').innerHTML = groupedCardsHtml(me.deck, (id) => {
      const used = this.plan.includes(id);
      const ok = target >= 0 && canPlace(me, this.plan, target, id);
      const issue = !ok && !used && target >= 0 ? placeIssue(me, this.plan, target, id) : null;
      const why = issue ? WHY_ICONS[issue.kind] : undefined;
      return cardHtml(id, { facing: facings[Math.max(0, target)], disabled: used || !ok, selected: used, spent: isSpent(me, id), why });
    });
    this.q<HTMLButtonElement>('[data-act="lock"]').disabled = planError(me, this.plan) !== null;
    const armedOk = !!this.armed && target >= 0 && canPlace(me, this.plan, target, this.armed);
    if (this.armed) this.q('.hand').querySelector(`.card[data-card="${this.armed}"]`)?.classList.add('armed');
    // A selected card that can't be planned says why.
    const why = !armedOk && this.armed ? this.whyNot(this.armed) : null;
    this.setStatus(armedOk ? STRINGS.tapAgainToAdd(getCard(this.armed!).name) : why || this.planningText(), !!why);
    this.renderPreview();
    this.renderPreviewPanel();
    this.applyHighlight();
  }

  /** Walk our own plan assuming the opponent stays put; returns positions after each slot. */
  private projectedPath(): { pos: Pos[]; facing: (1 | -1)[] } {
    const me = this.state.players[this.planSeat];
    const them = this.state.players[this.planSeat === 0 ? 1 : 0];
    let pos = { ...me.pos };
    let facing = me.facing;
    const out = { pos: [] as Pos[], facing: [] as (1 | -1)[] };
    for (const id of this.plan) {
      if (id) pos = movePos(this.state.arena, pos, getCard(id), facing);
      facing = faceTowards(pos, them.pos, facing);
      out.pos.push({ ...pos });
      out.facing.push(facing);
    }
    return out;
  }

  private clearPath(): void {
    this.el.querySelectorAll('.ghost').forEach((g) => g.classList.add('hidden'));
    this.q('.path polyline').setAttribute('points', '');
  }

  /**
   * Silhouettes where the plan takes you (red where you attack) joined by a dotted line,
   * assuming the opponent stays put.
   */
  private renderPath(path: { pos: Pos[] }): void {
    this.clearPath();
    const me = this.state.players[this.planSeat];
    const marks: { pos: Pos; attack: boolean }[] = [];
    let prev = me.pos;
    const line = [me.pos];
    this.plan.forEach((id, i) => {
      if (!id) return;
      const pos = path.pos[i];
      const attack = getCard(id).kind === 'attack';
      if (samePos(pos, prev) && !attack) return;
      const same = marks.find((m) => samePos(m.pos, pos));
      if (same) same.attack ||= attack;
      else marks.push({ pos, attack });
      if (!samePos(pos, line[line.length - 1])) line.push(pos);
      prev = pos;
    });
    const ghosts = this.el.querySelectorAll<HTMLElement>('.ghost');
    marks.slice(0, ghosts.length).forEach((m, k) => {
      const g = ghosts[k];
      g.style.setProperty('--r', String(m.pos.r));
      g.style.setProperty('--c', String(m.pos.c));
      g.classList.toggle('atk', m.attack);
      g.classList.remove('hidden');
    });
    if (line.length > 1) {
      this.q('.path polyline').setAttribute('points', line.map((p) => `${p.c + 0.5},${p.r + 0.5}`).join(' '));
    }
  }

  /** Board highlight for the hovered card plus the planned path. */
  private renderPreview(): void {
    // Only while a human is planning; never touch the board during the reveal animation.
    if (!this.resolvePlan) return;
    this.clearAreas();
    const path = this.projectedPath();
    this.renderPath(path);
    if (!this.hovered) return;
    const { slot, card } = this.hovered;
    const me = this.state.players[this.planSeat];
    const them = this.state.players[this.planSeat === 0 ? 1 : 0];
    const before = slot === 0 ? me.pos : path.pos[slot - 1];
    const facingBefore = slot === 0 ? me.facing : path.facing[slot - 1];
    const c = getCard(card);
    const pos = movePos(this.state.arena, before, c, facingBefore);
    const facing = faceTowards(pos, them.pos, facingBefore);
    // Same colour language as the cards: red = where an attack hits, blue = where a move lands.
    const cls = c.kind === 'attack' ? 'preview-atk' : c.kind === 'trap' ? 'preview-trap' : c.kind === 'move' ? 'preview-move' : 'preview';
    const squares = c.kind === 'attack' || c.kind === 'trap' ? attackArea(this.state.arena, c, pos, facing) : [pos];
    this.showArea(squares, cls);
  }

  private instantSelect(): boolean {
    return !this.opts.confirmTap && isInstantSelect();
  }

  /** Side panel with the focused card shown large and described in words. */
  private renderPreviewPanel(): void {
    const panel = this.q('.card-preview');
    if (!this.previewCard) {
      const hint = this.instantSelect() ? STRINGS.previewHintInstant : STRINGS.previewHint;
      panel.innerHTML = `<p class="preview-hint">${hint}</p><p class="preview-hint">${STRINGS.previewHint2}</p>`;
      return;
    }
    const slot = this.hovered?.slot ?? Math.max(0, this.nextEmptySlot());
    const facing = this.projectedPath().facing[slot] ?? this.state.players[this.planSeat].facing;
    const desc = describeCard(this.previewCard);
    panel.innerHTML = cardHtml(this.previewCard, { facing, readonly: true }) + (desc ? `<p class="desc">${desc}</p>` : '');
  }

  private onPlannerHover(e: Event): void {
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (!cardEl) return;
    const id = cardEl.dataset.card!;
    const slotEl = cardEl.closest<HTMLElement>('[data-slot]');
    const slot = slotEl ? Number(slotEl.dataset.slot) : this.nextEmptySlot();
    if (slot >= 0) this.hovered = { slot, card: id };
    if (this.previewCard !== id) {
      this.previewCard = id;
      this.renderPreviewPanel();
    }
    this.renderPreview();
  }

  private onPlannerClick(e: Event): void {
    if (!this.resolvePlan) return;
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const me = this.state.players[this.planSeat];
    if (act === 'clear') {
      play('place');
      this.setPlan(this.plan.map((id, k) => (this.isLocked(k) ? id : '')));
      return;
    }
    if (act === 'lock') return this.lockIn();
    const slotEl = target.closest<HTMLElement>('[data-slot]');
    if (slotEl) {
      const i = Number(slotEl.dataset.slot);
      if (this.isLocked(i)) return play('deny');
      if (this.plan[i]) {
        play('place');
        this.setPlan(this.plan.map((id, k) => (k === i ? '' : id)));
      }
      return;
    }
    const cardEl = target.closest<HTMLElement>('[data-card]');
    if (cardEl) {
      const slot = this.nextEmptySlot();
      const id = cardEl.dataset.card!;
      // Touch: the first tap only selects the card (its details and squares show); the second adds it.
      // A mouse already previews on hover, so a click adds straight away, and so does a tap with
      // Instant select on.
      if (this.lastPointer !== 'mouse' && !this.instantSelect() && this.armed !== id) {
        this.armed = id;
        this.previewCard = id;
        if (slot >= 0) this.hovered = { slot, card: id };
        play('click');
        this.renderPlanner();
        return;
      }
      if (slot < 0 || !canPlace(me, this.plan, slot, id)) return this.deny(id);
      play('place');
      haptic('tap');
      this.previewCard = id;
      this.setPlan(this.plan.map((x, k) => (k === slot ? id : x)));
    }
  }

  // ---------- drag & drop ----------

  /**
   * The plan a drop would produce, or null if it changes nothing.
   * Hand → slot places (moving the card if it was already planned), slot → slot swaps,
   * slot → anywhere else removes.
   */
  private dropResult(under: HTMLElement | null, src: HTMLElement): Plan | null {
    const id = src.dataset.card!;
    const fromSlot = src.closest<HTMLElement>('[data-slot]');
    const toSlot = under?.closest<HTMLElement>('.slots [data-slot]') ?? null;
    const next = [...this.plan];
    if ((fromSlot && this.isLocked(Number(fromSlot.dataset.slot))) || (toSlot && this.isLocked(Number(toSlot.dataset.slot)))) return null;
    if (fromSlot) {
      const i = Number(fromSlot.dataset.slot);
      if (!toSlot) {
        next[i] = '';
        return next;
      }
      const j = Number(toSlot.dataset.slot);
      if (i === j) return null;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    if (!toSlot) return null;
    const j = Number(toSlot.dataset.slot);
    const was = next.indexOf(id);
    if (was === j) return null;
    if (was >= 0) next[was] = '';
    next[j] = id;
    return next;
  }

  private onDragOver(under: HTMLElement | null, src: HTMLElement): void {
    const toSlot = under?.closest<HTMLElement>('.slots [data-slot]') ?? null;
    this.el.querySelectorAll('.slot').forEach((sl) => sl.classList.remove('drop-ok', 'drop-bad'));
    if (!toSlot) return;
    const next = this.dropResult(under, src);
    const ok = !!next && partialPlanOk(this.state.players[this.planSeat], next);
    toSlot.classList.add(ok ? 'drop-ok' : 'drop-bad');
  }

  private onDrop(under: HTMLElement | null, src: HTMLElement): void {
    if (!this.resolvePlan) return;
    const next = this.dropResult(under, src);
    if (!next) return;
    if (!partialPlanOk(this.state.players[this.planSeat], next)) {
      const target = under?.closest<HTMLElement>('.slots [data-slot]');
      // A card from the hand that can't go there says why.
      const id = src.dataset.card!;
      if (target && !src.closest('[data-slot]')) this.deny(id, this.plan.map((x) => (x === id ? '' : x)), Number(target.dataset.slot));
      else play('deny');
      target?.classList.remove('shake');
      void target?.offsetWidth;
      target?.classList.add('shake');
      return;
    }
    play('place');
    this.previewCard = src.dataset.card!;
    this.setPlan(next);
  }

  // ---------- resolution ----------

  private async animateRound(plans: [Plan, Plan]): Promise<void> {
    const result = resolveRound(this.state, plans);
    this.recap = null;
    const ps = this.state.players;
    const start: RoundStart = {
      pos: [{ ...ps[0].pos }, { ...ps[1].pos }],
      facing: [ps[0].facing, ps[1].facing],
      traps: this.state.arena.traps.map((t) => ({ ...t })),
      hex: [ps[0].hex, ps[1].hex],
      lives: [ps[0].life, ps[1].life],
      energies: [ps[0].energy, ps[1].energy],
    };
    this.resetPlayCards();
    this.markHeld();
    this.shownRound = this.state.round;
    this.q('.summary').innerHTML = this.summaryBar(this.barTitle(this.state.round), this.opts.replay ? this.replayButtons() : '');
    this.q('.step-label').textContent = '';
    this.setMode('reveal');
    play('reveal');
    await this.sleep('intro');

    const view = boardView(start);
    const reveal: Playback = { live: true, wait: (ms) => this.hold(ms), pace: () => this.pace() };
    for (const step of result.steps) {
      this.q('.step-label').textContent = STRINGS.stepOf(step.slot + 1, stepsPerRound(this.state));
      // The knockout step plays in slow motion.
      if (step.outcome) this.slow = 1.8;
      await this.playStep(step, reveal, view, plans);
      this.slow = 1;
      if (this.destroyed) return;
    }

    const roundNo = this.state.round;
    this.state = result.state;
    this.lastPlans = [[...plans[0]], [...plans[1]]];
    this.log.rounds.push({ plans: this.lastPlans, result });
    this.showDazed();
    this.renderTraps(this.state.arena.traps);
    this.showHexes([this.state.players[0].hex, this.state.players[1].hex]);
    if (result.fatigue > 0) {
      const tokens = [this.q('.token.p0'), this.q('.token.p1')];
      this.state.players.forEach((p, i) => {
        this.floatText(p.pos, STRINGS.fatigueFloat(result.fatigue), 'damage fatigue', result.fatigue);
        this.hurtFx(i, p.pos, null);
      });
      play('hit');
      this.renderHud();
      await this.sleep('hit');
      // Knocked out by fatigue alone: the round's steps had no knockout to animate.
      const o = result.state.outcome;
      if (o && !result.steps.some((s) => s.outcome)) {
        play('ko');
        haptic('ko');
        if (fullEffects()) retrigger(this.el, 'ko-flash');
        tokens.forEach((t, i) => {
          if (o.winner === null || o.winner !== i) t.classList.add('ko', 'ko-fall');
        });
      }
    }
    if (!result.state.outcome) {
      for (const p of this.state.players) this.floatText(p.pos, STRINGS.energyBack(energyRecovery(p)), 'energy');
      this.renderHud();
      await this.sleep('energy');
    } else {
      await this.sleep('energy');
    }
    if (this.destroyed) return;
    this.setCaption('');
    // First-time tips for what this round showed (two at most, each only ever once).
    const tips = this.tipsOn() ? roundTips(result).filter((id) => !tipSeen(id)).slice(0, 2) : [];
    await this.showSummary(roundNo, plans, result, start, tips);
  }

  /**
   * Play one step on the board, one card after the other (moves, then guard/focus/reload, then
   * attacks in strike order, then heals and traps), every card taking at least CARD_MS, each with a
   * caption and an outcome stamp on its card. Then square effects, traps springing and a knockout.
   * The reveal plays it live (sounds, cards flipping face up as they play); the recap plays it
   * silently. `view` is what the board and HUD show, carried from step to step; it ends on the
   * step's exact result.
   *
   * With `only` (a seat), just that player's card plays: a card before it in the step applies at
   * once without any effects, and nothing after it plays (the recap's tap-a-card replay).
   */
  private async playStep(step: StepResult, pb: Playback, view: BoardView, plans?: [Plan, Plan], only?: number): Promise<void> {
    const P = step.players;
    const ps = this.state.players;
    const names: [string, string] = [this.seats[0].name, this.seats[1].name];
    const tokens = [this.q('.token.p0'), this.q('.token.p1')];
    const color = (i: number) => getFighter(ps[i].fighterId).color;
    const ms = (n: number) => n * pb.pace();
    /** A card applied at once and silently (before the tapped card in `only` mode). */
    let ghost = false;
    const show = (f: () => void) => {
      if (!ghost) f();
    };
    const sfx = (id: SoundId) => show(() => pb.live && play(id));
    const pause = (n: number) => (ghost ? Promise.resolve() : pb.wait(n));
    const float = (i: number, text: string, cls: string, amount = 0, more: { text: string; cls: string }[] = []) =>
      show(() => this.floatText(view.pos[i], text, cls, amount, more));
    const life = (i: number, n: number) => (view.lives[i] = clamp(view.lives[i] + n, 0, ps[i].lifeMax));
    const energy = (i: number, n: number) => (view.energies[i] = clamp(view.energies[i] + n, 0, ps[i].energyMax));
    const hud = () => this.renderHud(view.lives, view.energies);
    const stampCard = (i: number) => {
      const s = beatStamp(step, i as Seat);
      if (s) this.stamp(i, step.slot, s.kind, s.text);
    };
    /** Put the pieces where the view has them, facing each other (as the rules do after every move). */
    const place = () => {
      for (const i of [0, 1] as const) view.facing[i] = faceTowards(view.pos[i], view.pos[i === 0 ? 1 : 0], view.facing[i]);
      if (ghost) this.snapTokens(view.pos, view.facing);
      else this.placeTokens(view.pos, view.facing);
    };

    /** An attack: the attacker stands out, its squares light up, then the hit lands. */
    const strike = async (a: number) => {
      const d = a === 0 ? 1 : 0;
      const pa = P[a];
      const pd = P[d];
      if (pa.interrupted) {
        float(a, STRINGS.tooLate, 'miss');
        return;
      }
      if (step.sequence?.[0] === a) float(a, STRINGS.firstStrike, 'first');
      show(() => this.tokenAnim(a, 'lunge'));
      await pause(260);
      const kind = fxKind(getCard(pa.cardId));
      show(() => this.showArea(pa.area, `area-p${a}`, view.pos[a], kind));
      sfx(kind);
      await pause(600);

      // A short hit-stop before the impact.
      if (!ghost && pb.live && fullEffects() && (pd.damageTaken > 0 || pa.counterTaken > 0)) await wait(90);
      const sounds: SoundId[] = [];
      let biggest = 0;
      if (pd.hit === 'hit' || (pd.hit === 'guard' && pd.damageTaken > 0)) {
        show(() => {
          this.hurtFx(d, view.pos[d], view.pos[a]);
          this.fx.particles(view.pos[d], color(a), 10);
          if (pd.hit === 'guard') this.fx.ring(view.pos[d], 'shield');
        });
        // The card's own damage, with each bonus on top of it (a hex, a passive...) as its own number
        // on the line below, kept together.
        const [own, ...bonus] = pd.damageParts?.length ? pd.damageParts : [{ kind: 'card' as const, amount: pd.damageTaken }];
        const more = bonus.map((x) => ({ text: `-${x.amount} ${partLabel(x.kind, ps[a].fighterId)}`, cls: `part-${x.kind}` }));
        if (own.amount > 0) float(d, `-${own.amount}`, pd.hit === 'guard' ? 'guarded' : 'damage', own.amount, more);
        else float(d, STRINGS.guarded, 'guarded', 0, more); // the guard took all of the card's own damage
        life(d, -pd.damageTaken);
        biggest = pd.damageTaken;
        sounds.push(pd.hit === 'hit' ? 'hit' : 'guard');
      } else if (pd.hit === 'guard') {
        show(() => this.fx.ring(view.pos[d], 'shield'));
        float(d, STRINGS.guarded, 'guarded');
        sounds.push('guard');
      } else if (pd.hit === 'miss') {
        // A miss shows nothing on the opponent; the attack's squares simply don't reach them.
        sounds.push('miss');
      }
      if (pa.counterTaken > 0) {
        // Sparks fly back from the defender into the attacker.
        if (!ghost) {
          this.fx.travel(view.pos[d], view.pos[a], themeColor('--fx-counter'), 4, 'spark');
          const at = { ...view.pos[a] };
          const from = { ...view.pos[d] };
          setTimeout(() => {
            this.hurtFx(a, at, from);
            this.floatText(at, `${STRINGS.effectIcons.counter} -${pa.counterTaken}`, 'damage', pa.counterTaken);
          }, ms(fullEffects() ? 420 : 0));
        }
        life(a, -pa.counterTaken);
        biggest = Math.max(biggest, pa.counterTaken);
        sounds.push('clang');
      }
      if (pd.dazed) {
        this.setDazed(d, true);
        show(() => this.fx.ring(view.pos[d], 'stun'));
        float(d, STRINGS.dazed, 'stun');
        sounds.push('zap');
      }
      if (pd.energyLost > 0) {
        // Energy crackles out of the target toward the attacker.
        show(() => this.fx.travel(view.pos[d], view.pos[a], themeColor('--fx-sap'), 5, 'spark'));
        float(d, STRINGS.sapped(pd.energyLost), 'sap');
        energy(d, -pd.energyLost);
        sounds.push('zap');
      }
      if (pd.hexBroken) {
        show(() => this.fx.particles(view.pos[d], themeColor('--fx-hex'), 14));
        // The hex's damage already shows as its own number (older logs don't split the damage).
        if (!pd.damageParts?.some((x) => x.kind === 'hex')) float(d, STRINGS.hexBrokenFloat, 'hex');
        sounds.push('shimmer');
      } else if (pd.hexApplied) {
        show(() => this.fx.gather(view.pos[d], themeColor('--fx-hex'), 8));
        float(d, STRINGS.hexedFloat, 'hex');
        sounds.push('shimmer');
      }
      this.setHex(d, pd.hex);
      if (pa.drained > 0) {
        show(() => this.fx.travel(view.pos[d], view.pos[a], themeColor('--fx-drain'), 6, 'mote'));
        float(a, `+${pa.drained}`, 'heal');
        life(a, pa.drained);
        sounds.push('shimmer');
      }
      if (pa.recoilTaken > 0) {
        show(() => {
          this.hurtFx(a, view.pos[a], null);
          this.fx.particles(view.pos[a], themeColor('--fx-recoil'), 8);
        });
        float(a, STRINGS.recoiled(pa.recoilTaken), 'recoil', pa.recoilTaken);
        life(a, -pa.recoilTaken);
        sounds.push('burn');
      }
      if (pb.live && !ghost) {
        [...new Set(sounds)].forEach((id, k) => setTimeout(() => play(id), k * 110));
        if (biggest > 0) {
          const strength = biggest >= 40 ? 3 : biggest >= 25 ? 2 : 1;
          this.fx.shake(strength);
          haptic(strength === 3 ? 'big' : 'hit');
        }
      }
      hud();
      // A guard that met this attack gets its stamp now.
      if (getCard(pd.cardId).kind === 'guard') stampCard(d);

      // The attack shatters the enemy traps it covered.
      const cols = this.state.arena.cols;
      const broken = this.shownTraps.filter(
        (t) => t.owner !== a && step.brokenTraps.includes(t.at) && pa.area.some((q) => q.r * cols + q.c === t.at),
      );
      if (broken.length) {
        show(() => broken.forEach((t) => this.fx.particles({ r: Math.floor(t.at / cols), c: t.at % cols }, themeColor('--trap'), 8, 'dust')));
        this.renderTraps(this.shownTraps.filter((t) => !broken.includes(t)));
        sfx('thud');
      }

      // A push or pull lands just after the hit.
      if (!samePos(view.pos[d], pd.final)) {
        await pause(300);
        show(() => {
          this.tokenAnim(d, 'skid');
          this.fx.particles(view.pos[d], themeColor('--fx-dust'), 6, 'dust');
        });
        view.pos[d] = { ...pd.final };
        place();
        sfx('thud');
      }
    };

    /** Order of play: moves (plain steps before swaps), guard/focus/reload, attacks (strike order), heals and traps. */
    const phase = (i: number) => {
      const c = getCard(P[i].cardId);
      return c.kind === 'move' ? (c.swap ? 1.5 : 1) : c.kind === 'attack' ? 3 : c.kind === 'heal' || c.kind === 'trap' ? 4 : 2;
    };
    const order = [0, 1].sort((x, y) => phase(x) - phase(y) || (step.sequence ? step.sequence.indexOf(x as Seat) - step.sequence.indexOf(y as Seat) : x - y));
    const last = only === undefined ? order.length - 1 : order.indexOf(only);

    for (const [k, i] of order.entries()) {
      if (k > last) break;
      ghost = only !== undefined && k < last;
      const p = P[i];
      const o = i === 0 ? 1 : 0;
      const c = getCard(p.cardId);
      const t0 = performance.now();
      const card = this.playCard(i, step.slot);
      if (!ghost) {
        // The card comes into the spotlight, its fighter lights up and its caption shows, together.
        this.markCard(i, step.slot);
        this.actingFx(i, c.kind === 'attack' && p.active && !p.stunned);
        this.setCaption(beatCaption(step, i as Seat, names, [ps[0].fighterId, ps[1].fighterId]));
        card.querySelector('.play-stamp')?.remove();
      }
      if (pb.live && plans) {
        // The card steps forward face down, then flips over.
        card.className = `play-card now face-down${p.active ? '' : ' inactive'}${p.stunned ? ' stunned' : ''}`;
        card.querySelector('.play-face')!.innerHTML =
          cardHtml(plans[i][step.slot], { facing: p.facing, readonly: true }) + (p.stunned ? `<span class="play-tag">${STRINGS.stunned}</span>` : '');
        sfx('place');
        await pause(200);
        card.classList.remove('face-down');
        card.classList.add('flipped');
        sfx('flip');
      }
      await pause(READ_MS);

      if (p.stunned) {
        // Cancelled by a stun: the card plays out as nothing.
        this.setDazed(i, false);
        float(i, STRINGS.stunned, 'stun');
      } else if (p.active) {
        show(() => this.cardActs(i, step.slot));
        energy(i, c.cost);
        hud();
        if (c.kind === 'move' && c.swap) {
          // Both fighters trade places (once, even if both played a swap).
          if (p.swapped && !(samePos(view.pos[0], P[0].to) && samePos(view.pos[1], P[1].to))) {
            show(() => this.showArea([P[0].to, P[1].to], 'move-target'));
            await pause(300);
            view.pos = [{ ...P[0].to }, { ...P[1].to }];
            place();
            [0, 1].forEach((j) => {
              show(() => this.tokenAnim(j, 'hop'));
              float(j, STRINGS.swappedFloat, 'swap');
            });
            sfx('swap');
          }
        } else if (c.kind === 'move') {
          // Where this move alone took them: before any swap later this step.
          const dest = p.swapped ? P[o].to : p.to;
          if (!samePos(dest, view.pos[i])) {
            show(() => this.showArea([dest], 'move-target'));
            await pause(300);
            view.pos[i] = { ...dest };
            place();
            show(() => {
              this.tokenAnim(i, 'hop');
              setTimeout(() => this.fx.particles(dest, themeColor('--fx-dust'), 6, 'dust'), ms(420));
            });
            sfx('step');
          }
        } else if (c.kind === 'guard') {
          // The shield stays up for the rest of the step.
          tokens[i].classList.add('guarding');
          show(() => this.fx.ring(view.pos[i], 'shield'));
          sfx('guard');
        } else if (c.kind === 'focus') {
          show(() => {
            retrigger(tokens[i], 'focusing');
            this.fx.gather(view.pos[i], themeColor('--energy'), 10);
          });
          if (c.cost > 0) float(i, STRINGS.energyBack(c.cost), 'energy');
          sfx('shimmer');
        } else if (c.kind === 'reload') {
          float(i, STRINGS.reloaded, 'reload');
          sfx('reload');
        } else if (c.kind === 'attack') {
          await strike(i);
        } else if (c.kind === 'heal') {
          if (p.healed > 0) {
            float(i, `+${p.healed}`, 'heal');
            life(i, p.healed);
            sfx('heal');
            hud();
          }
        } else if (c.kind === 'trap') {
          // This player's new traps appear (springing and breaking show at their own moments).
          const mine = step.traps.filter((t) => t.owner === i);
          const kept = this.shownTraps.filter((t) => t.owner !== i || !mine.some((m) => m.at === t.at));
          if (this.renderTraps([...kept, ...mine], !ghost)) sfx('place');
        }
      }
      // Guard cards are stamped by the attack they meet (see strike).
      if (c.kind !== 'guard') stampCard(i);
      // Every card gets the same time on the board, however little it does.
      const rest = CARD_MS - (performance.now() - t0) / pb.pace();
      if (rest > 0) await pause(rest);
      if (!ghost) this.clearAreas();
    }
    // The tap-a-card replay stops after its card.
    if (only !== undefined) return;

    // Arena squares and enemy traps, for whoever ends the step on one. No card does this, so no card
    // stays in the spotlight while it happens.
    const end = endCaption(step, names);
    if (end) {
      this.markCard(null);
      this.setCaption(end);
    }
    P.forEach((p, i) => {
      if (p.tile === 'spikes') {
        this.hurtFx(i, p.final, null);
        float(i, `-${BALANCE.tiles.spikes}`, 'damage', BALANCE.tiles.spikes);
        sfx('thud');
      } else if (p.tile === 'well') {
        float(i, `+${BALANCE.tiles.well}⚡`, 'energy');
        sfx('shimmer');
      }
      if (p.trapDamage > 0) {
        this.hurtFx(i, p.final, null);
        float(i, STRINGS.trapped(p.trapDamage), 'damage', p.trapDamage);
        sfx('trap');
      }
    });
    // The step's exact result.
    view.pos = [{ ...P[0].final }, { ...P[1].final }];
    view.facing = [P[0].facing, P[1].facing];
    view.lives = [P[0].life, P[1].life];
    view.energies = [P[0].energy, P[1].energy];
    this.placeTokens(view.pos, view.facing);
    hud();
    this.renderTraps(step.traps);
    this.showHexes([P[0].hex, P[1].hex]);
    if (end) await pb.wait(CARD_MS * 0.6);

    // Knockout: flash, and the loser falls.
    if (step.outcome) {
      await pb.wait(250);
      sfx('ko');
      if (pb.live) {
        haptic('ko');
        if (fullEffects()) retrigger(this.el, 'ko-flash');
      }
      const w = step.outcome.winner;
      tokens.forEach((t, i) => {
        if (w === null || w !== i) t.classList.add('ko', 'ko-fall');
      });
      await pb.wait(1000);
    }
    tokens.forEach((t) => t.classList.remove('guarding'));
  }

  /** Put the board back to the end-of-round state (after a replay). */
  private restoreBoard(): void {
    this.clearAreas();
    this.renderTraps(this.state.arena.traps);
    this.showHexes([this.state.players[0].hex, this.state.players[1].hex]);
    this.markCard(null);
    this.renderHud();
    this.stampAll();
    if (this.recap) this.setCaption(STRINGS.narrate.tapCard);
    const ps = this.state.players;
    this.snapTokens([ps[0].pos, ps[1].pos], [ps[0].facing, ps[1].facing]);
    const o = this.state.outcome;
    [0, 1].forEach((i) => {
      const t = this.q(`.token.p${i}`);
      t.classList.remove('guarding', 'focusing', ...TOKEN_ANIMS);
      t.classList.toggle('ko', !!o && (o.winner === null || o.winner !== i));
      t.classList.remove('ko-fall');
    });
    this.showDazed();
  }

  /** Stun marks for whoever is still stunned between rounds (only in Two-tap: it cancels the held card). */
  private showDazed(): void {
    this.state.players.forEach((p, i) => this.setDazed(i, p.dazed));
  }

  /** Two-tap: the card each player holds over for next round stays face down, with a lock. */
  private markHeld(): void {
    if (this.state.variant !== 'twoTap') return;
    for (const i of [0, 1]) {
      const card = this.playCard(i, stepsPerRound(this.state));
      card.classList.add('held');
      card.title = STRINGS.twoTap.heldTitle;
      card.querySelector('.play-step')!.textContent = STRINGS.twoTap.nextRound;
    }
  }

  /** Silent recap playback; its waits throw CANCELLED once `replayRun` moves on from `run`. */
  private recapPlayback(run: number): Playback {
    return {
      live: false,
      pace: speedMultiplier,
      wait: async (ms: number) => {
        await wait(ms * speedMultiplier());
        while (this.paused && this.replayRun === run && !this.destroyed) await wait(100);
        if (this.replayRun !== run || this.destroyed) throw CANCELLED;
      },
    };
  }

  /**
   * Put the board and HUD back to how they were as step `slot` of the recapped round began
   * (the round's start plus the steps before it). Returns that view.
   */
  private rewindTo(slot: number): BoardView {
    const { result, start } = this.recap!;
    const prev = slot > 0 ? result.steps[slot - 1] : null;
    const view: BoardView = prev
      ? {
          pos: [{ ...prev.players[0].final }, { ...prev.players[1].final }],
          facing: [prev.players[0].facing, prev.players[1].facing],
          lives: [prev.players[0].life, prev.players[1].life],
          energies: [prev.players[0].energy, prev.players[1].energy],
        }
      : boardView(start);
    this.markCard(null);
    this.setCaption('');
    this.clearAreas();
    [0, 1].forEach((i) => {
      this.q(`.token.p${i}`).classList.remove('ko', 'ko-fall', 'guarding', ...TOKEN_ANIMS);
      this.setDazed(i, !!prev?.players[i].dazed);
    });
    this.renderTraps(prev ? prev.traps : start.traps);
    this.showHexes(prev ? [prev.players[0].hex, prev.players[1].hex] : start.hex);
    this.snapTokens(view.pos, view.facing);
    this.snapHud(view.lives, view.energies);
    return view;
  }

  /**
   * Loop the round on the board (silently), card by card exactly like the reveal, with the HUD bars
   * following along and a short pause before each loop. Runs until `replayRun` changes.
   */
  private async replayRound(run: number): Promise<void> {
    const { result } = this.recap!;
    const tokens = [this.q('.token.p0'), this.q('.token.p1')];
    const recap = this.recapPlayback(run);
    try {
      for (;;) {
        const view = this.rewindTo(0);
        await recap.wait(700);
        for (const step of result.steps) await this.playStep(step, recap, view);

        // End of the round: fatigue, then the energy refill; the bars land on the round's final numbers.
        this.markCard(null);
        this.setCaption(STRINGS.narrate.tapCard);
        const end = this.state.players;
        if (result.fatigue > 0) {
          end.forEach((p, i) => {
            this.hurtFx(i, p.pos, null);
            this.floatText(p.pos, STRINGS.fatigueFloat(result.fatigue), 'damage fatigue', result.fatigue);
          });
          const o = result.state.outcome;
          if (o && !result.steps.some((s) => s.outcome)) {
            tokens.forEach((t, i) => {
              if (o.winner === null || o.winner !== i) t.classList.add('ko', 'ko-fall');
            });
          }
        }
        if (!result.state.outcome) {
          end.forEach((p) => this.floatText(p.pos, STRINGS.energyBack(energyRecovery(p)), 'energy'));
        }
        this.renderHud();
        // Hold the final position a while before starting over.
        await recap.wait(2400);
      }
    } catch (e) {
      if (e !== CANCELLED) throw e;
    }
  }

  /** Recap: replay one played card from the start of its step, then put the board back. */
  private async replayCard(seat: number, slot: number): Promise<void> {
    const run = ++this.replayRun;
    const btn = this.el.querySelector<HTMLElement>('.summary [data-act="replay"]');
    if (btn) btn.textContent = STRINGS.replay;
    const recap = this.recapPlayback(run);
    try {
      const view = this.rewindTo(slot);
      await recap.wait(300);
      await this.playStep(this.recap!.result.steps[slot], recap, view, undefined, seat);
      await recap.wait(900);
      this.restoreBoard();
    } catch (e) {
      if (e !== CANCELLED) throw e;
    }
  }

  /** A tap on a card in the play area: in the recap, a played card replays. */
  private onPlayCardTap(el: HTMLElement): void {
    if (this.el.dataset.mode !== 'summary' || !this.recap || this.opts.replay) return;
    const slot = Number(el.dataset.step);
    const seat = Number(el.closest<HTMLElement>('.play-col')!.dataset.seat);
    if (!this.recap.result.steps[slot] || el.classList.contains('held') || el.classList.contains('unplayed')) return;
    play('click');
    void this.replayCard(seat, slot);
  }

  /** Every play-area card back to face down, for a new round. */
  private resetPlayCards(): void {
    this.el.querySelectorAll<HTMLElement>('.play-card').forEach((c) => {
      c.className = 'play-card face-down';
      c.title = '';
      c.querySelector('.play-face')!.innerHTML = '<span class="card card-back"></span>';
    });
  }

  private playCard(seat: number, step: number): HTMLElement {
    return this.q(`.play-col.p${seat} .play-card[data-step="${step}"]`);
  }

  /** Spotlight the one card playing now (null: none). */
  private markCard(seat: number | null, step = 0): void {
    this.el.querySelectorAll('.play-card.now').forEach((c) => c.classList.remove('now'));
    if (seat !== null) this.playCard(seat, step).classList.add('now');
  }

  private barTitle(round: number): string {
    return this.opts.replay ? STRINGS.replays.roundOf(round, this.opts.replay.rounds) : STRINGS.round(round);
  }

  /** Replay viewer buttons: previous round, play/pause, next round, speed and exit. */
  private replayButtons(): string {
    const r = this.opts.replay!;
    const R = STRINGS.replays;
    const ctl = (act: string, label: string, glyph: string, cls = '') =>
      `<button class="btn icon-ctl${cls}" data-rp="${act}" aria-label="${label}" title="${label}">${glyph}</button>`;
    return (
      (r.single ? '' : ctl('prev', R.prev, '⏮\uFE0E')) +
      ctl('pause', r.paused ? R.play : R.pause, r.paused ? '▶\uFE0E' : '❚❚', ' primary') +
      (r.single ? '' : ctl('next', R.next, '⏭\uFE0E')) +
      ctl('speed', R.speed, `${r.speed}×`) +
      ctl('exit', R.exit, '✕')
    );
  }

  private bindReplayControls(): void {
    const r = this.opts.replay!;
    this.el.style.setProperty('--pace', String(1 / r.speed));
    const summary = this.q('.summary');
    summary.innerHTML = this.summaryBar(this.barTitle(this.state.round), this.replayButtons());
    summary.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-rp]');
      if (!btn || this.destroyed) return;
      play('click');
      const round = this.shownRound || this.state.round;
      switch (btn.dataset.rp) {
        case 'prev':
          return r.seek(Math.max(1, round - 1));
        case 'next':
          return r.seek(round + 1);
        case 'exit':
          this.destroy();
          return r.exit();
        case 'pause':
          r.paused = !r.paused;
          break;
        case 'speed':
          r.speed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(r.speed) + 1) % REPLAY_SPEEDS.length];
          this.el.style.setProperty('--pace', String(1 / r.speed));
          break;
      }
      r.onChange(r.speed, r.paused);
      summary.querySelector('.row')!.innerHTML = this.replayButtons();
    });
  }

  /** The bar under the cards: a title and (in the recap) the buttons. Same size in both, so nothing jumps. */
  private summaryBar(title: string, buttons: string): string {
    return `<h3>${title}</h3><p class="caption"></p><div class="row">${
      buttons || `<button class="btn" disabled>${STRINGS.replay}</button><button class="btn primary" disabled>${STRINGS.nextRound}</button>`
    }</div>`;
  }

  /** After the round: the cards stay in the play area and the round replays on the board. */
  private async showSummary(
    roundNo: number,
    plans: [Plan, Plan],
    result: RoundResult,
    start: RoundStart,
    tips: string[] = [],
  ): Promise<void> {
    const summary = this.q('.summary');
    // Cards never played (the match ended first) are shown crossed out. In Two-tap the card held
    // over for next round stays face down while the match goes on.
    const heldOver = this.state.variant === 'twoTap' && !result.state.outcome ? stepsPerRound(this.state) : -1;
    for (const i of [0, 1] as Seat[]) {
      plans[i].forEach((id, s) => {
        if (result.steps[s] || s === heldOver) return;
        const card = this.playCard(i, s);
        card.className = 'play-card unplayed';
        card.title = STRINGS.notPlayed;
        card.querySelector('.play-face')!.innerHTML = cardHtml(id, { facing: result.state.players[i].facing, readonly: true });
      });
    }
    this.markCard(null);
    if (this.opts.replay) {
      // Replays roll on by themselves: hold the end of the round a moment (longer after the last).
      this.setMode('summary');
      await this.hold(result.state.outcome ? 2600 : 1300);
      return;
    }
    const label = result.state.outcome ? STRINGS.seeResult : STRINGS.nextRound;
    summary.innerHTML = this.summaryBar(
      STRINGS.roundSummary(roundNo),
      `<button class="btn" data-act="replay">${STRINGS.replay}</button>
        <button class="btn primary" data-act="next">${label}</button>`,
    );
    this.setMode('summary');
    this.recap = { result, start };
    const replayBtn = summary.querySelector<HTMLElement>('[data-act="replay"]')!;
    const stopReplay = () => {
      this.replayRun++;
      replayBtn.textContent = STRINGS.replay;
      this.restoreBoard();
    };
    const startReplay = () => {
      const run = ++this.replayRun;
      replayBtn.textContent = STRINGS.stopReplay;
      void this.replayRound(run);
    };
    replayBtn.addEventListener('click', () => {
      play('click');
      if (replayBtn.textContent === STRINGS.stopReplay) return stopReplay();
      startReplay();
    });
    // The recap replays the round on the board by itself; the button pauses/restarts it.
    startReplay();
    const done = new Promise<void>((res) => {
      summary.querySelector('[data-act="next"]')!.addEventListener('click', () => {
        play('click');
        stopReplay();
        res();
      });
    });
    for (const id of tips) {
      await this.coach(STRINGS.firstTips[id]);
      markTipSeen(id);
    }
    await this.opts.hooks?.roundEnd?.(this, roundNo, result);
    return done;
  }
}
