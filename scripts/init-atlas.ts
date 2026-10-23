import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env.atlas')) {
  console.log('Existing .env.atlas preserved. Edit its private Atlas URI if needed.');
} else {
  const secret = () => randomBytes(32).toString('hex');
  let contents = readFileSync('.env.example', 'utf8');
  const values: Record<string, string> = {
    MONGODB_URI:
      'mongodb+srv://REPLACE_WITH_USER:REPLACE_WITH_PASSWORD@REPLACE_WITH_CLUSTER.mongodb.net/?retryWrites=true&w=majority',
    DB_NAME: 'credito_test',
    JWT_SECRET: secret(),
    WEBHOOK_SECRET: secret(),
    MOCK_SECRET: secret(),
    DEMO_PASSWORD: secret().slice(0, 24),
  };
  for (const [key, value] of Object.entries(values))
    contents = contents.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  writeFileSync('.env.atlas', contents, { flag: 'wx', mode: 0o600 });
  console.log('Private .env.atlas created with random secrets. Complete the Atlas URI locally.');
}
