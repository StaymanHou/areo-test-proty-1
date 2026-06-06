import { defineConfig } from 'vitest/config';

// Perf-only Vitest config: runs `*.perf.test.ts` files that are excluded
// from the default `npm run test` invocation. Origin: SURFACE-2026-05-16-02
// (wall-clock perf assertion in flightmodel was load-flaky under parallel
// CI/dev load). Invoke via `npm run test:perf`.
export default defineConfig({
  test: {
    include: ['**/*.perf.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
