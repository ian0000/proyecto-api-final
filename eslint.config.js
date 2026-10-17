import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/coverage-*/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        window: 'readonly',
        document: 'readonly',
        sessionStorage: 'readonly',
        RequestInit: 'readonly',
        FormData: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
