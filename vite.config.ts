import { defineConfig } from 'vitest/config';

// GitHub Pages serves this repo at https://<user>.github.io/flip-tap/
export default defineConfig({
  base: '/flip-tap/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
