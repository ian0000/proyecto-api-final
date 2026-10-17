import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function markdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter(
        (e) =>
          ![
            'node_modules',
            '.git',
            'dist',
            'coverage',
            'coverage-unit',
            'test-results',
            'playwright-report',
          ].includes(e.name) && !e.name.startsWith('coverage-'),
      )
      .map((e) =>
        e.isDirectory()
          ? markdown(resolve(dir, e.name))
          : Promise.resolve(e.name.endsWith('.md') ? [resolve(dir, e.name)] : []),
      ),
  );
  return groups.flat();
}
const errors: string[] = [];
let links = 0;
const files = await markdown(root);
for (const file of files) {
  const source = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^(https?:|mailto:|#|codex:)/.test(target)) continue;
    const local = decodeURIComponent(target.split('#')[0]);
    if (!local) continue;
    links++;
    const path = resolve(dirname(file), local);
    if (relative(root, path).startsWith('..') || /^[A-Za-z]:[\\/]/.test(local)) {
      errors.push(`${relative(root, file)}: non-portable link ${target}`);
      continue;
    }
    try {
      await access(path);
    } catch {
      errors.push(`${relative(root, file)}: missing ${target}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Documentation: ${files.length} Markdown files; ${links} local links exist. External URLs and heading anchors are not checked.`,
  );
