import { isSoundEnabled, play, setSoundEnabled } from '../audio/sfx';
import { BALANCE } from '../content/balance';
import { getCard, getFighter } from '../content/cards';
import { STRINGS } from '../content/strings';
import {
  attackArea,
  autoFillPlan,
  canPlace,
  energyRecovery,
  faceTowards,
  movePos,
  partialPlanOk,
  planEnergyTrace,
  planError,
  resolveRound,
  samePos,
} from '../engine/rules';
import type { MatchOutcome, MatchState, Plan, Pos, RoundResult, Seat, StepResult } from '../engine/types';
import type { PlanSource } from '../net/transport';
import { getPlanTimer, getSpeed, setPlanTimer, setSpeed, speedMultiplier, type PlanTimer, type Speed } from '../settings';
import { cardHtml, describeCard, groupedCardsHtml, passiveHtml } from './card';
import { enableDrag } from './drag';
import { emblemHtml } from './emblems';

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
  private timerId: number | null = null;
  private coachHighlight: string | null = null;

  constructor(
    private root: HTMLElement,
    initial: MatchState,
    private seats: [BattleSeat, BattleSeat],
    private onEnd: (outcome: MatchOutcome, state: MatchState) => void,
    private onQuit: () => void,
    private opts: BattleOptions = {},
  ) {
    this.state = initial;
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
    await wait(TIMING[key] * speedMultiplier());
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
    this.onEnd(this.state.outcome!, this.state);
  }

  // ---------- static layout ----------

  private renderShell(): void {
    const tiles = Array.from({ length: BALANCE.rows * BALANCE.cols }, (_, i) => {
      const r = Math.floor(i / BALANCE.cols);
      const c = i % BALANCE.cols;
      return `<div class="tile" data-r="${r}" data-c="${c}"></div>`;
    }).join('');
    const tokens = this.state.players
      .map((p, i) => `<div class="token p${i}" data-seat="${i}" title="${this.seats[i].name}" style="--clr:${getFighter(p.fighterId).color}">
          ${emblemHtml(getFighter(p.fighterId), 'token-art')}<span class="facing"></span></div>`)
      .join('');
    const pile = (i: number) => `<div class="pile p${i}"><span class="pile-name">${this.seats[i].name}</span><div class="pile-cards"></div></div>`;
    this.el.innerHTML = `
      <header class="hud">
        <div class="panel p0" data-seat="0"></div>
        <div class="hud-center">
          <div class="round-label"></div>
          <div class="step-label"></div>
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
          <div class="arena" style="--rows:${BALANCE.rows};--cols:${BALANCE.cols}">
            ${tiles}
            <svg class="path" viewBox="0 0 ${BALANCE.cols} ${BALANCE.rows}" preserveAspectRatio="none"><polyline points=""></polyline></svg>
            ${'<div class="ghost hidden"><b></b></div>'.repeat(BALANCE.slotsPerRound)}
            ${tokens}
            <div class="floats"></div>
          </div>
        </div>
        <aside class="side right">
          <div class="card-preview"></div>
          ${pile(1)}
        </aside>
      </div>
      <section class="planner">
        <div class="status"></div>
        <div class="hand grouped"></div>
        <div class="actions">
          <button class="btn ghost-btn" data-act="clear">${STRINGS.clear}</button>
          <button class="btn primary" data-act="lock">${STRINGS.lockIn}<span class="timer"></span></button>
        </div>
      </section>
      <section class="pass"></section>
      <section class="summary"></section>
      <div class="coach hidden"><div class="coach-box"><p></p><button class="btn primary">${STRINGS.gotIt}</button></div></div>
      <div class="modal hidden"><div class="modal-box"></div></div>`;
    this.placeTokens(this.state.players.map((p) => p.pos) as [Pos, Pos]);

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
    this.q('.round-label').textContent = STRINGS.round(this.state.round);
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
            <div class="bar life"><i></i><span></span></div>
            <div class="bar energy"><i></i><em class="planned"></em><span></span></div>
          </div>`;
        panel.style.setProperty('--clr', f.color);
        panel.title = STRINGS.tapHint;
        panel.dataset.ready = '1';
      }
      const lb = panel.querySelector('.bar.life')!;
      (lb.querySelector('i') as HTMLElement).style.width = `${(life / p.lifeMax) * 100}%`;
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
    this.el.querySelectorAll('.tile').forEach((t) => t.classList.remove('area-p0', 'area-p1', 'preview'));
  }

  private showArea(cells: Pos[], cls: string): void {
    for (const p of cells) this.q(`.tile[data-r="${p.r}"][data-c="${p.c}"]`).classList.add(cls);
  }

  /** Rising text over a square. `stack` offsets extra labels so they don't overlap. */
  private floatText(pos: Pos, text: string, cls: string, stack = 0): void {
    const f = document.createElement('div');
    f.className = `float ${cls}`;
    f.textContent = text;
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
    const close = () => {
      modal.classList.add('hidden');
      this.paused = false;
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
       <div class="hand grouped">${groupedCardsHtml(p.deck, (id) => cardHtml(id, { facing: p.facing, readonly: true }))}</div>
       <button class="btn" data-modal="close">${STRINGS.close}</button>`,
    );
  }

  private openMenu(): void {
    play('click');
    const speeds = (['fast', 'normal', 'slow'] as Speed[])
      .map((s) => `<button class="chip${s === getSpeed() ? ' on' : ''}" data-speed="${s}">${STRINGS.speedNames[s]}</button>`)
      .join('');
    const timers = ([0, 30, 60] as PlanTimer[])
      .map((t) => `<button class="chip${t === getPlanTimer() ? ' on' : ''}" data-timer="${t}">${STRINGS.timerName(t)}</button>`)
      .join('');
    this.openModal(
      `<h2>${STRINGS.menuTitle}</h2>
       <div class="menu-list">
         <button class="btn primary" data-modal="close">${STRINGS.resume}</button>
         <button class="btn" data-m="sound">${isSoundEnabled() ? STRINGS.soundOn : STRINGS.soundOff}</button>
         <div class="difficulty"><span>${STRINGS.speed}:</span>${speeds}</div>
         <div class="difficulty"><span>${STRINGS.planTimer}:</span>${timers}</div>
         <details class="menu-rules"><summary>${STRINGS.howToPlay}</summary><ol class="rules">${STRINGS.rules.map((r) => `<li>${r}</li>`).join('')}</ol></details>
         <button class="btn danger" data-m="quit">${STRINGS.quit}</button>
       </div>`,
      (box) => {
        box.querySelector('[data-m="sound"]')!.addEventListener('click', (e) => {
          setSoundEnabled(!isSoundEnabled());
          (e.currentTarget as HTMLElement).textContent = isSoundEnabled() ? STRINGS.soundOn : STRINGS.soundOff;
          play('click');
        });
        box.querySelectorAll<HTMLElement>('[data-speed]').forEach((chip) =>
          chip.addEventListener('click', () => {
            setSpeed(chip.dataset.speed as Speed);
            box.querySelectorAll('[data-speed]').forEach((c) => c.classList.toggle('on', c === chip));
            play('click');
          }),
        );
        box.querySelectorAll<HTMLElement>('[data-timer]').forEach((chip) =>
          chip.addEventListener('click', () => {
            setPlanTimer(Number(chip.dataset.timer) as PlanTimer);
            box.querySelectorAll('[data-timer]').forEach((c) => c.classList.toggle('on', c === chip));
            play('click');
          }),
        );
        box.querySelector('[data-m="quit"]')!.addEventListener('click', () => {
          play('click');
          this.destroyed = true;
          this.paused = false;
          this.stopTimer();
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

  private startTimer(): void {
    const total = this.opts.noTimer ? 0 : getPlanTimer();
    if (!total) return;
    const lock = this.q('[data-act="lock"]');
    let left = total * 1000;
    let lastSecond = Math.ceil(left / 1000);
    lock.classList.add('timed');
    const tick = 250;
    const update = () => {
      lock.style.setProperty('--t', String(left / (total * 1000)));
      const sec = Math.ceil(left / 1000);
      lock.querySelector('.timer')!.textContent = String(sec);
      lock.classList.toggle('urgent', sec <= 10);
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
    const lock = this.el.querySelector<HTMLElement>('[data-act="lock"]');
    if (!lock) return;
    lock.classList.remove('timed', 'urgent');
    lock.querySelector('.timer')!.textContent = '';
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
      return cardHtml(id, { facing: facings[Math.max(0, target)], disabled: used || !ok, selected: used });
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
      if (id) pos = movePos(pos, getCard(id));
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
   * Numbered markers where the plan takes you (1, 2, 3; steps that end on the same square share a
   * marker) joined by a dotted line, assuming the opponent stays put.
   */
  private renderPath(path: { pos: Pos[] }): void {
    this.clearPath();
    const me = this.state.players[this.planSeat];
    const marks: { pos: Pos; steps: number[]; attack: boolean }[] = [];
    let prev = me.pos;
    const line = [me.pos];
    this.plan.forEach((id, i) => {
      if (!id) return;
      const pos = path.pos[i];
      const attack = getCard(id).kind === 'attack';
      if (samePos(pos, prev) && !attack) return;
      const same = marks.find((m) => samePos(m.pos, pos));
      if (same) {
        same.steps.push(i + 1);
        same.attack ||= attack;
      } else marks.push({ pos, steps: [i + 1], attack });
      if (!samePos(pos, line[line.length - 1])) line.push(pos);
      prev = pos;
    });
    const ghosts = this.el.querySelectorAll<HTMLElement>('.ghost');
    marks.slice(0, ghosts.length).forEach((m, k) => {
      const g = ghosts[k];
      g.style.setProperty('--r', String(m.pos.r));
      g.style.setProperty('--c', String(m.pos.c));
      g.classList.toggle('atk', m.attack);
      g.querySelector('b')!.textContent = m.steps.join('·');
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
    const pos = movePos(before, c);
    const facing = faceTowards(pos, them.pos, slot === 0 ? me.facing : path.facing[slot - 1]);
    this.showArea(c.kind === 'attack' ? attackArea(c, pos, facing) : [pos], 'preview');
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
    panel.innerHTML = `${cardHtml(this.previewCard, { facing, readonly: true })}<p class="desc">${describeCard(this.previewCard)}</p>`;
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
    this.el.querySelectorAll('.token').forEach((t) => t.classList.remove('dazed'));
    if (!result.state.outcome) {
      for (const p of this.state.players) this.floatText(p.pos, STRINGS.energyBack(energyRecovery(p)), 'energy');
      this.renderHud();
      await this.sleep('energy');
    } else {
      play('ko');
      const o = result.state.outcome;
      for (const i of [0, 1] as Seat[]) {
        if (o.winner === null || o.winner !== i) this.q(`.token.p${i}`).classList.add('ko');
      }
      await this.sleep('energy');
    }
    if (this.destroyed) return;
    await this.showSummary(roundNo, plans, result);
  }

  private async animateStep(step: StepResult, plans: [Plan, Plan]): Promise<void> {
    this.q('.step-label').textContent = STRINGS.stepOf(step.slot + 1, BALANCE.slotsPerRound);

    // Each player's card lands on top of their pile.
    for (const i of [0, 1]) {
      const pile = this.q(`.pile.p${i} .pile-cards`);
      pile.querySelectorAll('.pile-card').forEach((c) => c.classList.add('under'));
      const sp = step.players[i];
      const card = document.createElement('div');
      card.className = `pile-card${sp.active ? '' : ' inactive'}${sp.stunned ? ' stunned' : ''}`;
      card.style.setProperty('--n', String(step.slot));
      card.innerHTML =
        cardHtml(plans[i][step.slot], { facing: sp.facing, small: true, readonly: true }) +
        (sp.stunned ? `<span class="pile-tag">${STRINGS.stunned}</span>` : '');
      pile.appendChild(card);
      if (sp.stunned) {
        this.q(`.token.p${i}`).classList.remove('dazed');
        this.floatText(sp.from, STRINGS.stunned, 'stun');
      }
    }
    play('place');
    await this.sleep('place');

    // Movement.
    const moved = step.players.some((p) => p.from.r !== p.to.r || p.from.c !== p.to.c);
    this.placeTokens([step.players[0].to, step.players[1].to], [step.players[0].facing, step.players[1].facing]);
    if (moved) {
      play('step');
      await this.sleep('move');
    }

    // Attack areas are shown for a beat before they land.
    const attacking = step.players.some((p) => p.area.length > 0);
    if (attacking) {
      step.players.forEach((p, i) => this.showArea(p.area, `area-p${i}`));
      await this.sleep('area');
    }

    // Hits, guards, heals.
    let sound: Parameters<typeof play>[0] | null = null;
    step.players.forEach((p, i) => {
      const token = this.q(`.token.p${i}`);
      if (p.hit === 'hit' || (p.hit === 'guard' && p.damageTaken > 0)) {
        token.classList.remove('shake');
        void token.offsetWidth;
        token.classList.add('shake');
        this.floatText(p.to, `-${p.damageTaken}`, p.hit === 'guard' ? 'guarded' : 'damage');
        sound = p.hit === 'hit' ? 'hit' : (sound ?? 'guard');
      } else if (p.hit === 'guard') {
        this.floatText(p.to, STRINGS.guarded, 'guarded');
        sound = sound ?? 'guard';
      } else if (p.hit === 'miss') {
        this.floatText(p.to, STRINGS.miss, 'miss');
        sound = sound ?? 'miss';
      }
      let stack = p.hit === 'none' ? 0 : 1;
      if (p.counterTaken > 0) {
        token.classList.remove('shake');
        void token.offsetWidth;
        token.classList.add('shake');
        this.floatText(p.to, `${STRINGS.effectIcons.counter} -${p.counterTaken}`, 'damage', stack++);
        sound = 'hit';
      }
      if (p.healed > 0 || p.drained > 0) {
        this.floatText(p.to, `+${p.healed + p.drained}`, 'heal', stack++);
        sound = sound ?? 'heal';
      }
      if (p.dazed) {
        token.classList.add('dazed');
        this.floatText(p.to, STRINGS.dazed, 'stun', stack++);
      }
    });
    if (sound) play(sound);
    this.renderHud([step.players[0].life, step.players[1].life], [step.players[0].energy, step.players[1].energy]);

    // Push and pull land just after the hit.
    if (step.players.some((p) => !samePos(p.to, p.final))) {
      await wait(300 * speedMultiplier());
      this.placeTokens([step.players[0].final, step.players[1].final], [step.players[0].facing, step.players[1].facing]);
      play('step');
    }
    await this.sleep(attacking || sound ? 'hit' : 'quiet');
    this.clearAreas();
  }

  /** After the round: both players' three cards side by side, in order. */
  private async showSummary(roundNo: number, plans: [Plan, Plan], result: RoundResult): Promise<void> {
    const summary = this.q('.summary');
    const header = plans[0].map((_, s) => `<span class="slot-label">${STRINGS.slot(s + 1)}</span>`).join('');
    const rows = ([0, 1] as Seat[])
      .map((i) => {
        const cells = plans[i]
          .map((id, s) => {
            const step = result.steps[s];
            const facing = step ? step.players[i].facing : result.state.players[i].facing;
            const cls = !step ? ' unplayed' : step.players[i].active ? '' : ' inactive';
            return `<div class="sum-cell${cls}" title="${!step ? STRINGS.notPlayed : ''}">${cardHtml(id, { facing, small: true, readonly: true })}</div>`;
          })
          .join('');
        return `<div class="sum-row p${i}"><span class="sum-name">${this.seats[i].name}</span>${cells}</div>`;
      })
      .join('');
    const label = result.state.outcome ? STRINGS.seeResult : STRINGS.nextRound;
    summary.innerHTML = `<h3>${STRINGS.roundSummary(roundNo)}</h3>
      <div class="sum-grid"><span></span>${header}${rows}</div>
      <button class="btn primary" data-act="next">${label}</button>`;
    this.setMode('summary');
    const done = new Promise<void>((res) => {
      summary.querySelector('[data-act="next"]')!.addEventListener('click', () => {
        play('click');
        res();
      });
    });
    await this.opts.hooks?.roundEnd?.(this, roundNo, result);
    return done;
  }
}
