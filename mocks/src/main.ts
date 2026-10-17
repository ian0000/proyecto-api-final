import { createMocks } from './app.js';
const secret = process.env.MOCK_SECRET;
const webhookSecret = process.env.WEBHOOK_SECRET;
if (!secret || secret.length < 32 || !webhookSecret || webhookSecret.length < 32)
  throw new Error('Mock and webhook secrets required, at least 32 characters');
const runtime = await createMocks({
  mongoUrl: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
  dbName: `${process.env.DB_NAME ?? 'credito_local'}_mocks`,
  secret,
  webhookSecret,
  callbackOrigin: process.env.CALLBACK_URL ?? 'http://127.0.0.1:4000',
  seed: process.env.MOCK_SEED ?? 'academico-v1',
  delayMs: Number(process.env.MOCK_DELAY_MS ?? 1200),
  timeoutMs: Number(process.env.MOCK_TIMEOUT_MS ?? 5000),
});
await runtime.app.listen({ port: Number(process.env.MOCK_PORT ?? 4001), host: '0.0.0.0' });
let stopped = false;
let callbacks = Promise.resolve();
const timer = setInterval(() => {
  if (!stopped)
    callbacks = callbacks
      .then(() => runtime.deliverCallbacks())
      .then(() => {})
      .catch(() => {});
}, 500);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    stopped = true;
    clearInterval(timer);
    await callbacks;
    await runtime.app.close();
    process.exit(0);
  });
