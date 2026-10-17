import { config } from './config.js';
import { Store } from './store.js';
import { Worker } from './worker.js';
const cfg = config();
if (cfg.leaseMs <= cfg.timeoutMs * 3)
  throw new Error('LEASE_MS must exceed three integration timeouts');
const store = new Store(cfg.mongoUrl, cfg.dbName);
await store.connect();
const worker = new Worker(store, cfg);
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await worker.tick();
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'worker_tick_failed' }));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await store.close();
