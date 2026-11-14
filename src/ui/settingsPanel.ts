import { refreshMusic } from '../audio/music';
import { isSoundEnabled, play, setSoundEnabled } from '../audio/sfx';
import { getLanguage, LANGUAGES, setLanguage, type Lang } from '../content/i18n';
import { STRINGS } from '../content/strings';
import {
  fullEffects,
  getPlanTimer,
  getSpeed,
  hapticsSupported,
  isHapticsEnabled,
  isInstantSelect,
  isMusicEnabled,
  PLAN_TIMERS,
  setEffects,
  setHapticsEnabled,
  setInstantSelect,
  setMusicEnabled,
  setPlanTimer,
  setSpeed,
  SPEEDS,
  touchCapable,
  type PlanTimer,
  type Speed,
} from '../settings';
import { installMode, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { FLAGS } from './flags';
import { haptic } from './fx';

/** One settings panel, shared by the title screen and the in-battle menu. */

/** A row of flags, one per language. */
interface FlagsRow {
  kind: 'flags';
  key: string;
  label: string;
  current: () => string;
  apply: (value: string) => void;
}

/** An on/off switch. `changes`: a document event after which `get` may have changed by other means. */
interface SwitchRow {
  kind: 'switch';
  key: string;
  label: string;
  get: () => boolean;
  set: (on: boolean) => void | Promise<unknown>;
  changes?: string;
}

/** A stepped slider over `stops` ([value, label]), left to right. */
interface SliderRow {
  kind: 'slider';
  key: string;
  label: string;
  stops: [string, string][];
  current: () => string;
  apply: (value: string) => void;
}

type Row = FlagsRow | SwitchRow | SliderRow;

/** The language row reloads the game, so it is only offered outside a match. */
function languageRow(): FlagsRow {
  return {
    kind: 'flags',
    key: 'lang',
    label: STRINGS.settings.language,
    current: getLanguage,
    apply: (v) => {
      if (v === getLanguage()) return;
      setLanguage(v as Lang);
      location.reload();
    },
  };
}

function rows(language = false): Row[] {
  const S = STRINGS.settings;
  const list: Row[] = [
    ...(language ? [languageRow()] : []),
    { kind: 'switch', key: 'sound', label: S.sound, get: isSoundEnabled, set: setSoundEnabled },
    {
      kind: 'switch',
      key: 'music',
      label: S.music,
      get: isMusicEnabled,
      set: (on) => {
        setMusicEnabled(on);
        refreshMusic();
      },
    },
  ];
  if (hapticsSupported()) {
    list.push({
      kind: 'switch',
      key: 'haptics',
      label: S.vibration,
      get: isHapticsEnabled,
      set: (on) => {
        setHapticsEnabled(on);
        haptic('hit');
      },
    });
  }
  if (document.fullscreenEnabled) {
    list.push({
      kind: 'switch',
      key: 'fullscreen',
      label: S.fullscreen,
      get: () => !!document.fullscreenElement,
      set: (on) => {
        if (on) return document.documentElement.requestFullscreen().catch(() => undefined);
        if (document.fullscreenElement) return document.exitFullscreen().catch(() => undefined);
      },
      // Leaving fullscreen with Esc or the back gesture flips the switch back.
      changes: 'fullscreenchange',
    });
  }
  list.push(
    // On = full effects, off = reduced (no shakes, particles, hops or flashes).
    { kind: 'switch', key: 'effects', label: S.effects, get: fullEffects, set: (on) => setEffects(on ? 'full' : 'reduced') },
  );
  // On = one tap puts a card in the plan; off = the first tap only selects it (shows its squares).
  if (touchCapable()) list.push({ kind: 'switch', key: 'instant', label: S.instantSelect, get: isInstantSelect, set: setInstantSelect });
  list.push(
    {
      kind: 'slider',
      key: 'speed',
      label: STRINGS.speed,
      stops: SPEEDS.map((s) => [s, STRINGS.speedNames[s]]),
      current: getSpeed,
      apply: (v) => setSpeed(v as Speed),
    },
    {
      kind: 'slider',
      key: 'timer',
      label: STRINGS.planTimer,
      stops: PLAN_TIMERS.map((t) => [String(t), STRINGS.timerName(t)]),
      current: () => String(getPlanTimer()),
      apply: (v) => setPlanTimer(Number(v) as PlanTimer),
    },
  );
  return list;
}

/** `language`: include the language row (title screen only; switching reloads the game). */
export function settingsHtml(opts: { language?: boolean } = {}): string {
  return `<div class="settings">${rows(opts.language).map(rowHtml).join('')}${installRowHtml()}</div>`;
}

function rowHtml(r: Row): string {
  const control = r.kind === 'flags' ? flagsHtml(r) : r.kind === 'switch' ? switchHtml(r) : sliderHtml(r);
  return `<div class="setting ${r.kind}-setting" data-set="${r.key}"><span>${r.label}</span>${control}</div>`;
}

function flagsHtml(r: FlagsRow): string {
  return `<div class="flags" role="radiogroup" aria-label="${r.label}">${LANGUAGES.map(({ id, name }) => {
    const on = id === r.current();
    return `<button class="flag${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-v="${id}" title="${name}" aria-label="${name}">${FLAGS[id]}</button>`;
  }).join('')}</div>`;
}

function switchHtml(r: SwitchRow): string {
  const on = r.get();
  return `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${r.label}">
    <span class="sw-text sw-on">${STRINGS.settings.on}</span><span class="sw-text sw-off">${STRINGS.settings.off}</span><i class="sw-knob"></i>
  </button>`;
}

function sliderHtml(r: SliderRow): string {
  const i = Math.max(0, r.stops.findIndex(([v]) => v === r.current()));
  const last = r.stops.length - 1;
  return `<div class="slider" style="--p:${i / last}">
    <div class="slider-rail">
      <div class="ticks">${r.stops.map((_, k) => `<i class="${k <= i ? 'lit' : ''}" style="--k:${k / last}"></i>`).join('')}</div>
      <input type="range" min="0" max="${last}" step="1" value="${i}" aria-label="${r.label}" aria-valuetext="${r.stops[i][1]}">
    </div>
    <output>${r.stops[i][1]}</output>
  </div>`;
}

// ---------- "App" row: install the game to the home screen ----------

function installRowHtml(): string {
  return `<div class="setting install-setting"><span>${STRINGS.settings.app}</span><div class="chips">${installChip()}</div></div>
    <p class="note install-note">${isInstalled() ? STRINGS.install.installedHint : STRINGS.install.hint}</p>`;
}

function installChip(): string {
  return isInstalled()
    ? `<button class="chip on" disabled>${STRINGS.install.installed}</button>`
    : `<button class="chip install-chip" data-install>${STRINGS.install.settingsButton}</button>`;
}

/**
 * Where the browser offers its own install dialog (Chrome, Edge, Brave, Samsung Internet), the
 * button opens it. Otherwise (iPhone, or the browser hasn't offered it) the steps show right below.
 */
function bindInstallRow(root: HTMLElement): void {
  const row = root.querySelector<HTMLElement>('.install-setting');
  const note = root.querySelector<HTMLElement>('.install-note');
  if (!row || !note) return;
  const render = () => {
    row.querySelector('.chips')!.innerHTML = installChip();
    if (isInstalled()) note.textContent = STRINGS.install.installedHint;
    row.querySelector('[data-install]')?.addEventListener('click', async () => {
      play('click');
      const mode = installMode();
      if (mode === 'prompt' && (await promptInstall()) !== 'unavailable') {
        render();
        return;
      }
      note.textContent = mode === 'ios' ? STRINGS.install.iosSteps.join(' ') : STRINGS.install.manualSteps;
      note.classList.add('steps');
    });
  };
  render();
  const stop = onInstallChange(() => (document.contains(row) ? render() : stop()));
}

export function bindSettings(root: HTMLElement): void {
  bindInstallRow(root);
  const byKey = new Map(rows(true).map((r) => [r.key, r]));
  root.querySelectorAll<HTMLElement>('.setting[data-set]').forEach((el) => {
    const row = byKey.get(el.dataset.set!);
    if (row?.kind === 'switch') bindSwitch(el, row);
    else if (row?.kind === 'slider') bindSlider(el, row);
    else if (row?.kind === 'flags') bindFlags(el, row);
  });
}

function bindFlags(el: HTMLElement, row: FlagsRow): void {
  el.querySelectorAll<HTMLElement>('[data-v]').forEach((flag) =>
    flag.addEventListener('click', () => {
      el.querySelectorAll('[data-v]').forEach((f) => {
        f.classList.toggle('on', f === flag);
        f.setAttribute('aria-checked', String(f === flag));
      });
      play('click');
      row.apply(flag.dataset.v!);
    }),
  );
}

function bindSwitch(el: HTMLElement, row: SwitchRow): void {
  const btn = el.querySelector<HTMLButtonElement>('.switch')!;
  const show = (on: boolean) => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', String(on));
  };
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('on');
    show(next);
    const pending = row.set(next);
    play('click');
    // Fullscreen can be refused: once the request settles, show what actually happened.
    if (pending) void pending.finally(() => show(row.get()));
  });
  if (row.changes) {
    const event = row.changes;
    const sync = () => (document.contains(btn) ? show(row.get()) : document.removeEventListener(event, sync));
    document.addEventListener(event, sync);
  }
}

function bindSlider(el: HTMLElement, row: SliderRow): void {
  const box = el.querySelector<HTMLElement>('.slider')!;
  const input = box.querySelector('input')!;
  const out = box.querySelector('output')!;
  const ticks = [...box.querySelectorAll('.ticks i')];
  input.addEventListener('input', () => {
    const i = Number(input.value);
    const [value, label] = row.stops[i];
    if (value === row.current()) return;
    row.apply(value);
    box.style.setProperty('--p', String(i / (row.stops.length - 1)));
    out.textContent = label;
    input.setAttribute('aria-valuetext', label);
    ticks.forEach((t, k) => t.classList.toggle('lit', k <= i));
    play('click');
  });
}
