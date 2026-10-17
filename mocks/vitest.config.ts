import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['mocks/test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    maxWorkers: 1,
  },
});
