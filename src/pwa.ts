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
