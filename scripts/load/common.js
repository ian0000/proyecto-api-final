/* global __ENV, __VU, __ITER, open */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import execution from 'k6/execution';

const sample = JSON.parse(open('../../shared/example.json'));
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const allowed = __ENV.LOAD_ALLOWED_ORIGIN || '';
export const codes = new Counter('status_codes');
export const rateLimited = new Rate('rate_limited');
export const unexpected = new Rate('unexpected_errors');
export const allErrors = new Rate('errors_including_429');
export const successLatency = new Trend('successful_business_latency_ms', true);
export const recoveryTail = new Rate('recovery_tail_errors');
export const thresholds = {
  successful_business_latency_ms: ['p(95)<2000'],
  errors_including_429: ['rate<0.01'],
  unexpected_errors: ['rate<0.01'],
};
export function setup() {
  if (!base || base !== allowed || !/^https?:\/\/[^/?#]+$/.test(base))
    fail('BASE_URL must exactly match the explicitly authorized LOAD_ALLOWED_ORIGIN');
  if (!__ENV.LOAD_EMAIL || !__ENV.LOAD_PASSWORD)
    fail('Set test-only LOAD_EMAIL and LOAD_PASSWORD in the environment');
  const response = http.post(
    `${base}/v1/auth/login`,
    JSON.stringify({ email: __ENV.LOAD_EMAIL, password: __ENV.LOAD_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /v1/auth/login' } },
  );
  if (response.status !== 200) fail(`Login failed with HTTP ${response.status}`);
  const token = response.json('token');
  if (typeof token !== 'string') fail('Login did not return a token');
  // Only the serialized setup data contains the token. Never log it or export it.
  return { token, run: String(Date.now()) };
}
function params(data, name, extra = {}) {
  return {
    headers: {
      Authorization: `Bearer ${data.token}`,
      'Content-Type': 'application/json',
      ...extra,
    },
    tags: { name },
    timeout: '10s',
  };
}
function observe(response, accepted, endpoint) {
  const ok = accepted.includes(response.status);
  codes.add(1, { code: String(response.status), endpoint });
  rateLimited.add(response.status === 429);
  unexpected.add(!ok && response.status !== 429);
  allErrors.add(!ok);
  if (ok) successLatency.add(response.timings.duration, { endpoint });
  check(response, {
    [`${endpoint} successful or explicit 429`]: (r) =>
      accepted.includes(r.status) || r.status === 429,
  });
  return ok;
}
export function workload(data) {
  const key = `load-${data.run}-${__VU}-${__ITER}`;
  const identification = `DEMO-${String((__VU * 1000 + __ITER) % 1000000).padStart(6, '0')}`;
  const body = {
    ...sample,
    client: {
      ...sample.client,
      identification,
      email: `vu${__VU}@example.test`,
      name: 'Cliente ficticio de carga',
    },
  };
  const created = http.post(
    `${base}/v1/solicitudes`,
    JSON.stringify(body),
    params(data, 'POST /v1/solicitudes', { 'Idempotency-Key': key }),
  );
  const accepted = observe(created, [202], 'create');
  if (accepted) {
    const id = created.json('id');
    if (typeof id !== 'string') {
      fail('Create response has no application ID');
    }
    observe(
      http.get(`${base}/v1/solicitudes/${id}`, params(data, 'GET /v1/solicitudes/{id}')),
      [200],
      'detail',
    );
  }
  observe(
    http.get(
      `${base}/v1/solicitudes?page=1&size=10&sort=desc`,
      params(data, 'GET /v1/solicitudes'),
    ),
    [200],
    'list',
  );
  sleep(1);
}
export function recovery(data) {
  const alive = http.get(`${base}/health/live`, {
    tags: { name: 'GET /health/live recovery' },
    timeout: '10s',
  });
  check(alive, { 'recovery process alive': (r) => r.status === 200 });
  const response = http.get(
    `${base}/v1/solicitudes?page=1&size=1`,
    params(data, 'GET /v1/solicitudes recovery'),
  );
  codes.add(1, { code: String(response.status), endpoint: 'recovery' });
  // Observe immediately; evaluate the final window after the 60s quota window.
  if (Date.now() - execution.scenario.startTime > 65000) recoveryTail.add(response.status !== 200);
  sleep(1);
}
