import { refreshMusic } from '../audio/music';
import { isSoundEnabled, play, setSoundEnabled } from '../audio/sfx';
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
import { haptic } from './fx';

/** One settings panel, shared by the title screen and the in-battle menu. */

interface Row {
  key: string;
  label: string;
  options: [string, string][];
  current: () => string;
  apply: (value: string) => void;
}

function rows(): Row[] {
  const S = STRINGS.settings;
  const onOff: [string, string][] = [
    ['on', S.on],
    ['off', S.off],
  ];
  const list: Row[] = [
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

export function settingsHtml(): string {
  return `<div class="settings">${rows()
    .map(
      (r) => `<div class="setting" data-set="${r.key}"><span>${r.label}</span><div class="chips">${r.options
        .map(([v, label]) => `<button class="chip${v === r.current() ? ' on' : ''}" data-v="${v}">${label}</button>`)
        .join('')}</div></div>`,
    )
    .join('')}</div>`;
}

export function bindSettings(root: HTMLElement): void {
  const byKey = new Map(rows().map((r) => [r.key, r]));
  root.querySelectorAll<HTMLElement>('.setting').forEach((rowEl) => {
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
