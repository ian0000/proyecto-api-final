import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode, command }) => {
  const apiOrigin = process.env.VITE_API_URL ?? loadEnv(mode, root, 'VITE_').VITE_API_URL ?? '';
  if (command === 'build' && (mode === 'azure' || apiOrigin)) {
    let url: URL;
    try {
      url = new URL(apiOrigin);
    } catch {
      throw new Error('VITE_API_URL debe ser el origen HTTPS de AWS, sin /docs/ ni /v1.');
    }
    if (url.protocol !== 'https:' || url.origin !== apiOrigin || url.username || url.password) {
      throw new Error('VITE_API_URL debe ser un origen HTTPS exacto, sin rutas ni credenciales.');
    }
  }
  return {
    plugins: [
      react(),
      {
        name: 'azure-api-csp',
        apply: 'build',
        async writeBundle(options) {
          const template = await readFile(resolve(root, 'public/staticwebapp.config.json'), 'utf8');
          const config = JSON.parse(template);
          config.globalHeaders['Content-Security-Policy'] = config.globalHeaders[
            'Content-Security-Policy'
          ].replace(' https://REPLACE_WITH_AWS_API_HOST', apiOrigin ? ` ${apiOrigin}` : '');
          await writeFile(
            resolve(options.dir ?? resolve(root, 'dist'), 'staticwebapp.config.json'),
            JSON.stringify(config, null, 2) + '\n',
          );
        },
      },
    ],
    server: { port: 5173, strictPort: true, proxy: { '/v1': 'http://127.0.0.1:4000' } },
    build: { sourcemap: false },
  };
});
