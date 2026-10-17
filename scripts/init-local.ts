import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) throw new Error('.env already exists; not overwritten');
const secret = () => randomBytes(32).toString('hex');
writeFileSync(
  '.env',
  `MONGODB_URI=mongodb://127.0.0.1:27027\nDB_NAME=credito_local\nJWT_SECRET=${secret()}\nWEBHOOK_SECRET=${secret()}\nMOCK_SECRET=${secret()}\nDEMO_PASSWORD=${secret().slice(0, 24)}\nCORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\nMOCK_URL=http://127.0.0.1:4001\nCALLBACK_URL=http://127.0.0.1:4000\nPORT=4000\nMOCK_PORT=4001\nMOCK_SEED=academico-v1\n`,
  { mode: 0o600 },
);
console.log('.env generated with local secrets. Read DEMO_PASSWORD locally; do not commit it.');
