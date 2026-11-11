/**
 * Installable app / offline support: registers public/sw.js in production builds and calls
 * `onUpdate` when a newer version has downloaded (pass it a function that applies the update).
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=${__BUILD_ID__}`);
      const offer = (worker: ServiceWorker) => onUpdate(() => worker.postMessage('skipWaiting'));
      // A new version is ready once it has installed while an older one still controls the page.
      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const ready = () => worker.state === 'installed' && !!navigator.serviceWorker.controller;
        if (ready()) return offer(worker);
        worker.addEventListener('statechange', () => {
          if (ready()) offer(worker);
        });
      };
      // The new worker may already be installing (or waiting) by the time register() resolves.
      track(reg.waiting);
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch {
      /* offline support is optional */
    }
  });
}

// ---------- "Install app" button ----------

/** Chromium's install prompt event (Chrome, Edge, Brave, Samsung Internet, Opera). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  // Keep the event so our own button can open the browser's install dialog later.
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

/** Already running as an installed app (home screen / app window)? */
export function isInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches)
  );
}

/** iPhone / iPad: no install API, the player uses Share → Add to Home Screen. */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * How the game can be installed right now: 'prompt' (the browser's own dialog), 'ios'
 * (show instructions) or null (already installed, or the browser can't install apps).
 */
export function installMode(): 'prompt' | 'ios' | null {
  if (isInstalled()) return null;
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : null;
}

/** Called whenever installMode() may have changed (prompt became available, app installed). */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Open the browser's install dialog. 'unavailable' = there is no dialog to open, or the browser
 * refused to show it (then the player can still install from the browser's menu).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  try {
    await e.prompt();
  } catch {
    // The browser refused (for example without a real tap); keep the offer for the next try.
    return 'unavailable';
  }
  deferred = null; // each prompt event can only be shown once
  const { outcome } = await e.userChoice;
  notify();
  return outcome;
}
