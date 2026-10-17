export interface Config {
  mongoUrl: string;
  dbName: string;
  jwtSecret: string;
  webhookSecret: string;
  mockSecret: string;
  mockUrl: string;
  callbackUrl: string;
  origins: string[];
  port: number;
  rateLimit: number;
  timeoutMs: number;
  retryMs: number;
  leaseMs: number;
  maxAttempts: number;
  pollMs: number;
  circuitMs: number;
  log: boolean;
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = (name: string) => {
    const v = env[name];
    if (!v || v.length < 32) throw new Error(`${name}: required, minimum 32 characters`);
    return v;
  };
  const number = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    mongoUrl: env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
    dbName: env.DB_NAME ?? 'credito_local',
    jwtSecret: secret('JWT_SECRET'),
    webhookSecret: secret('WEBHOOK_SECRET'),
    mockSecret: secret('MOCK_SECRET'),
    mockUrl: env.MOCK_URL ?? 'http://127.0.0.1:4001',
    callbackUrl: env.CALLBACK_URL ?? 'http://127.0.0.1:4000',
    origins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
    port: number('PORT', 4000),
    rateLimit: number('RATE_LIMIT', 120),
    timeoutMs: number('INTEGRATION_TIMEOUT_MS', 2000),
    retryMs: number('RETRY_MS', 1000),
    leaseMs: number('LEASE_MS', 15000),
    maxAttempts: number('MAX_ATTEMPTS', 5),
    pollMs: number('POLL_MS', 1000),
    circuitMs: number('CIRCUIT_MS', 10000),
    log: env.LOG_LEVEL !== 'silent',
  };
}
