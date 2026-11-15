import { play } from '../audio/sfx';
import { BONUS_CARD_IDS, FIGHTERS, getCard } from '../content/cards';
import { fairCost, fairness } from '../content/fairCost';
import { STRINGS } from '../content/strings';
import type { CardDef } from '../engine/types';
import {
  CARD_LIMIT,
  CUSTOM_KINDS,
  cleanName,
  customCards,
  customHeroes,
  deleteCard,
  deleteHero,
  DRAIN_STEPS,
  HEAL_BELOW,
  HERO_CARDS,
  HERO_COLORS,
  HERO_LIMIT,
  heroesUsing,
  heroFighter,
  LIMITS,
  NAME_MAX,
  newId,
  okPattern,
  saveCard,
  saveHero,
  type CustomHero,
  type CustomKind,
} from '../meta/custom';
import { cardHtml, describeCard } from './card';
import { EMBLEM_KEYS, emblemHtml } from './emblems';

/*
 * The hero creator: My heroes (list), the hero editor (name, icon, colour, 4 cards), a card picker
 * (other fighters' cards, bonus cards, your own) and the card editor (squares, effects, cost).
 * Screens are drawn with the main menu's helpers, passed in as `Screens`.
 */

export interface Screens {
  screen(html: string, cls?: string): HTMLElement;
  on(root: HTMLElement, sel: string, fn: (el: HTMLElement) => void): void;
  modal(html: string, bind?: (box: HTMLElement) => void): void;
  /** Back to the main menu. */
  menu(): void;
}

const H = () => STRINGS.hero;

// ---------- My heroes ----------

/** Every custom hero, with Edit / Delete, and a New hero button. */
export function myHeroes(ui: Screens): void {
  const heroes = customHeroes();
  const rows = heroes.length ? heroes.map(heroRow).join('') : `<p class="note">${H().empty}</p>`;
  const root = ui.screen(
    `<h2>${H().title}</h2>
     <p class="note">${H().intro}</p>
     <div class="hero-list">${rows}</div>
     <div class="row">
       <button class="btn ghost-btn" data-act="back">${STRINGS.back}</button>
       <button class="btn primary" data-act="new"${heroes.length >= HERO_LIMIT ? ' disabled' : ''}>${H().newHero}</button>
     </div>`,
    'heroes-screen',
  );
  ui.on(root, '[data-act="back"]', () => ui.menu());
  ui.on(root, '[data-act="new"]', () => heroEditor(ui, { id: newId('ch'), name: '', emblem: EMBLEM_KEYS[0], color: HERO_COLORS[6], cards: [] }));
  ui.on(root, '[data-edit]', (el) => {
    const h = heroes.find((x) => x.id === el.dataset.edit);
    if (h) heroEditor(ui, { ...h, cards: [...h.cards] });
  });
  ui.on(root, '[data-delete]', (el) => {
    const h = heroes.find((x) => x.id === el.dataset.delete);
    if (!h) return;
    ui.modal(`<h2>${H().deleteHero(h.name)}</h2><button class="btn danger" data-confirm>${H().delete}</button>`, (box) =>
      box.querySelector('[data-confirm]')!.addEventListener('click', () => {
        play('click');
        deleteHero(h.id);
        box.closest('.modal')?.remove();
        myHeroes(ui);
      }),
    );
  });
}

function heroRow(h: CustomHero): string {
  return `<div class="hero-row" style="--clr:${h.color}">
    ${emblemHtml(heroFighter(h), 'hero-emblem')}
    <div class="hero-row-main"><b>${h.name}</b><div class="hero-row-cards">${h.cards.map((id) => cardHtml(id, { small: true, readonly: true })).join('')}</div></div>
    <div class="hero-row-acts"><button class="btn" data-edit="${h.id}">${H().edit}</button><button class="btn ghost-btn" data-delete="${h.id}">${H().delete}</button></div>
  </div>`;
}

// ---------- Hero editor ----------

/** Edit a hero (a copy: nothing is saved until Save). */
function heroEditor(ui: Screens, draft: CustomHero): void {
  const isNew = !customHeroes().some((h) => h.id === draft.id);
  const root = ui.screen(
    `<h2>${isNew ? H().newTitle : H().editTitle}</h2>
     <div class="hero-editor">
       <div class="hero-head"><span class="hero-head-emblem"></span><b class="hero-head-name"></b></div>
       <label class="field"><span>${H().name}</span>
         <input class="text-input" data-name maxlength="${NAME_MAX}" placeholder="${H().namePlaceholder}" autocomplete="off" spellcheck="false"></label>
       <div class="field"><span>${H().icon}</span><div class="emblem-picks"></div></div>
       <div class="field"><span>${H().colour}</span><div class="colour-picks"></div></div>
       <div class="field"><span class="cards-label"></span><p class="note">${H().cardsHint}</p><div class="hero-slots"></div></div>
       <p class="note warn form-error"></p>
       <div class="row setup-actions">
         <button class="btn ghost-btn" data-act="back">${H().cancel}</button>
         <button class="btn primary" data-act="save">${H().save}</button>
       </div>
     </div>`,
    'hero-screen',
  );
  const nameInput = root.querySelector<HTMLInputElement>('[data-name]')!;
  nameInput.value = draft.name;
  const error = root.querySelector<HTMLElement>('.form-error')!;
  const head = () => {
    root.querySelector('.hero-head-emblem')!.innerHTML = emblemHtml(heroFighter(draft), 'hero-big');
    // Typed text goes in as text, never as HTML.
    root.querySelector('.hero-head-name')!.textContent = cleanName(draft.name) || H().namePlaceholder;
  };
  const render = () => {
    root.style.setProperty('--clr', draft.color);
    head();
    const f = heroFighter(draft);
    root.querySelector('.emblem-picks')!.innerHTML = EMBLEM_KEYS.map(
      (k) => `<button class="emblem-pick${k === draft.emblem ? ' on' : ''}" data-emblem="${k}" aria-label="${k}">${emblemHtml({ ...f, emblem: k }, 'pick-icon')}</button>`,
    ).join('');
    root.querySelector('.colour-picks')!.innerHTML = HERO_COLORS.map(
      (c) => `<button class="colour-pick${c === draft.color ? ' on' : ''}" data-colour="${c}" style="--c:${c}" aria-label="${c}"></button>`,
    ).join('');
    root.querySelector('.cards-label')!.textContent = H().cards(draft.cards.length, HERO_CARDS);
    root.querySelector('.hero-slots')!.innerHTML = Array.from({ length: HERO_CARDS }, (_, i) => {
      const id = draft.cards[i];
      const inner = id ? cardHtml(id, { small: true, readonly: true }) : `<span class="empty"><b>${i + 1}</b>${H().choose}</span>`;
      return `<button class="hero-slot" data-slot="${Math.min(i, draft.cards.length)}">${inner}</button>`;
    }).join('');
  };
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
    error.textContent = '';
    head();
  });
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const emblem = t.closest<HTMLElement>('[data-emblem]');
    const colour = t.closest<HTMLElement>('[data-colour]');
    const slot = t.closest<HTMLElement>('[data-slot]');
    if (emblem) draft.emblem = emblem.dataset.emblem!;
    else if (colour) draft.color = colour.dataset.colour!;
    else if (slot) return void (play('click'), pickCard(ui, draft, Number(slot.dataset.slot), () => heroEditor(ui, draft)));
    else return;
    play('click');
    render();
  });
  ui.on(root, '[data-act="back"]', () => myHeroes(ui));
  ui.on(root, '[data-act="save"]', () => {
    const missing = HERO_CARDS - draft.cards.length;
    const problem = !cleanName(draft.name) ? H().needName : missing > 0 ? H().needCards(missing) : '';
    if (problem) return void (play('deny'), (error.textContent = problem));
    if (!saveHero({ ...draft, name: cleanName(draft.name) })) return void (play('deny'), (error.textContent = H().full(HERO_LIMIT)));
    myHeroes(ui);
  });
  render();
}

// ---------- Card picker ----------

/** Choose the card for slot `slot` of the hero (replacing what's there, or adding one). */
function pickCard(ui: Screens, draft: CustomHero, slot: number, reopen: () => void): void {
  const current = draft.cards[slot];
  // Start on the tab the slot's card comes from.
  let tab: 'fighters' | 'mine' = current?.startsWith('cc-') ? 'mine' : 'fighters';
  const put = (id: string) => {
    if (slot < draft.cards.length) draft.cards[slot] = id;
    else draft.cards.push(id);
  };
  ui.modal(
    `<h2>${H().pickCard}</h2><div class="gl-tabs picker-tabs"></div><div class="picker-body"></div>
     ${current ? `<button class="btn ghost-btn" data-remove>${H().remove}</button>` : ''}`,
    (box) => {
      const close = () => box.closest('.modal')?.remove();
      const taken = (id: string) => draft.cards.includes(id) && id !== current;
      const cardButton = (id: string) =>
        `<button class="pick-card${taken(id) ? ' taken' : ''}${id === current ? ' on' : ''}" data-pick="${id}"${taken(id) ? ' disabled' : ''}>${cardHtml(id, { small: true, readonly: true })}</button>`;
      const group = (title: string, ids: string[], clr = '') =>
        `<div class="picker-group"><h4${clr ? ` style="color:${clr}"` : ''}>${title}</h4><div class="picker-cards">${ids.map(cardButton).join('')}</div></div>`;
      const render = () => {
        box.querySelector('.picker-tabs')!.innerHTML = (['fighters', 'mine'] as const)
          .map((t) => `<button class="chip${t === tab ? ' on' : ''}" data-tab="${t}">${t === 'fighters' ? H().fightersCards : H().myCards}</button>`)
          .join('');
        const body = box.querySelector('.picker-body')!;
        if (tab === 'fighters') {
          // Ferro's Reload is left out: without his Magazine passive it does nothing.
          body.innerHTML =
            FIGHTERS.map((f) => group(f.name, f.signature.filter((id) => getCard(id).kind !== 'reload'), f.color)).join('') +
            group(H().bonusCards, BONUS_CARD_IDS);
        } else {
          const mine = customCards();
          const list = mine.length
            ? `<div class="picker-cards">${mine.map((c) => `<div class="mine-card">${cardButton(c.id)}<button class="btn ghost-btn mini" data-editcard="${c.id}">${H().edit}</button></div>`).join('')}</div>`
            : `<p class="note">${H().noCards}</p>`;
          body.innerHTML = `${list}<button class="btn" data-newcard${mine.length >= CARD_LIMIT ? ' disabled' : ''}>${H().newCard}</button>`;
        }
      };
      box.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const tabEl = t.closest<HTMLElement>('[data-tab]');
        const pick = t.closest<HTMLButtonElement>('[data-pick]');
        const edit = t.closest<HTMLElement>('[data-editcard]');
        if (tabEl) {
          play('click');
          tab = tabEl.dataset.tab as typeof tab;
          render();
        } else if (pick && !pick.disabled) {
          play('place');
          put(pick.dataset.pick!);
          close();
          reopen();
        } else if (t.closest('[data-remove]')) {
          play('click');
          draft.cards.splice(slot, 1);
          close();
          reopen();
        } else if (edit) {
          play('click');
          close();
          cardEditor(ui, structuredClone(getCard(edit.dataset.editcard!)), () => reopen());
        } else if (t.closest('[data-newcard]:not([disabled])')) {
          play('click');
          close();
          cardEditor(ui, newCard('attack', newId('cc'), ''), (saved) => {
            if (saved && !taken(saved.id)) put(saved.id);
            reopen();
          });
        }
      });
      render();
    },
  );
}

// ---------- Card editor ----------

/** A fresh card of a kind, with sensible starting numbers. */
function newCard(kind: CustomKind, id: string, name: string): CardDef {
  const base = { id, name, kind };
  switch (kind) {
    case 'attack':
      return { ...base, cost: -15, damage: 20, pattern: ['000', '011', '000'] };
    case 'trap':
      return { ...base, cost: -10, trap: 20, pattern: ['000', '001', '000'] };
    case 'guard':
      return { ...base, cost: 0, guard: 20 };
    case 'move':
      return { ...base, cost: 0, step: [0, 1] };
    case 'heal':
      return { ...base, cost: -15, heal: 20 };
  }
}

type NumKey = 'cost' | 'damage' | 'trap' | 'guard' | 'heal' | 'counter' | 'blockSap' | 'sap' | 'hex' | 'recoil' | 'vsMoved';
/** Effects that are off at 0 (the field is then left out of the card). */
const OPTIONAL: NumKey[] = ['counter', 'blockSap', 'sap', 'hex', 'recoil', 'vsMoved'];

/** Make or change a custom card. `done` gets the saved card, or null (cancelled or deleted). */
function cardEditor(ui: Screens, d: CardDef, done: (saved: CardDef | null) => void): void {
  const isNew = !customCards().some((c) => c.id === d.id);
  const root = ui.screen(
    `<h2>${isNew ? H().cardNew : H().cardEdit}</h2>
     <div class="card-editor">
       <div class="ce-preview"></div>
       <div class="ce-form">
         <label class="field"><span>${H().cardName}</span>
           <input class="text-input" data-name maxlength="${NAME_MAX}" placeholder="${H().untitledCard}" autocomplete="off" spellcheck="false"></label>
         <div class="ce-fields"></div>
         <p class="note warn form-error"></p>
       </div>
       <div class="row setup-actions">
         <button class="btn ghost-btn" data-act="back">${H().cancel}</button>
         ${isNew ? '' : `<button class="btn danger" data-act="delete">${H().deleteCard}</button>`}
         <button class="btn primary" data-act="save">${H().save}</button>
       </div>
     </div>`,
    'card-editor-screen',
  );
  const nameInput = root.querySelector<HTMLInputElement>('[data-name]')!;
  nameInput.value = d.name;
  const fields = root.querySelector<HTMLElement>('.ce-fields')!;
  const error = root.querySelector<HTMLElement>('.form-error')!;

  const get = (k: NumKey) => (k === 'cost' ? -d.cost : (d[k] ?? 0));
  const set = (k: NumKey, v: number) => {
    if (k === 'cost') d.cost = -v;
    else if (OPTIONAL.includes(k) && v === 0) delete d[k];
    else d[k] = v;
  };
  const range = (k: NumKey): readonly number[] => (OPTIONAL.includes(k) ? [0, LIMITS[k][1]] : LIMITS[k]);
  const stepper = (k: NumKey, label: string) => {
    const v = get(k);
    const shown = v === 0 && OPTIONAL.includes(k) ? H().off : String(v);
    return `<div class="field stepper-row"><span>${label}</span><div class="stepper" data-num="${k}">
      <button data-step="-5" aria-label="−"${v <= range(k)[0] ? ' disabled' : ''}>−</button><b>${shown}</b><button data-step="5" aria-label="+"${v >= range(k)[1] ? ' disabled' : ''}>+</button></div></div>`;
  };
  const chipRow = (label: string, key: string, options: { v: number | string; label: string }[], current: number | string) =>
    `<div class="field"><span>${label}</span><div class="chips">${options
      .map((o) => `<button class="chip${o.v === current ? ' on' : ''}" data-chip="${key}" data-v="${o.v}">${o.label}</button>`)
      .join('')}</div></div>`;
  const toggle = (key: 'stun' | 'planted' | 'forward' | 'swap' | 'reach', label: string, on: boolean) =>
    `<button class="chip${on ? ' on' : ''}" data-toggle="${key}">${label}</button>`;

  /** The squares grid (attack and trap), written facing right with the user in the middle. */
  const squaresGrid = () => {
    const p = d.pattern ?? ['000', '000', '000'];
    const cols = p[0].length;
    const mid = (cols - 1) / 2;
    const cells = p
      .flatMap((row, r) =>
        [...row].map((v, c) => `<button class="sq${v === '1' ? ` on ${d.kind}` : ''}${r === 1 && c === mid ? ' me' : ''}" data-sq="${r},${c}" aria-label="${r},${c}"></button>`),
      )
      .join('');
    return `<div class="field"><span>${H().squares}</span><p class="note">${H().squaresHint}</p>
      <div class="sq-grid" style="--gc:${cols}">${cells}</div><div class="chips">${toggle('reach', H().reach, cols === 5)}</div></div>`;
  };
  /** Where a move card goes: a 5×5 grid around the user. */
  const destinationGrid = () => {
    const [sr, sc] = d.step ?? [0, 0];
    const cells: string[] = [];
    for (let r = -2; r <= 2; r++)
      for (let c = -2; c <= 2; c++) {
        const me = !r && !c;
        const on = !d.swap && r === sr && c === sc;
        cells.push(`<button class="sq${on ? ' on move' : ''}${me ? ' me' : ''}" data-dest="${r},${c}"${me || d.swap ? ' disabled' : ''} aria-label="${r},${c}"></button>`);
      }
    return `<div class="field"><span>${H().destination}</span><p class="note">${H().destinationHint}</p>
      <div class="sq-grid" style="--gc:5">${cells.join('')}</div>
      <div class="chips">${toggle('forward', H().forward, !!d.forward)}${toggle('swap', H().swap, !!d.swap)}</div></div>`;
  };

  const renderPreview = () => {
    const shown = { ...d, name: cleanName(d.name) || H().untitledCard };
    const desc = describeCard(shown);
    root.querySelector('.ce-preview')!.innerHTML = `${cardHtml(shown, { readonly: true })}
      ${desc ? `<p class="desc">${desc}</p>` : ''}
      <p class="fair ${fairness(shown)}">${H().fairCost(fairCost(shown))} <b>${H().fairness[fairness(shown)]}</b></p>`;
  };
  const render = () => {
    const E = STRINGS.effectNames;
    const kinds = chipRow(H().kind, 'kind', CUSTOM_KINDS.map((k) => ({ v: k, label: STRINGS.kindNames[k] })), d.kind);
    let body = '';
    if (d.kind === 'attack') {
      body =
        squaresGrid() +
        stepper('damage', H().damage) +
        chipRow(E.push + ' / ' + E.pull, 'push', [0, 1, 2, -1, -2].map((v) => ({ v, label: v ? H().pushN(v) : H().none })), d.push ?? 0) +
        chipRow(E.drain, 'drain', [0, ...DRAIN_STEPS].map((v) => ({ v, label: v ? `${v}%` : H().off })), d.drain ?? 0) +
        stepper('sap', E.sap) +
        stepper('hex', E.hex) +
        stepper('recoil', E.recoil) +
        stepper('vsMoved', H().vsMoved) +
        `<div class="field"><span>${H().effects}</span><div class="chips">${toggle('stun', E.stun, !!d.stun)}${toggle('planted', E.planted, !!d.planted)}</div></div>`;
    } else if (d.kind === 'trap') body = squaresGrid() + stepper('trap', H().trapDamage);
    else if (d.kind === 'guard') body = stepper('guard', H().guard) + stepper('counter', E.counter) + stepper('blockSap', H().drainsEnergy);
    else if (d.kind === 'move') body = destinationGrid() + stepper('counter', E.counter);
    else if (d.kind === 'heal')
      body = stepper('heal', H().heal) + chipRow(H().healBelow, 'healBelow', [0, ...HEAL_BELOW].map((v) => ({ v, label: v ? String(v) : H().any })), d.healAtOrBelow ?? 0);
    fields.innerHTML = kinds + body + stepper('cost', H().cost);
    renderPreview();
  };

  nameInput.addEventListener('input', () => {
    d.name = nameInput.value;
    renderPreview();
  });
  fields.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const stepBtn = t.closest<HTMLButtonElement>('[data-step]');
    const chip = t.closest<HTMLElement>('[data-chip]');
    const tog = t.closest<HTMLElement>('[data-toggle]');
    const sq = t.closest<HTMLElement>('[data-sq]');
    const dest = t.closest<HTMLButtonElement>('[data-dest]');
    if (stepBtn && !stepBtn.disabled) {
      const k = stepBtn.closest<HTMLElement>('[data-num]')!.dataset.num as NumKey;
      const [lo, hi] = range(k);
      set(k, Math.min(hi, Math.max(lo, get(k) + Number(stepBtn.dataset.step))));
    } else if (chip) {
      const key = chip.dataset.chip!;
      const v = chip.dataset.v!;
      if (key === 'kind') {
        if (v === d.kind) return;
        const fresh = newCard(v as CustomKind, d.id, d.name);
        for (const k of Object.keys(d) as (keyof CardDef)[]) delete d[k];
        Object.assign(d, fresh);
      } else if (key === 'push') {
        if (Number(v)) d.push = Number(v);
        else delete d.push;
      } else if (key === 'drain') {
        if (Number(v)) d.drain = Number(v);
        else delete d.drain;
      } else if (key === 'healBelow') {
        if (Number(v)) d.healAtOrBelow = Number(v);
        else delete d.healAtOrBelow;
      }
    } else if (tog) {
      const key = tog.dataset.toggle as 'stun' | 'planted' | 'forward' | 'swap' | 'reach';
      if (key === 'reach') {
        const p = d.pattern ?? ['000', '000', '000'];
        // 3 wide <-> 5 wide, keeping the squares around the user.
        d.pattern = (p[0].length === 3 ? p.map((r) => `0${r}0`) : p.map((r) => r.slice(1, 4))) as [string, string, string];
      } else if (d[key]) delete d[key];
      else {
        d[key] = true;
        // A swap has no step of its own; choosing a direction again turns the swap off.
        if (key === 'swap') {
          delete d.step;
          delete d.forward;
        }
        if (key === 'forward') delete d.swap;
      }
      if (key === 'forward' || key === 'swap') {
        if (!d.swap && !d.step) d.step = [0, 1];
      }
    } else if (sq && d.pattern) {
      const [r, c] = sq.dataset.sq!.split(',').map(Number);
      const row = [...d.pattern[r]];
      row[c] = row[c] === '1' ? '0' : '1';
      d.pattern[r] = row.join('');
    } else if (dest && !dest.disabled) {
      const [r, c] = dest.dataset.dest!.split(',').map(Number);
      d.step = [r, c];
    } else return;
    play('click');
    error.textContent = '';
    render();
  });
  ui.on(root, '[data-act="back"]', () => done(null));
  ui.on(root, '[data-act="delete"]', () => {
    const users = heroesUsing(d.id);
    if (users.length) return void (play('deny'), (error.textContent = H().cardInUse(users.map((h) => h.name).join(', '))));
    deleteCard(d.id);
    done(null);
  });
  ui.on(root, '[data-act="save"]', () => {
    const problem =
      (d.kind === 'attack' || d.kind === 'trap') && !okPattern(d.pattern)
        ? H().needSquares
        : d.kind === 'move' && !d.swap && !(d.step && (d.step[0] || d.step[1]))
          ? H().needDestination
          : '';
    if (problem) return void (play('deny'), (error.textContent = problem));
    const saved = saveCard({ ...d, name: cleanName(d.name) || H().untitledCard });
    if (!saved) return void (play('deny'), (error.textContent = H().full(CARD_LIMIT)));
    done(saved);
  });
  render();
}
