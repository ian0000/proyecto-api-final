import { config } from './config.js';
import { Store } from './store.js';
import { hashPassword } from './auth.js';
export async function seed(store: Store, password: string) {
  if (password.length < 12) throw new Error('DEMO_PASSWORD must contain at least 12 characters');
  for (const [role, agency] of [
    ['asesor', 'agencia-quito'],
    ['supervisor', 'agencia-quito'],
    ['administrador', 'central'],
  ] as const) {
    const id = `demo-${role}`;
    await store.users.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          sub: id,
          role,
          agency,
          name: `${role} demo`,
          email: `${role}@demo.test`,
          passwordHash: hashPassword(password),
        },
      },
      { upsert: true },
    );
  }
}
if (process.argv[1]?.endsWith('seed.ts')) {
  const cfg = config();
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error('DEMO_PASSWORD required');
  const store = new Store(cfg.mongoUrl, cfg.dbName);
  try {
    await store.connect();
    await seed(store, password);
    console.log('Three demo users created if absent. Passwords are never logged.');
  } finally {
    await store.close();
  }
}
