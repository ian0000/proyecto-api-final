import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Print-only mode accepts paths for reproducible local inspection without Git.
const args = process.argv.slice(2);
const files =
  args[0] === '--paths'
    ? args.slice(1)
    : execFileSync(
        'git',
        ['diff', '--name-only', '--no-renames', args[0] ?? 'HEAD^', args[1] ?? 'HEAD'],
        { encoding: 'utf8' },
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
const global = files.some(
  (p) =>
    /^(package(-lock)?\.json|tsconfig\.json|eslint\.config\.js|Dockerfile|\.dockerignore|compose\.yaml|playwright\.config\.ts|\.env\.example)$/.test(
      p,
    ) ||
    p.startsWith('.github/') ||
    p.startsWith('scripts/') ||
    p.startsWith('tests/') ||
    !/^(backend\/|frontend\/|mocks\/|shared\/|docs\/|[^/]+\.md$|LICENSE$|\.gitignore$)/.test(p),
);
const shared = global || files.some((p) => p.startsWith('shared/'));
const mocks = shared || files.some((p) => p.startsWith('mocks/'));
// Backend integration tests import the independent mock server.
const backend = mocks || files.some((p) => p.startsWith('backend/'));
const frontend = shared || files.some((p) => p.startsWith('frontend/'));
const result = {
  frontend,
  backend,
  mocks,
  contract: shared || backend,
  security: frontend || backend || mocks,
  e2e: frontend || backend || mocks,
};
for (const [key, value] of Object.entries(result)) {
  const line = `${key}=${value}\n`;
  process.stdout.write(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
}
