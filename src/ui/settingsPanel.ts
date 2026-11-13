import { refreshMusic } from '../audio/music';
import { isSoundEnabled, play, setSoundEnabled } from '../audio/sfx';
import { getLanguage, LANGUAGES, setLanguage, type Lang } from '../content/i18n';
import { STRINGS } from '../content/strings';
import {
  getEffects,
  getPlanTimer,
  getSpeed,
  hapticsSupported,
  isHapticsEnabled,
  isMusicEnabled,
  setEffects,
  setHapticsEnabled,
  setMusicEnabled,
  setPlanTimer,
  setSpeed,
  type Effects,
  type PlanTimer,
  type Speed,
} from '../settings';
import { installMode, isInstalled, onInstallChange, promptInstall } from '../pwa';
import { haptic } from './fx';

/** One settings panel, shared by the title screen and the in-battle menu. */

interface Row {
  key: string;
  label: string;
  options: [string, string][];
  current: () => string;
  apply: (value: string) => void;
}

/** The language row reloads the game, so it is only offered outside a match. */
function languageRow(): Row {
  return {
    key: 'lang',
    label: STRINGS.settings.language,
    options: LANGUAGES.map((l) => [l.id, l.name]),
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
  const onOff: [string, string][] = [
    ['on', S.on],
    ['off', S.off],
  ];
  const list: Row[] = [
    ...(language ? [languageRow()] : []),
    { key: 'sound', label: S.sound, options: onOff, current: () => (isSoundEnabled() ? 'on' : 'off'), apply: (v) => setSoundEnabled(v === 'on') },
    {
      key: 'music',
      label: S.music,
      options: onOff,
      current: () => (isMusicEnabled() ? 'on' : 'off'),
      apply: (v) => {
        setMusicEnabled(v === 'on');
        refreshMusic();
      },
    },
  ];
  if (hapticsSupported()) {
    list.push({
      key: 'haptics',
      label: S.vibration,
      options: onOff,
      current: () => (isHapticsEnabled() ? 'on' : 'off'),
      apply: (v) => {
        setHapticsEnabled(v === 'on');
        haptic('hit');
      },
    });
  }
  if (document.fullscreenEnabled) {
    list.push({
      key: 'fullscreen',
      label: S.fullscreen,
      options: onOff,
      current: () => (document.fullscreenElement ? 'on' : 'off'),
      apply: (v) => {
        if (v === 'on') void document.documentElement.requestFullscreen().catch(() => undefined);
        else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      },
    });
  }
  list.push(
    {
      key: 'effects',
      label: S.effects,
      options: [
        ['full', S.full],
        ['reduced', S.reduced],
      ],
      current: getEffects,
      apply: (v) => setEffects(v as Effects),
    },
    {
      key: 'speed',
      label: STRINGS.speed,
      options: (['fast', 'normal', 'slow'] as Speed[]).map((s) => [s, STRINGS.speedNames[s]]),
      current: getSpeed,
      apply: (v) => setSpeed(v as Speed),
    },
    {
      key: 'timer',
      label: STRINGS.planTimer,
      options: ([0, 30, 60] as PlanTimer[]).map((t) => [String(t), STRINGS.timerName(t)]),
      current: () => String(getPlanTimer()),
      apply: (v) => setPlanTimer(Number(v) as PlanTimer),
    },
  );
  return list;
}

/** `language`: include the language row (title screen only; switching reloads the game). */
export function settingsHtml(opts: { language?: boolean } = {}): string {
  return `<div class="settings">${rows(opts.language)
    .map(
      (r) => `<div class="setting" data-set="${r.key}"><span>${r.label}</span><div class="chips">${r.options
        .map(([v, label]) => `<button class="chip${v === r.current() ? ' on' : ''}" data-v="${v}">${label}</button>`)
        .join('')}</div></div>`,
    )
    .join('')}${installRowHtml()}</div>`;
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
  root.querySelectorAll<HTMLElement>('.setting[data-set]').forEach((rowEl) => {
    const row = byKey.get(rowEl.dataset.set!)!;
    rowEl.querySelectorAll<HTMLElement>('[data-v]').forEach((chip) =>
      chip.addEventListener('click', () => {
        row.apply(chip.dataset.v!);
        rowEl.querySelectorAll('[data-v]').forEach((c) => c.classList.toggle('on', c === chip));
        play('click');
      }),
    );
  });
}
