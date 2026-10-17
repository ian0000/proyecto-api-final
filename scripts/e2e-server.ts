import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { MongoClient } from 'mongodb';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../backend/src/app.js';
import { config } from '../backend/src/config.js';
import { Store } from '../backend/src/store.js';
import { seed } from '../backend/src/seed.js';
import { Worker } from '../backend/src/worker.js';
import { createMocks } from '../mocks/src/app.js';
import { demoPassword } from '../tests/e2e/fixtures.js';

const dbName = `credito_e2e_${randomUUID().replaceAll('-', '')}`;
const mongoUrl = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27027';
const cfg = config({
  MONGODB_URI: mongoUrl,
  DB_NAME: dbName,
  JWT_SECRET: 'e2e-only-jwt-secret-0000000000000000',
  WEBHOOK_SECRET: 'e2e-only-webhook-secret-00000000000',
  MOCK_SECRET: 'e2e-only-mock-secret-00000000000000',
  MOCK_URL: 'http://127.0.0.1:4001',
  CALLBACK_URL: 'http://127.0.0.1:4000',
  CORS_ORIGINS: 'http://127.0.0.1:5173',
  PORT: '4000',
  RATE_LIMIT: '1000',
  INTEGRATION_TIMEOUT_MS: '1000',
  RETRY_MS: '100',
  LEASE_MS: '5000',
  POLL_MS: '100',
  CIRCUIT_MS: '200',
  LOG_LEVEL: 'silent',
});
const store = new Store(mongoUrl, dbName);
await store.connect();
await seed(store, demoPassword);
const backend = await createApp(cfg, store);
const mock = await createMocks({
  mongoUrl,
  dbName: `${dbName}_mocks`,
  secret: cfg.mockSecret,
  webhookSecret: cfg.webhookSecret,
  callbackOrigin: cfg.callbackUrl,
  seed: 'e2e-reproducible-v1',
  delayMs: 100,
  timeoutMs: 1500,
});
const vite = await createServer({
  configFile: 'frontend/vite.config.ts',
  root: 'frontend',
  server: { host: '127.0.0.1' },
});
const worker = new Worker(store, cfg);
let stopped = false;
let work = Promise.resolve();
const timer = setInterval(() => {
  if (!stopped)
    work = work
      .then(async () => {
        await worker.tick();
        await mock.deliverCallbacks();
      })
      .catch((error) => {
        console.error('E2E worker failed', error instanceof Error ? error.message : 'unknown');
      });
}, 50);
async function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  await work;
  await vite.close();
  await backend.close();
  await mock.app.close();
  await store.close();
  const cleanup = new MongoClient(mongoUrl);
  await cleanup.connect();
  await cleanup.db(dbName).dropDatabase();
  await cleanup.db(`${dbName}_mocks`).dropDatabase();
  await cleanup.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void stop().then(() => process.exit(0));
  });
// Playwright's Windows process teardown can bypass Node signal handlers. The
// test-only manifest lets global teardown remove only these unique databases.
await mkdir('artifacts/e2e', { recursive: true });
await writeFile('artifacts/e2e/runtime.json', JSON.stringify({ dbName }));
try {
  await mock.app.listen({ port: 4001, host: '127.0.0.1' });
  await backend.listen({ port: 4000, host: '127.0.0.1' });
  await vite.listen();
  console.log('Isolated academic E2E services ready.');
} catch (error) {
  await stop();
  throw error;
}
