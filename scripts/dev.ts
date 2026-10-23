import { spawn } from 'node:child_process';
const envFile = process.argv[2] ?? '.env';
const children = [
  ['backend/src/main.ts'],
  ['backend/src/worker-main.ts'],
  ['mocks/src/main.ts'],
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--config',
    'frontend/vite.config.ts',
    'frontend',
  ],
].map((args) =>
  spawn(process.execPath, [`--env-file=${envFile}`, '--import', 'tsx', ...args], {
    stdio: 'inherit',
  }),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
};
children.forEach((child) =>
  child.on('exit', (code) => {
    if (!stopping) {
      console.error('A service stopped:', code);
      stop();
      process.exitCode = code ?? 1;
    }
  }),
);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
