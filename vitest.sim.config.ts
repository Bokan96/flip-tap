import { defineConfig } from 'vitest/config';

/** `npm run balance`: AI-vs-AI round robin that writes docs/BALANCE.md. */
export default defineConfig({
  test: {
    include: ['sim/**/*.sim.ts'],
    testTimeout: 3_600_000,
  },
});
