import type { Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { defineConfig } from 'vitest/config';

/** Changes every build; the service worker uses it to name its cache and detect updates. */
const BUILD_ID = Date.now().toString(36);

/** The game's version (package.json), shown in the corner of the main menu. Bump it with every update. */
const APP_VERSION: string = pkg.version;

/** Files from public/ the app needs offline (the bundle's own files are added automatically). */
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

/** Emits precache.json: every file the service worker should store for offline play. */
function precacheList(): Plugin {
  return {
    name: 'fliptap-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = ['./', ...built, ...PUBLIC_FILES];
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ version: BUILD_ID, files }, null, 1) });
    },
  };
}

// GitHub Pages serves this repo at https://<user>.github.io/flip-tap/
export default defineConfig({
  base: '/flip-tap/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [precacheList()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
