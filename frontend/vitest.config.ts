import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['frontend/src/**/*.test.tsx'],
    environment: 'jsdom',
    maxWorkers: 1,
  },
});
