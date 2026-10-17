import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['backend/test/security.test.ts', 'backend/test/unit/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['backend/src/**/*.ts'],
      exclude: ['backend/src/main.ts', 'backend/src/worker-main.ts'],
      reportsDirectory: 'backend/coverage-unit',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 85 },
    },
  },
});
