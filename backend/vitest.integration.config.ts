import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['backend/test/system.test.ts', 'backend/test/races.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    maxWorkers: 1,
  },
});
