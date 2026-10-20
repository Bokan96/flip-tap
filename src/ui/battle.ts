import { isSoundEnabled, play, setSoundEnabled } from '../audio/sfx';
import { BALANCE } from '../content/balance';
import { getCard, getFighter } from '../content/cards';
import { STRINGS } from '../content/strings';
import { attackArea, canPlace, faceTowards, movePos, planError, resolveRound } from '../engine/rules';
import type { MatchOutcome, MatchState, Plan, Pos, RoundResult, Seat, StepResult } from '../engine/types';
import type { PlanSource } from '../net/transport';
import { getSpeed, setSpeed, speedMultiplier, type Speed } from '../settings';
import { cardHtml, groupedCardsHtml } from './card';
import { emblemHtml } from './emblems';

export interface BattleSeat {
  name: string;
  source: PlanSource;
}

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
  private paused = false;
  private destroyed = false;

  constructor(
    private root: HTMLElement,
    initial: MatchState,
    private seats: [BattleSeat, BattleSeat],
    private onEnd: (outcome: MatchOutcome, state: MatchState) => void,
    private onQuit: () => void,
  ) {
    this.state = initial;
    this.el = document.createElement('div');
    this.el.className = 'battle';
    this.root.replaceChildren(this.el);
    this.renderShell();
    this.renderHud();
    // Start after construction so plan sources can reference this view.
    setTimeout(() => void this.loop(), 0);
  }

  /** Sleep that respects the speed setting and holds while a menu or deck viewer is open. */
  private async sleep(key: keyof typeof TIMING): Promise<void> {
    await wait(TIMING[key] * speedMultiplier());
    while (this.paused && !this.destroyed) await wait(100);
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
        if (src.kind !== 'human') this.setStatus(STRINGS.cpuThinking, true);
        const plan = await src.requestPlan(this.state, seat);
        if (this.destroyed) return;
        const err = planError(this.state.players[seat], plan);
        if (err) throw new Error(err);
        plans[seat] = plan;
      }
      this.hidePlanner();
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
          <button class="icon-btn" data-act="menu" aria-label="${STRINGS.menuTitle}">☰</button>
        </div>
        <div class="panel p1" data-seat="1"></div>
      </header>
      <div class="arena-wrap">
        <div class="arena" style="--rows:${BALANCE.rows};--cols:${BALANCE.cols}">
          ${tiles}
          <div class="ghost hidden"></div>
          ${tokens}
          <div class="floats"></div>
        </div>
      </div>
      <section class="playout hidden">
        <div class="stage">${pile(0)}<div class="step-label"></div>${pile(1)}</div>
        <div class="summary hidden"></div>
      </section>
      <section class="planner hidden">
        <div class="status"></div>
        <div class="tap-hint">${STRINGS.tapHint}</div>
        <div class="slots"></div>
        <div class="hand grouped"></div>
        <div class="actions">
          <button class="btn ghost-btn" data-act="clear">${STRINGS.clear}</button>
          <button class="btn primary" data-act="lock">${STRINGS.lockIn}</button>
        </div>
      </section>
      <div class="cover hidden"></div>
      <div class="modal hidden"><div class="modal-box"></div></div>`;
    this.placeTokens(this.state.players.map((p) => p.pos) as [Pos, Pos]);

    const planner = this.q('.planner');
    planner.addEventListener('click', (e) => this.onPlannerClick(e));
    planner.addEventListener('pointerover', (e) => this.onPlannerHover(e));
    planner.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.renderPreview();
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.modal, .planner, .cover')) return;
      if (t.closest('[data-act="menu"]')) return this.openMenu();
      const seatEl = t.closest<HTMLElement>('.token, .panel');
      if (seatEl) this.showDeck(Number(seatEl.dataset.seat) as Seat);
    });
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private setRoundLabel(): void {
    this.q('.round-label').textContent = STRINGS.round(this.state.round);
  }

  private setStatus(text: string, waiting = false): void {
    const planner = this.q('.planner');
    this.q('.status').textContent = text;
    if (waiting) {
      planner.classList.remove('hidden');
      planner.classList.add('waiting');
    }
  }

  private hidePlanner(): void {
    this.q('.planner').classList.add('hidden');
    this.q('.ghost').classList.add('hidden');
    this.clearAreas();
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
            <div class="bar energy"><i></i><span></span></div>
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

  private floatText(pos: Pos, text: string, cls: string): void {
    const f = document.createElement('div');
    f.className = `float ${cls}`;
    f.textContent = text;
    f.style.setProperty('--r', String(pos.r));
    f.style.setProperty('--c', String(pos.c));
    this.q('.floats').appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }

  // ---------- overlays ----------

  private passScreen(seat: Seat | null): Promise<void> {
    const cover = this.q('.cover');
    const title = seat === null ? STRINGS.reveal : STRINGS.passDevice(this.seats[seat].name);
    const hint = seat === null ? '' : `<p>${STRINGS.passDeviceHint}</p>`;
    cover.innerHTML = `<div class="cover-box"><h2>${title}</h2>${hint}<button class="btn primary">${STRINGS.ready}</button></div>`;
    cover.classList.remove('hidden');
    return new Promise((res) => {
      cover.querySelector('button')!.addEventListener('click', () => {
        play('click');
        cover.classList.add('hidden');
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
       <div class="hand grouped">${groupedCardsHtml(p.deck, (id) => cardHtml(id, { facing: p.facing, readonly: true }))}</div>
       <button class="btn" data-modal="close">${STRINGS.close}</button>`,
    );
  }

  private openMenu(): void {
    play('click');
    const speeds = (['fast', 'normal', 'slow'] as Speed[])
      .map((s) => `<button class="chip${s === getSpeed() ? ' on' : ''}" data-speed="${s}">${STRINGS.speedNames[s]}</button>`)
      .join('');
    this.openModal(
      `<h2>${STRINGS.menuTitle}</h2>
       <div class="menu-list">
         <button class="btn primary" data-modal="close">${STRINGS.resume}</button>
         <button class="btn" data-m="sound">${isSoundEnabled() ? STRINGS.soundOn : STRINGS.soundOff}</button>
         <div class="difficulty"><span>${STRINGS.speed}:</span>${speeds}</div>
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
        box.querySelector('[data-m="quit"]')!.addEventListener('click', () => {
          play('click');
          this.destroyed = true;
          this.paused = false;
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
    const planner = this.q('.planner');
    planner.classList.remove('hidden', 'waiting');
    planner.dataset.seat = String(seat);
    this.setStatus(STRINGS.planning(this.seats[seat].name));
    return new Promise((res) => {
      this.resolvePlan = res;
      this.renderPlanner();
    });
  }

  private nextEmptySlot(): number {
    return this.plan.findIndex((id) => !id);
  }

  private renderPlanner(): void {
    const me = this.state.players[this.planSeat];
    const facings = this.projectedPath().facing;
    this.q('.slots').innerHTML = this.plan
      .map((id, i) => {
        const inner = id ? cardHtml(id, { facing: facings[i], small: true }) : `<span class="empty">${STRINGS.emptySlot}</span>`;
        const next = i === this.nextEmptySlot() ? ' next' : '';
        return `<div class="slot${next}" data-slot="${i}"><span class="slot-label">${STRINGS.slot(i + 1)}</span>${inner}</div>`;
      })
      .join('');
    const target = this.nextEmptySlot();
    this.q('.hand').innerHTML = groupedCardsHtml(me.deck, (id) => {
      const used = this.plan.includes(id);
      const ok = target >= 0 && canPlace(me, this.plan, target, id);
      return cardHtml(id, { facing: facings[Math.max(0, target)], disabled: used || !ok, selected: used });
    });
    this.q<HTMLButtonElement>('[data-act="lock"]').disabled = planError(me, this.plan) !== null;
    this.renderPreview();
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

  private renderPreview(): void {
    // Only while a human is planning; never touch the board during the reveal animation.
    if (!this.resolvePlan) return;
    this.clearAreas();
    const ghost = this.q('.ghost');
    const path = this.projectedPath();
    if (this.plan.some(Boolean)) {
      const last = path.pos[path.pos.length - 1];
      ghost.style.setProperty('--r', String(last.r));
      ghost.style.setProperty('--c', String(last.c));
      ghost.classList.remove('hidden');
    } else {
      ghost.classList.add('hidden');
    }
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

  private onPlannerHover(e: Event): void {
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (!cardEl) return;
    const slotEl = cardEl.closest<HTMLElement>('[data-slot]');
    const slot = slotEl ? Number(slotEl.dataset.slot) : this.nextEmptySlot();
    if (slot < 0) return;
    this.hovered = { slot, card: cardEl.dataset.card! };
    this.renderPreview();
  }

  private onPlannerClick(e: Event): void {
    if (!this.resolvePlan) return;
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const me = this.state.players[this.planSeat];
    if (act === 'clear') {
      this.plan = this.plan.map(() => '');
      play('place');
      this.renderPlanner();
      return;
    }
    if (act === 'lock') {
      if (planError(me, this.plan)) return play('deny');
      play('click');
      const res = this.resolvePlan;
      this.resolvePlan = null;
      this.q('.planner').classList.add('hidden');
      res([...this.plan]);
      return;
    }
    const slotEl = target.closest<HTMLElement>('[data-slot]');
    if (slotEl) {
      const i = Number(slotEl.dataset.slot);
      if (this.plan[i]) {
        this.plan[i] = '';
        play('place');
        this.renderPlanner();
      }
      return;
    }
    const cardEl = target.closest<HTMLElement>('[data-card]');
    if (cardEl) {
      const slot = this.nextEmptySlot();
      const id = cardEl.dataset.card!;
      if (slot < 0 || !canPlace(me, this.plan, slot, id)) return play('deny');
      this.plan[slot] = id;
      play('place');
      this.hovered = null;
      this.renderPlanner();
    }
  }

  // ---------- resolution ----------

  private async animateRound(plans: [Plan, Plan]): Promise<void> {
    const result = resolveRound(this.state, plans);
    const playout = this.q('.playout');
    this.q('.stage').classList.remove('hidden');
    this.q('.summary').classList.add('hidden');
    this.el.querySelectorAll('.pile-cards').forEach((p) => (p.innerHTML = ''));
    playout.classList.remove('hidden');
    play('reveal');
    await this.sleep('intro');

    for (const step of result.steps) {
      await this.animateStep(step, plans);
      if (this.destroyed) return;
    }

    const roundNo = this.state.round;
    this.state = result.state;
    if (!result.state.outcome) {
      for (const i of [0, 1]) this.floatText(this.state.players[i].pos, STRINGS.energyBack(BALANCE.energyPerRound), 'energy');
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
    playout.classList.add('hidden');
  }

  private async animateStep(step: StepResult, plans: [Plan, Plan]): Promise<void> {
    this.q('.step-label').textContent = STRINGS.stepOf(step.slot + 1, BALANCE.slotsPerRound);

    // Each player's card lands on top of their pile.
    for (const i of [0, 1]) {
      const pile = this.q(`.pile.p${i} .pile-cards`);
      pile.querySelectorAll('.pile-card').forEach((c) => c.classList.add('under'));
      const card = document.createElement('div');
      card.className = `pile-card${step.players[i].active ? '' : ' inactive'}`;
      card.style.setProperty('--n', String(step.slot));
      card.innerHTML = cardHtml(plans[i][step.slot], { facing: step.players[i].facing, readonly: true });
      pile.appendChild(card);
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
      if (p.healed > 0) {
        this.floatText(p.to, `+${p.healed}`, 'heal');
        sound = sound ?? 'heal';
      }
    });
    if (sound) play(sound);
    this.renderHud([step.players[0].life, step.players[1].life], [step.players[0].energy, step.players[1].energy]);
    await this.sleep(attacking || sound ? 'hit' : 'quiet');
    this.clearAreas();
  }

  /** After the round: both players' three cards side by side, in order. */
  private showSummary(roundNo: number, plans: [Plan, Plan], result: RoundResult): Promise<void> {
    this.q('.stage').classList.add('hidden');
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
    summary.classList.remove('hidden');
    return new Promise((res) => {
      summary.querySelector('[data-act="next"]')!.addEventListener('click', () => {
        play('click');
        res();
      });
    });
  }
}
