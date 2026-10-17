import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../backend/src/store.js';
import { seed } from '../backend/src/seed.js';
import type { ApplicationView } from '../shared/domain.js';
import { readFile } from 'node:fs/promises';

// Exercises production bundles and production-only dependencies. No cloud calls.
const id = randomUUID().replaceAll('-', '');
const dbName = `credito_container_${id}`;
if (!/^credito_container_[a-f0-9]{32}$/.test(dbName)) throw new Error('Unexpected smoke database');
const names = {
  api: `credito-api-${id}`,
  mocks: `credito-mocks-${id}`,
  worker: `credito-worker-${id}`,
};
const secret = () => randomBytes(32).toString('hex');
const password = secret();
const env = {
  ...process.env,
  JWT_SECRET: secret(),
  WEBHOOK_SECRET: secret(),
  MOCK_SECRET: secret(),
  MONGODB_URI: 'mongodb://mongo:27017',
  DB_NAME: dbName,
  MOCK_URL: `http://${names.mocks}:4001`,
  CALLBACK_URL: `http://${names.api}:4000`,
  CORS_ORIGINS: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
};
const vars = [
  'JWT_SECRET',
  'WEBHOOK_SECRET',
  'MOCK_SECRET',
  'MONGODB_URI',
  'DB_NAME',
  'MOCK_URL',
  'CALLBACK_URL',
  'CORS_ORIGINS',
  'LOG_LEVEL',
];
const docker = (args: string[]) =>
  execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const owned: string[] = [];
const store = new Store(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27027', dbName);
const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
async function wait<T>(get: () => Promise<T>, ready: (value: T) => boolean) {
  let last: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const value = await get();
      if (ready(value)) return value;
    } catch (error) {
      last = error;
    }
    await pause();
  }
  throw new Error(
    `Container readiness/flow timeout: ${last instanceof Error ? last.message : 'condition not reached'}`,
  );
}
try {
  await store.connect();
  await seed(store, password);
  for (const component of ['mocks', 'api', 'worker'] as const) {
    const port =
      component === 'api'
        ? ['-p', '127.0.0.1:4400:4000']
        : component === 'mocks'
          ? ['-p', '127.0.0.1:4401:4001']
          : [];
    const image =
      component === 'mocks' ? 'proyecto-api-final-mocks:local' : 'proyecto-api-final-backend:local';
    const cmd = component === 'worker' ? ['node', 'backend/dist/worker-main.js'] : [];
    docker([
      'run',
      '--rm',
      '-d',
      '--name',
      names[component],
      '--network',
      'proyecto-api-final_default',
      ...port,
      ...vars.flatMap((name) => ['-e', name]),
      image,
      ...cmd,
    ]);
    owned.push(names[component]);
  }
  const base = 'http://127.0.0.1:4400';
  await wait(
    () => fetch(`${base}/health/ready`),
    (response) => response.ok,
  );
  const docs = await fetch(`${base}/docs/`);
  if (!docs.ok) throw new Error('Bundled Swagger UI unavailable');
  const login = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'asesor@demo.test', password }),
  });
  if (!login.ok) throw new Error(`Container login HTTP ${login.status}`);
  const { token } = (await login.json()) as { token: string };
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': randomUUID(),
  };
  const create = await fetch(`${base}/v1/solicitudes`, {
    method: 'POST',
    headers,
    body: await readFile('shared/example.json', 'utf8'),
  });
  if (create.status !== 202) throw new Error(`Container create HTTP ${create.status}`);
  const item = (await create.json()) as ApplicationView;
  const detail = await wait(
    async () =>
      (await (
        await fetch(`${base}/v1/solicitudes/${item.id}`, { headers })
      ).json()) as ApplicationView,
    (value) =>
      Object.values(value.submissions).filter((s) => s.offer && s.jobState === 'done').length === 2,
  );
  const offer = detail.submissions.pichincha!.offer!;
  const accepted = await fetch(`${base}/v1/solicitudes/${item.id}/ofertas/${offer.id}/aceptar`, {
    method: 'POST',
    headers: {
      Authorization: headers.Authorization,
      'Idempotency-Key': randomUUID(),
      'If-Match': `"${detail.version}"`,
    },
  });
  if (!accepted.ok) throw new Error(`Container accept HTTP ${accepted.status}`);
  const result = await wait(
    async () =>
      (await (
        await fetch(`${base}/v1/solicitudes/${item.id}`, { headers })
      ).json()) as ApplicationView,
    (value) => Object.values(value.submissions).every((s) => s.jobState === 'done'),
  );
  if (result.state !== 'ACEPTADA') throw new Error('Final state was not preserved');
  console.log(
    'Container smoke PASS: production API, worker, mocks, Swagger, two offers, acceptance and both notifications.',
  );
} finally {
  for (const name of owned.reverse()) {
    try {
      docker(['stop', '-t', '3', name]);
    } catch {
      /* Container may already have exited. */
    }
  }
  await store.client.db(dbName).dropDatabase();
  await store.client.db(`${dbName}_mocks`).dropDatabase();
  await store.close();
}
