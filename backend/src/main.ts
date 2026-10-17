import { config } from './config.js';
import { Store } from './store.js';
import { createApp } from './app.js';
const cfg = config();
const store = new Store(cfg.mongoUrl, cfg.dbName);
await store.connect();
const app = await createApp(cfg, store);
await app.listen({ port: cfg.port, host: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    await store.close();
    process.exit(0);
  });
