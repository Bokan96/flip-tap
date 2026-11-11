// Renders the app icons in public/icons/ from scripts/icon.html using headless Chrome.
// Usage: node scripts/make-icons.mjs ["path/to/chrome"]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.argv[2] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const page = pathToFileURL(resolve('scripts/icon.html')).href;
const out = resolve('public/icons');
mkdirSync(out, { recursive: true });

const icons = [
  ['icon-192.png', 192, 'any'],
  ['icon-512.png', 512, 'any'],
  ['icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'maskable'],
];
for (const [name, size, kind] of icons) {
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    `--screenshot=${resolve(out, name)}`,
    `${page}?size=${size}&kind=${kind}`,
  ]);
  console.log('wrote', name);
}
