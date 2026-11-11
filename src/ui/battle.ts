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
  isSpent,
  faceTowards,
  movePos,
  partialPlanOk,
  planEnergyTrace,
  planError,
  resolveRound,
  samePos,
} from '../engine/rules';
import type { MatchLog, MatchOutcome, MatchState, Plan, Pos, RoundResult, Seat, StepResult, Trap } from '../engine/types';
import type { PlanSource } from '../net/transport';
import { fullEffects, getPlanTimer, speedMultiplier } from '../settings';
import { cardHtml, describeCard, groupedCardsHtml, passiveHtml } from './card';
import { enableDrag } from './drag';
import { Fx, fxKind, haptic, retrigger, type FxKind } from './fx';
import { bindSettings, settingsHtml } from './settingsPanel';
import { themeColor } from './skin';
import { emblemHtml, tokenArtHtml } from './emblems';

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
  /** Short label under the round counter, e.g. the daily challenge's rule twist. */
  tag?: string;
  /** Continue a saved match: the previous round's plans and the log so far. */
  resume?: { lastPlans: [Plan, Plan] | null; log: MatchLog };
  /** Called at the start of every round, before anyone plans (used to save the match). */
  onRoundStart?: (state: MatchState, lastPlans: [Plan, Plan] | null, log: MatchLog) => void;
}

/** Free cards the plan timer uses to finish a plan, in order of preference. */
const AUTO_FILL = ['guard', 'up', 'down', 'left', 'right', 'focus'];

/**
 * What the battle screen is doing; drives which panels are visible (see styles.css).
 * plan: a human picks cards · wait: CPU thinking · pass: hot-seat hand-over
 * reveal: cards resolve step by step · summary: round recap.
 */
type Mode = 'idle' | 'plan' | 'wait' | 'pass' | 'reveal' | 'summary';

/** Base animation timings in ms at "normal" speed. */
const TIMING = { intro: 500, place: 700, move: 650, area: 1150, hit: 1000, quiet: 450, energy: 900 };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  /** Traps currently drawn on the board (to spot newly placed ones). */
  private shownTraps: Trap[] = [];

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
    this.el.className = 'battle';
    this.root.replaceChildren(this.el);
    this.renderShell();
    this.renderHud();
    this.setMode('idle');
    // Start after construction so plan sources can reference this view.
    setTimeout(() => void this.loop(), 0);
  }

  /** Sleep that respects the speed setting and holds while a menu or deck viewer is open. */
  private async sleep(key: keyof typeof TIMING): Promise<void> {
    await wait(TIMING[key] * speedMultiplier() * this.slow);
    while (this.paused && !this.destroyed) await wait(100);
  }

  private setMode(mode: Mode): void {
    this.el.dataset.mode = mode;
    if (mode !== 'plan') {
      // Never leave a planned path, planned energy or hover highlight for the other player to see.
      this.clearPath();
      this.clearAreas();
      this.showPlannedEnergy(null);
      this.stopTimer();
    }
  }

  // ---------- main loop ----------

  private async loop(): Promise<void> {
    while (!this.state.outcome) {
      this.opts.onRoundStart?.(this.state, this.lastPlans, this.log);
      this.setRoundLabel();
      const plans: Plan[] = [];
      const bothHuman = this.seats.every((s) => s.source.kind === 'human');
      for (const seat of [0, 1] as Seat[]) {
        const src = this.seats[seat].source;
        if (src.kind === 'human' && bothHuman) await this.passScreen(seat);
        if (src.kind !== 'human') {
          this.setMode('wait');
          this.q('.status').textContent = STRINGS.cpuThinking;
        }
        const plan = await src.requestPlan(this.state, seat);
        if (this.destroyed) return;
        const err = planError(this.state.players[seat], plan);
        if (err) throw new Error(err);
        plans[seat] = plan;
      }
      if (bothHuman) await this.passScreen(null);
      await this.animateRound(plans as [Plan, Plan]);
      if (this.destroyed) return;
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
      return `<div class="tile${kind ? ` tile-${kind}` : ''}" data-r="${r}" data-c="${c}"${kind ? ` title="${STRINGS.tileNames[kind]}"` : ''}>${icon}</div>`;
    }).join('');
    const tokens = this.state.players
      .map((p, i) => `<div class="token p${i}" data-seat="${i}" title="${this.seats[i].name}" style="--clr:${getFighter(p.fighterId).color}">
          ${tokenArtHtml(getFighter(p.fighterId))}<span class="facing"></span></div>`)
      .join('');
    const pile = (i: number) => `<div class="pile p${i}"><span class="pile-name">${this.seats[i].name}</span><div class="pile-cards"></div></div>`;
    this.el.style.setProperty('--aspect', String(A.cols / A.rows));
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
      <div class="board-row">
        <aside class="side left">
          <div class="slots"></div>
          ${pile(0)}
        </aside>
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
        <aside class="side right">
          <div class="card-preview"></div>
          ${pile(1)}
        </aside>
      </div>
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
    this.renderTraps(this.state.arena.traps);

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.modal, .pass, .summary')) return;
      if (t.closest('[data-act="menu"]')) return this.openMenu();
      if (t.closest('.planner, .slots')) return this.onPlannerClick(e);
      const seatEl = t.closest<HTMLElement>('.token, .panel');
      if (seatEl) this.showDeck(Number(seatEl.dataset.seat) as Seat);
    });
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
    const after = BALANCE.fatigueAfterRound;
    tag.textContent = round > after ? STRINGS.fatigueTag(BALANCE.fatigueDamage) : round === after ? STRINGS.fatigueSoon : '';
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
          <div class="who"><b>${this.seats[i].name}</b><span>${f.name}</span></div>
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
      lb.querySelector('span')!.textContent = `♥ ${life}`;
      const eb = panel.querySelector('.bar.energy')!;
      (eb.querySelector('i') as HTMLElement).style.width = `${(energy / p.energyMax) * 100}%`;
      eb.querySelector('span')!.textContent = `⚡ ${energy}`;
    });
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

  private clearAreas(): void {
    this.el.querySelectorAll<HTMLElement>('.tile').forEach((t) => {
      t.classList.remove('area-p0', 'area-p1', 'preview', 'preview-atk', 'preview-move', 'preview-trap', 'fx-slash', 'fx-burst', 'fx-wave', 'fx-beam', 'fx-quake');
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
      const mark = document.createElement('span');
      mark.className = `trap-mark p${t.owner}${fresh.has(key(t)) ? ' new' : ''}`;
      mark.textContent = STRINGS.effectIcons.trap;
      mark.title = `${STRINGS.effectNames.trap} ${t.damage}`;
      tile.appendChild(mark);
    }
    return fresh.size > 0;
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
  private floatText(pos: Pos, text: string, cls: string, stack = 0, amount = 0): void {
    const f = document.createElement('div');
    f.className = `float ${cls}`;
    f.textContent = text;
    // Bigger hits get bigger numbers.
    f.style.setProperty('--size', String(1 + Math.min(amount, 60) / 80));
    f.style.setProperty('--r', String(pos.r));
    f.style.setProperty('--c', String(pos.c));
    f.style.setProperty('--k', String(stack));
    this.q('.floats').appendChild(f);
    setTimeout(() => f.remove(), 1400);
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
       ${passiveHtml(f)}
       ${
         this.lastPlans
           ? `<h3>${STRINGS.lastRound}</h3><div class="hand last-round">${this.lastPlans[seat]
               .map((id) => cardHtml(id, { facing: p.facing, small: true, readonly: true }))
               .join('')}</div>`
           : ''
       }
       <div class="hand grouped">${groupedCardsHtml(p.deck, (id) => cardHtml(id, { facing: p.facing, readonly: true, spent: isSpent(p, id) }))}</div>
       <button class="btn" data-modal="close">${STRINGS.close}</button>`,
    );
  }

  private openMenu(): void {
    play('click');
    this.openModal(
      `<h2>${STRINGS.menuTitle}</h2>
       <div class="menu-list">
         <button class="btn primary" data-modal="close">${STRINGS.resume}</button>
         ${settingsHtml()}
         <details class="menu-rules"><summary>${STRINGS.howToPlay}</summary><ol class="rules">${STRINGS.rules.map((r) => `<li>${r}</li>`).join('')}</ol></details>
         <button class="btn danger" data-m="quit">${STRINGS.quit}</button>
       </div>`,
      (box) => {
        bindSettings(box);
        box.querySelector('[data-m="quit"]')!.addEventListener('click', () => {
          play('click');
          this.destroyed = true;
          this.paused = false;
          this.stopTimer();
          duckMusic(false);
          this.onQuit();
        });
      },
    );
  }

  // ---------- human planning ----------

  askHuman(state: MatchState, seat: Seat): Promise<Plan> {
    this.state = state;
    this.planSeat = seat;
    this.plan = Array(BALANCE.slotsPerRound).fill('');
    this.hovered = null;
    this.previewCard = null;
    this.el.dataset.seat = String(seat);
    this.q('.status').textContent = STRINGS.planning(this.seats[seat].name);
    this.setMode('plan');
    return new Promise((res) => {
      this.resolvePlan = res;
      this.renderPlanner();
      void (async () => {
        await this.opts.hooks?.planStart?.(this, state.round, seat);
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

  private nextEmptySlot(): number {
    return this.plan.findIndex((id) => !id);
  }

  private renderPlanner(): void {
    const me = this.state.players[this.planSeat];
    const facings = this.projectedPath().facing;
    const trace = planEnergyTrace(me.energy, me.energyMax, this.plan);
    this.q('.slots').innerHTML = this.plan
      .map((id, i) => {
        const inner = id ? cardHtml(id, { facing: facings[i], small: true }) : `<span class="empty"><b>${i + 1}</b>${STRINGS.emptySlot}</span>`;
        const next = i === this.nextEmptySlot() ? ' next' : '';
        const energy = id && trace ? `<span class="slot-energy" title="${STRINGS.energyAfter}">⚡ ${trace[i]}</span>` : '';
        return `<div class="slot${next}" data-slot="${i}"><span class="slot-label">${STRINGS.slot(i + 1)}</span>${inner}${energy}</div>`;
      })
      .join('');
    const filled = this.plan.some(Boolean);
    this.showPlannedEnergy(filled && trace ? trace[trace.length - 1] : null);
    const target = this.nextEmptySlot();
    this.q('.hand').innerHTML = groupedCardsHtml(me.deck, (id) => {
      const used = this.plan.includes(id);
      const ok = target >= 0 && canPlace(me, this.plan, target, id);
      return cardHtml(id, { facing: facings[Math.max(0, target)], disabled: used || !ok, selected: used, spent: isSpent(me, id) });
    });
    this.q<HTMLButtonElement>('[data-act="lock"]').disabled = planError(me, this.plan) !== null;
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
      if (id) pos = movePos(this.state.arena, pos, getCard(id));
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
    const c = getCard(card);
    const pos = movePos(this.state.arena, before, c);
    const facing = faceTowards(pos, them.pos, slot === 0 ? me.facing : path.facing[slot - 1]);
    // Same colour language as the cards: red = where an attack hits, blue = where a move lands.
    const cls = c.kind === 'attack' ? 'preview-atk' : c.kind === 'trap' ? 'preview-trap' : c.kind === 'move' ? 'preview-move' : 'preview';
    const squares = c.kind === 'attack' || c.kind === 'trap' ? attackArea(this.state.arena, c, pos, facing) : [pos];
    this.showArea(squares, cls);
  }

  /** Side panel with the focused card shown large and described in words. */
  private renderPreviewPanel(): void {
    const panel = this.q('.card-preview');
    if (!this.previewCard) {
      panel.innerHTML = `<p class="preview-hint">${STRINGS.previewHint}</p><p class="preview-hint">${STRINGS.previewHint2}</p>`;
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
      this.setPlan(this.plan.map(() => ''));
      return;
    }
    if (act === 'lock') return this.lockIn();
    const slotEl = target.closest<HTMLElement>('[data-slot]');
    if (slotEl) {
      const i = Number(slotEl.dataset.slot);
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
      if (slot < 0 || !canPlace(me, this.plan, slot, id)) return play('deny');
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
      play('deny');
      const target = under?.closest<HTMLElement>('.slots [data-slot]');
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
    const start = {
      pos: this.state.players.map((p) => ({ ...p.pos })) as [Pos, Pos],
      facing: this.state.players.map((p) => p.facing) as [number, number],
      traps: this.state.arena.traps.map((t) => ({ ...t })),
    };
    this.el.querySelectorAll('.pile-cards').forEach((p) => (p.innerHTML = ''));
    this.q('.step-label').textContent = '';
    this.setMode('reveal');
    play('reveal');
    await this.sleep('intro');

    for (const step of result.steps) {
      await this.animateStep(step, plans);
      if (this.destroyed) return;
    }

    const roundNo = this.state.round;
    this.state = result.state;
    this.lastPlans = [[...plans[0]], [...plans[1]]];
    this.log.rounds.push({ plans: this.lastPlans, result });
    this.el.querySelectorAll('.token').forEach((t) => t.classList.remove('dazed', 'burning'));
    this.renderTraps(this.state.arena.traps);
    if (result.fatigue > 0) {
      const tokens = [this.q('.token.p0'), this.q('.token.p1')];
      this.state.players.forEach((p, i) => {
        this.floatText(p.pos, STRINGS.fatigueFloat(result.fatigue), 'damage fatigue', 0, result.fatigue);
        retrigger(tokens[i], 'shake');
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
    await this.showSummary(roundNo, plans, result, start);
  }

  private async animateStep(step: StepResult, plans: [Plan, Plan]): Promise<void> {
    this.q('.step-label').textContent = STRINGS.stepOf(step.slot + 1, BALANCE.slotsPerRound);
    const players = step.players;
    const tokens = [this.q('.token.p0'), this.q('.token.p1')];
    const color = (i: number) => getFighter(this.state.players[i].fighterId).color;
    const ms = (n: number) => n * speedMultiplier() * this.slow;
    if (step.outcome) this.slow = 1.8;

    // 1. Each player's card lands face down on their pile, then flips over.
    const dealt: HTMLElement[] = [];
    for (const i of [0, 1]) {
      const pile = this.q(`.pile.p${i} .pile-cards`);
      pile.querySelectorAll('.pile-card').forEach((c) => c.classList.add('under'));
      const sp = players[i];
      const card = document.createElement('div');
      card.className = `pile-card face-down${sp.active ? '' : ' inactive'}${sp.stunned ? ' stunned' : ''}`;
      card.style.setProperty('--n', String(step.slot));
      card.innerHTML =
        cardHtml(plans[i][step.slot], { facing: sp.facing, small: true, readonly: true }) +
        (sp.stunned ? `<span class="pile-tag">${STRINGS.stunned}</span>` : '');
      pile.appendChild(card);
      dealt.push(card);
    }
    play('place');
    await wait(ms(240));
    dealt.forEach((c) => {
      c.classList.remove('face-down');
      c.classList.add('flipped');
    });
    play('flip');
    players.forEach((p, i) => {
      if (p.reloaded) {
        this.floatText(p.from, STRINGS.reloaded, 'reload');
        play('reload');
      }
      if (!p.stunned) return;
      tokens[i].classList.remove('dazed');
      this.floatText(p.from, STRINGS.stunned, 'stun');
    });
    await this.sleep('place');

    // 2. Movement: fighters hop to their new squares and kick up a little dust.
    this.placeTokens([players[0].to, players[1].to], [players[0].facing, players[1].facing]);
    if (players[0].swapped) {
      players.forEach((p) => this.floatText(p.to, STRINGS.swappedFloat, 'swap'));
      play('swap');
    }
    if (players.some((p) => p.moved)) {
      players.forEach((p, i) => {
        if (!p.moved) return;
        retrigger(tokens[i], 'hop');
        setTimeout(() => this.fx.particles(p.to, themeColor('--fx-dust'), 6, 'dust'), ms(420));
      });
      play('step');
      await this.sleep('move');
    }

    // Where each token currently stands (pushes move them during the step).
    const posNow: [Pos, Pos] = [players[0].to, players[1].to];
    const stacks = [0, 0];

    /** Attackers wind up, then their squares light up outward from them. */
    const windUp = async (who: number[]) => {
      who.forEach((i) => retrigger(tokens[i], 'charge'));
      await wait(ms(260));
      for (const i of who) {
        const kind = fxKind(getCard(players[i].cardId));
        this.showArea(players[i].area, `area-p${i}`, posNow[i], kind);
        play(kind);
      }
      await this.sleep('area');
    };

    /**
     * Impact on `defenders` (hits, guards, counters, stuns, pushes) and the life gained by
     * `healers` (heals, drains). Returns whether anything happened.
     */
    const impact = async (defenders: number[], healers: number[], lives: [number, number] | null): Promise<boolean> => {
      const lands = defenders.some((i) => players[i].damageTaken > 0 || players[i].counterTaken > 0);
      if (lands && fullEffects()) await wait(90);
      const sounds: SoundId[] = [];
      let biggest = 0;
      for (const i of defenders) {
        const p = players[i];
        const o = i === 0 ? 1 : 0;
        const token = tokens[i];
        if (p.hit === 'hit' || (p.hit === 'guard' && p.damageTaken > 0)) {
          retrigger(token, 'shake');
          retrigger(token, 'flash');
          this.fx.particles(posNow[i], color(o), 10);
          if (p.hit === 'guard') this.fx.ring(posNow[i], 'shield');
          this.floatText(posNow[i], `-${p.damageTaken}`, p.hit === 'guard' ? 'guarded' : 'damage', stacks[i]++, p.damageTaken);
          biggest = Math.max(biggest, p.damageTaken);
          sounds.push(p.hit === 'hit' ? 'hit' : 'guard');
        } else if (p.hit === 'guard') {
          this.fx.ring(posNow[i], 'shield');
          this.floatText(posNow[i], STRINGS.guarded, 'guarded', stacks[i]++);
          sounds.push('guard');
        } else if (p.hit === 'miss') {
          // A miss shows nothing on the opponent; the attack's squares simply don't hit them.
          sounds.push('miss');
        }
        if (p.counterTaken > 0) {
          // Sparks fly back from the defender into this attacker.
          this.fx.travel(posNow[o], posNow[i], themeColor('--fx-counter'), 4, 'spark');
          const k = stacks[i]++;
          setTimeout(() => {
            retrigger(token, 'shake');
            retrigger(token, 'flash');
            this.floatText(posNow[i], `${STRINGS.effectIcons.counter} -${p.counterTaken}`, 'damage', k, p.counterTaken);
          }, ms(fullEffects() ? 420 : 0));
          biggest = Math.max(biggest, p.counterTaken);
          sounds.push('clang');
        }
        if (p.dazed) {
          token.classList.add('dazed');
          this.fx.ring(posNow[i], 'stun');
          this.floatText(posNow[i], STRINGS.dazed, 'stun', stacks[i]++);
          sounds.push('zap');
        }
      }
      for (const j of healers) {
        const p = players[j];
        if (p.drained > 0) {
          this.fx.travel(posNow[j === 0 ? 1 : 0], posNow[j], themeColor('--fx-drain'), 6, 'mote');
          sounds.push('shimmer');
        }
        if (p.healed > 0 || p.drained > 0) {
          this.floatText(posNow[j], `+${p.healed + p.drained}`, 'heal', stacks[j]++);
          if (p.healed > 0) sounds.push('heal');
        }
      }
      [...new Set(sounds)].forEach((id, k) => setTimeout(() => play(id), k * 110));
      if (biggest > 0) {
        const strength = biggest >= 40 ? 3 : biggest >= 25 ? 2 : 1;
        this.fx.shake(strength);
        haptic(strength === 3 ? 'big' : 'hit');
      }
      this.renderHud(lives ?? [players[0].life, players[1].life], [players[0].energy, players[1].energy]);

      // Push and pull land just after the hit.
      const displaced = defenders.filter((i) => !samePos(players[i].to, players[i].final));
      if (displaced.length) {
        await wait(ms(300));
        displaced.forEach((i) => {
          retrigger(tokens[i], 'skid');
          this.fx.particles(posNow[i], themeColor('--fx-dust'), 6, 'dust');
          posNow[i] = players[i].final;
        });
        this.placeTokens(posNow, [players[0].facing, players[1].facing]);
        play('thud');
      }
      return sounds.length > 0;
    };

    // 3-5. Attacks. When both fighters attack, the stronger attack (or, on a tie, the fighter with
    //      more life) strikes first and the other answers only if still standing.
    let busy = false;
    if (step.sequence) {
      const [first] = step.sequence;
      for (const [k, o] of step.sequence.entries()) {
        const d = o === 0 ? 1 : 0;
        if (players[o].interrupted) {
          this.floatText(posNow[o], STRINGS.tooLate, 'miss', stacks[o]++);
          continue;
        }
        if (o === first) this.floatText(posNow[o], STRINGS.firstStrike, 'first', stacks[o]++);
        await windUp([o]);
        await impact([d], [o], k === 0 ? step.midLives : null);
        if (k === 0) {
          await this.sleep('hit');
          this.clearAreas();
        }
      }
      busy = true;
    } else {
      const attackers = [0, 1].filter((i) => players[i].area.length > 0);
      if (attackers.length) await windUp(attackers);
      const happened = await impact([0, 1], [0, 1], null);
      busy = attackers.length > 0 || happened;
    }

    // Arena squares: thorns hurt, springs restore energy, for whoever ended the step on one.
    players.forEach((p, i) => {
      if (p.tile === 'spikes') {
        this.floatText(p.final, `-${BALANCE.tiles.spikes}`, 'damage', stacks[i]++, BALANCE.tiles.spikes);
        retrigger(tokens[i], 'shake');
        play('thud');
      } else if (p.tile === 'well') {
        this.floatText(p.final, `+${BALANCE.tiles.well}⚡`, 'energy', stacks[i]++);
        play('shimmer');
      }
    });

    // Traps spring, burns tick, then any new traps appear.
    players.forEach((p, i) => {
      if (p.trapDamage > 0) {
        this.floatText(p.final, STRINGS.trapped(p.trapDamage), 'damage', stacks[i]++, p.trapDamage);
        retrigger(tokens[i], 'shake');
        play('trap');
      }
      if (p.burnDamage > 0) {
        this.floatText(p.final, STRINGS.burned(p.burnDamage), 'burn', stacks[i]++, p.burnDamage);
        play('burn');
      }
      tokens[i].classList.toggle('burning', p.burning > 0);
    });
    if (this.renderTraps(step.traps, true)) play('place');
    if (players.some((p) => p.trapDamage > 0 || p.burnDamage > 0)) {
      this.renderHud([players[0].life, players[1].life], [players[0].energy, players[1].energy]);
    }

    // 6. Knockout: flash, and the loser falls.
    if (step.outcome) {
      await wait(ms(250));
      play('ko');
      haptic('ko');
      if (fullEffects()) retrigger(this.el, 'ko-flash');
      const w = step.outcome.winner;
      tokens.forEach((t, i) => {
        if (w === null || w !== i) t.classList.add('ko', 'ko-fall');
      });
    }
    await this.sleep(busy ? 'hit' : 'quiet');
    this.slow = 1;
    this.clearAreas();
  }

  /** Put the board back to the end-of-round state (after a replay). */
  private restoreBoard(): void {
    this.clearAreas();
    this.renderTraps(this.state.arena.traps);
    this.el.querySelectorAll('.summary .now').forEach((e) => e.classList.remove('now'));
    const ps = this.state.players;
    this.placeTokens([ps[0].pos, ps[1].pos], [ps[0].facing, ps[1].facing]);
    const o = this.state.outcome;
    [0, 1].forEach((i) => {
      const t = this.q(`.token.p${i}`);
      t.classList.remove('dazed', 'hop', 'shake', 'flash');
      t.classList.toggle('ko', !!o && (o.winner === null || o.winner !== i));
      t.classList.remove('ko-fall');
    });
  }

  /**
   * Loop the round on the board (silently): moves, attacks in their real order, hits and pushes,
   * with a short pause before each loop. Runs until `replayRun` changes.
   */
  private async replayRound(result: RoundResult, start: { pos: [Pos, Pos]; facing: [number, number]; traps: Trap[] }, run: number): Promise<void> {
    const CANCELLED = Symbol('cancelled');
    const tokens = [this.q('.token.p0'), this.q('.token.p1')];
    const pause = async (ms: number) => {
      await wait(ms * speedMultiplier());
      while (this.paused && this.replayRun === run && !this.destroyed) await wait(100);
      if (this.replayRun !== run || this.destroyed) throw CANCELLED;
    };
    const mark = (slot: number | null) =>
      this.el.querySelectorAll<HTMLElement>('.summary [data-step]').forEach((e) => e.classList.toggle('now', Number(e.dataset.step) === slot));
    try {
      for (;;) {
        mark(null);
        tokens.forEach((t) => t.classList.remove('ko', 'ko-fall', 'dazed'));
        this.clearAreas();
        this.renderTraps(start.traps);
        this.placeTokens(start.pos, start.facing);
        await pause(700);
        for (const step of result.steps) {
          const P = step.players;
          const facing: [number, number] = [P[0].facing, P[1].facing];
          const posNow: [Pos, Pos] = [P[0].to, P[1].to];
          mark(step.slot);
          this.placeTokens(posNow, facing);
          P.forEach((p, i) => p.moved && retrigger(tokens[i], 'hop'));
          await pause(P.some((p) => p.moved) ? 550 : 250);

          // Same order as the real reveal: one strike at a time when both attack.
          const strikes = step.sequence
            ? step.sequence.filter((o) => !P[o].interrupted).map((o) => [o])
            : [[0, 1].filter((i) => P[i].area.length > 0)];
          for (const group of strikes) {
            if (!group.length) continue;
            for (const o of group) this.showArea(P[o].area, `area-p${o}`, posNow[o], fxKind(getCard(P[o].cardId)));
            await pause(650);
            for (const o of group) {
              const d = o === 0 ? 1 : 0;
              if (P[d].damageTaken > 0) {
                retrigger(tokens[d], 'flash');
                retrigger(tokens[d], 'shake');
                this.floatText(posNow[d], `-${P[d].damageTaken}`, 'damage', 0, P[d].damageTaken);
              } else if (P[d].hit === 'guard') {
                this.floatText(posNow[d], STRINGS.guarded, 'guarded');
              }
              if (P[o].counterTaken > 0) this.floatText(posNow[o], `${STRINGS.effectIcons.counter} -${P[o].counterTaken}`, 'damage', 1);
              posNow[d] = P[d].final;
            }
            this.placeTokens(posNow, facing);
            await pause(500);
            this.clearAreas();
          }
          this.placeTokens([P[0].final, P[1].final], facing);
          this.renderTraps(step.traps);
          await pause(300);
        }
        mark(null);
        await pause(1200);
      }
    } catch (e) {
      if (e !== CANCELLED) throw e;
    }
  }

  /** After the round: both players' three cards side by side, in order. */
  private async showSummary(
    roundNo: number,
    plans: [Plan, Plan],
    result: RoundResult,
    start: { pos: [Pos, Pos]; facing: [number, number]; traps: Trap[] },
  ): Promise<void> {
    const summary = this.q('.summary');
    const header = plans[0].map((_, s) => `<span class="slot-label" data-step="${s}">${STRINGS.slot(s + 1)}</span>`).join('');
    const rows = ([0, 1] as Seat[])
      .map((i) => {
        const cells = plans[i]
          .map((id, s) => {
            const step = result.steps[s];
            const facing = step ? step.players[i].facing : result.state.players[i].facing;
            const cls = !step ? ' unplayed' : step.players[i].active ? '' : ' inactive';
            return `<div class="sum-cell${cls}" data-step="${s}" title="${!step ? STRINGS.notPlayed : ''}">${cardHtml(id, { facing, small: true, readonly: true })}</div>`;
          })
          .join('');
        return `<div class="sum-row p${i}"><span class="sum-name">${this.seats[i].name}</span>${cells}</div>`;
      })
      .join('');
    const label = result.state.outcome ? STRINGS.seeResult : STRINGS.nextRound;
    summary.innerHTML = `<h3>${STRINGS.roundSummary(roundNo)}</h3>
      <div class="sum-grid"><span></span>${header}${rows}</div>
      <div class="row">
        <button class="btn" data-act="replay">${STRINGS.replay}</button>
        <button class="btn primary" data-act="next">${label}</button>
      </div>`;
    this.setMode('summary');
    const replayBtn = summary.querySelector<HTMLElement>('[data-act="replay"]')!;
    const stopReplay = () => {
      this.replayRun++;
      replayBtn.textContent = STRINGS.replay;
      this.restoreBoard();
    };
    const startReplay = () => {
      const run = ++this.replayRun;
      replayBtn.textContent = STRINGS.stopReplay;
      void this.replayRound(result, start, run);
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
    await this.opts.hooks?.roundEnd?.(this, roundNo, result);
    return done;
  }
}
