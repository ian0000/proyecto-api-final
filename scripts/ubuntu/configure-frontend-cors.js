import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const origin = process.argv[2];
const url = new URL(origin);
if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
  throw new Error('Indica el origen HTTPS exacto de Azure, sin barra final ni rutas.');
}

const file = fileURLToPath(new URL('../../.env.atlas', import.meta.url));
if (!lstatSync(file).isFile()) throw new Error('.env.atlas debe ser un archivo regular.');
const source = readFileSync(file, 'utf8');
const current = parseEnv(source).CORS_ORIGINS ?? '';
if (/[\r\n]/.test(current)) throw new Error('Revisa CORS_ORIGINS: debe ocupar una sola línea.');
const origins = [
  ...new Set([
    ...current
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    origin,
  ]),
];
for (const value of origins) {
  const allowed = new URL(value);
  if (!['https:', 'http:'].includes(allowed.protocol) || allowed.origin !== value) {
    throw new Error('Un origen CORS existente es inválido; no se modificó el archivo.');
  }
}

const eol = source.includes('\r\n') ? '\r\n' : '\n';
const entry = `CORS_ORIGINS=${origins.join(',')}${eol}`;
let replaced = false;
let updated = source.replace(/^(?:export[ \t]+)?CORS_ORIGINS[ \t]*=.*(?:\r?\n|$)/gm, () => {
  const result = replaced ? '' : entry;
  replaced = true;
  return result;
});
if (!replaced) updated = source + (source.endsWith('\n') ? '' : eol) + entry;
if (updated === source) {
  console.log('El origen Azure ya está permitido. Reinicia la API si todavía no lo hiciste.');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${file}.backup-cors-${stamp}`;
  copyFileSync(file, backup, constants.COPYFILE_EXCL);
  chmodSync(backup, 0o600);
  const temporary = `${file}.cors-${stamp}.tmp`;
  writeFileSync(temporary, updated, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
  console.log(`Origen Azure agregado. Configuración anterior conservada en ${backup}`);
}
console.log('Siguiente paso: sudo -n systemctl restart fabrica-api');
