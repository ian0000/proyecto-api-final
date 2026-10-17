import { build } from 'esbuild';
import { resolve } from 'node:path';
const component = process.argv[2];
const root = resolve(import.meta.dirname, '..');
await build({
  entryPoints: [
    `${root}/${component}/src/main.ts`,
    ...(component === 'backend' ? [`${root}/backend/src/worker-main.ts`] : []),
  ],
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: `${root}/${component}/dist`,
  sourcemap: true,
});
