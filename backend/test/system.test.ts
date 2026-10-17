import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { CreditService, newJob } from '../src/service.js';
import { seed } from '../src/seed.js';
import { config } from '../src/config.js';
import { Worker, pendingJobs } from '../src/worker.js';
import { adapter, IntegrationError, type Adapter } from '../src/adapters.js';
import { expand, contract } from '../src/contract.js';
import { createMocks } from '../../mocks/src/app.js';
import { signWebhook } from '../../shared/security.js';
import { view, type Actor, type ApplicationInput, type BankResult } from '../../shared/domain.js';
const cfg = {
  ...config({
    JWT_SECRET: 'j'.repeat(40),
    WEBHOOK_SECRET: 'w'.repeat(40),
    MOCK_SECRET: 'm'.repeat(40),
    LOG_LEVEL: 'silent',
  }),
  mongoUrl: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27027',
  dbName: `credito_test_${randomUUID().replaceAll('-', '')}`,
  retryMs: 1,
  pollMs: 1,
  circuitMs: 1,
  timeoutMs: 1000,
};
const store = new Store(cfg.mongoUrl, cfg.dbName);
const service = new CreditService(store);
const actor: Actor = {
  sub: 'demo-asesor',
  role: 'asesor',
  agency: 'agencia-quito',
  name: 'asesor demo',
};
const input = JSON.parse(
  readFileSync(new URL('../../shared/example.json', import.meta.url), 'utf8'),
) as ApplicationInput;
let app: Awaited<ReturnType<typeof createApp>>;
let mock: Awaited<ReturnType<typeof createMocks>>;
let token: string;
let admin: string;
let supervisor: string;
const headers = () => ({ authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() });
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
function valid(schema: string, value: unknown) {
  const validate = ajv.compile(expand(contract.components.schemas[schema]) as object);
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
async function create(scenario: ApplicationInput['scenario'] = 'aprobada') {
  return (await service.create({ ...input, scenario }, actor, randomUUID(), randomUUID())).item;
}
async function finish(worker: Worker, id: string) {
  for (let i = 0; i < 30; i++) {
    await worker.tick();
    const item = await service.get(id, actor);
    if (pendingJobs(item) === 0) return item;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Jobs did not finish');
}
beforeAll(async () => {
  await store.connect();
  await seed(store, 'test-password-1234');
  app = await createApp(cfg, store);
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cfg.callbackUrl = url;
  mock = await createMocks({
    mongoUrl: cfg.mongoUrl,
    dbName: cfg.dbName,
    secret: cfg.mockSecret,
    webhookSecret: cfg.webhookSecret,
    callbackOrigin: url,
    seed: 'test',
    delayMs: 5,
    timeoutMs: 100,
  });
  cfg.mockUrl = await mock.app.listen({ port: 0, host: '127.0.0.1' });
  for (const role of ['asesor', 'administrador', 'supervisor']) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: `${role}@demo.test`, password: 'test-password-1234' },
    });
    expect(r.statusCode).toBe(200);
    const t = r.json().token;
    if (role === 'asesor') token = t;
    else if (role === 'administrador') admin = t;
    else supervisor = t;
  }
});
beforeEach(async () => {
  await store.applications.deleteMany({});
  await store.circuits.deleteMany({});
  await mock.records.deleteMany({});
});
afterAll(async () => {
  app?.server.closeAllConnections();
  mock?.app.server.closeAllConnections();
  await app?.close();
  await mock?.app.close();
  await store.client.db(cfg.dbName).dropDatabase();
  await store.close();
});
describe('API and contract integration against real MongoDB', () => {
  it('serves health, contract, docs and rejects inaccessible or malformed resources', async () => {
    for (const url of ['/health/live', '/health/ready', '/openapi.json', '/docs/'])
      expect((await app.inject(url)).statusCode).toBe(200);
    expect((await app.inject('/v1/auth/me')).statusCode).toBe(401);
    const me = await app.inject({ url: '/v1/auth/me', headers: headers() });
    valid('Actor', me.json());
    expect((await app.inject({ url: '/missing', headers: headers() })).statusCode).toBe(404);
    const banks = await app.inject({ url: '/v1/financieras', headers: headers() });
    expect(banks.json()).toHaveLength(2);
    expect(
      (await app.inject({ url: '/v1/solicitudes/not-uuid', headers: headers() })).statusCode,
    ).toBe(400);
    const missing = await app.inject({
      url: `/v1/solicitudes/${randomUUID()}`,
      headers: headers(),
    });
    expect(missing.statusCode).toBe(404);
    valid('Problem', missing.json());
  });
  it('validates login and rejects expired, altered and wrong-audience tokens', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'none@example.test', password: 'wrong-password-123' },
        })
      ).statusCode,
    ).toBe(401);
    for (const invalid of [
      token + 'bad',
      app.jwt.sign(actor, { expiresIn: -1 }),
      app.jwt.sign(actor, { aud: 'wrong' }),
    ])
      expect(
        (await app.inject({ url: '/v1/auth/me', headers: { authorization: `Bearer ${invalid}` } }))
          .statusCode,
      ).toBe(401);
  });
  it('creates asynchronously, validates actual responses and deduplicates concurrent requests', async () => {
    const key = randomUUID();
    const h = { ...headers(), 'idempotency-key': key };
    const requests = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'POST', url: '/v1/solicitudes', headers: h, payload: input }),
      ),
    );
    expect(requests.every((r) => r.statusCode === 202)).toBe(true);
    expect(new Set(requests.map((r) => r.json().id)).size).toBe(1);
    requests.forEach((r) => valid('Application', r.json()));
    const changed = await app.inject({
      method: 'POST',
      url: '/v1/solicitudes',
      headers: h,
      payload: { ...input, scenario: 'rechazada' },
    });
    expect(changed.statusCode).toBe(409);
    const id = requests[0].json().id;
    expect(requests[0].headers.location).toBe(`/v1/solicitudes/${id}`);
    const r = await app.inject({ url: `/v1/solicitudes/${id}`, headers: headers() });
    expect(
      (
        await app.inject({
          url: `/v1/solicitudes/${id}`,
          headers: { ...headers(), 'if-none-match': r.headers.etag as string },
        })
      ).statusCode,
    ).toBe(304);
    const page = await app.inject({
      url: '/v1/solicitudes?page=1&size=1&state=ENVIADA&bank=pichincha&sort=asc',
      headers: headers(),
    });
    valid('Page', page.json());
    expect(page.json().total).toBe(1);
    for (const suffix of ['respuestas', 'ofertas', 'eventos'])
      expect(
        (await app.inject({ url: `/v1/solicitudes/${id}/${suffix}`, headers: headers() }))
          .statusCode,
      ).toBe(200);
  });
  it('rejects missing consent, unsafe inputs, unsupported media and invalid financing', async () => {
    for (const body of [
      { ...input, consent: { ...input.consent, accepted: false } },
      { ...input, client: { ...input.client, identification: '1234567890' } },
      { ...input, financing: { ...input.financing, downPaymentCents: 100 } },
      { ...input, banks: [] },
      { ...input, extra: true },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/solicitudes',
            headers: headers(),
            payload: body,
          })
        ).statusCode,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: { ...headers(), 'content-type': 'application/json' },
          payload: '{bad',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: { ...headers(), 'content-type': 'image/png' },
          payload: 'png',
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: { ...headers(), 'content-type': 'application/json' },
          payload: ' '.repeat(66000),
        })
      ).statusCode,
    ).toBe(413);
  });
  it('isolates agencies and enforces supervisor and administrator privileges', async () => {
    const item = await create();
    const other = app.jwt.sign({ ...actor, agency: 'otra-agencia' });
    expect(
      (
        await app.inject({
          url: `/v1/solicitudes/${item._id}`,
          headers: { authorization: `Bearer ${other}` },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({ url: '/v1/solicitudes', headers: { authorization: `Bearer ${other}` } })
      ).json().total,
    ).toBe(0);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: { ...headers(), authorization: `Bearer ${supervisor}` },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: '/v1/admin/metrics', headers: headers() })).statusCode).toBe(
      403,
    );
    valid(
      'Metrics',
      (
        await app.inject({
          url: '/v1/admin/metrics',
          headers: { authorization: `Bearer ${admin}` },
        })
      ).json(),
    );
  });
  it('performs JSON webhook and XML polling, accepts one offer and notifies both banks', async () => {
    const item = await create();
    const worker = new Worker(store, cfg);
    await worker.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(await mock.deliverCallbacks()).toBe(1);
    const finished = await finish(worker, item._id);
    expect(finished.state).toBe('OFERTAS');
    expect(finished.submissions.pichincha!.offer).toBeDefined();
    expect(finished.submissions.pacifico!.offer).toBeDefined();
    valid('Application', view(finished));
    const offer = finished.submissions.pichincha!.offer!;
    const url = `/v1/solicitudes/${item._id}/ofertas/${offer.id}/aceptar`;
    expect(
      (await app.inject({ method: 'POST', url, headers: { ...headers(), 'if-match': '"1"' } }))
        .statusCode,
    ).toBe(412);
    const h = { ...headers(), 'if-match': `"${finished.version}"` };
    const accepted = await app.inject({ method: 'POST', url, headers: h });
    expect(accepted.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, headers: h })).statusCode).toBe(200);
    const different = await app.inject({
      method: 'POST',
      url: `/v1/solicitudes/${item._id}/desistir`,
      headers: h,
    });
    expect(different.statusCode).toBe(409);
    await finish(worker, item._id);
    const notified = await mock.records.find({}).toArray();
    expect(notified.map((r) => r.notification).sort()).toEqual(['accepted', 'withdrawn']);
    expect(
      (await app.inject({ url: `/v1/solicitudes/${item._id}/eventos`, headers: headers() }))
        .json()
        .some((e: { action: string }) => e.action === 'ACEPTADA'),
    ).toBe(true);
  });
  it('authenticates callbacks and deduplicates exact replays and terminal decisions', async () => {
    await create();
    const worker = new Worker(store, cfg);
    await worker.tick();
    const record = await mock.records.findOne({ bank: 'pichincha' });
    const result = record!.result;
    const raw = JSON.stringify(result);
    const timestamp = String(Date.now());
    const h = {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': signWebhook(cfg.webhookSecret, timestamp, raw),
    };
    const url = '/v1/webhooks/financieras/pichincha';
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...h, 'x-signature': '0'.repeat(64) },
          payload: raw,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url, headers: h, payload: raw })).json().accepted,
    ).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url, headers: h, payload: raw })).json().accepted,
    ).toBe(false);
    expect(await service.result({ ...result, eventId: randomUUID() }, 'test')).toBe(false);
    await expect(
      service.result({ ...result, applicationId: randomUUID() }, 'test'),
    ).rejects.toMatchObject({ statusCode: 409 });
    const bad = { ...result, bank: 'pacifico' };
    const braw = JSON.stringify(bad);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...h, 'x-signature': signWebhook(cfg.webhookSecret, timestamp, braw) },
          payload: braw,
        })
      ).statusCode,
    ).toBe(422);
  });
  it('handles rejection, conditions, information and withdrawal without resurrection', async () => {
    for (const scenario of ['rechazada', 'condiciones', 'informacion'] as const) {
      const item = await create(scenario);
      const finished = await finish(new Worker(store, cfg), item._id);
      expect(finished.state).toBe(scenario === 'condiciones' ? 'OFERTAS' : 'SIN_OFERTAS');
    }
    const item = await create();
    await expect(
      service.action(
        item._id,
        { ...actor, role: 'supervisor' },
        randomUUID(),
        1,
        undefined,
        'test',
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.action(item._id, actor, randomUUID(), 1, randomUUID(), 'test'),
    ).rejects.toMatchObject({ statusCode: 422 });
    const result = await service.action(item._id, actor, randomUUID(), 1, undefined, 'test');
    expect(result.state).toBe('DESISTIDA');
    await finish(new Worker(store, cfg), item._id);
    expect((await service.get(item._id, actor)).state).toBe('DESISTIDA');
    await expect(
      service.action(item._id, actor, randomUUID(), result.version, undefined, 'test'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('validates consent and financing in business layer and preserves underlying storage errors', async () => {
    await expect(
      service.create(
        { ...input, consent: { ...input.consent, accepted: false } },
        actor,
        'key',
        'cid',
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      service.create(
        { ...input, financing: { ...input.financing, downPaymentCents: input.vehicle.priceCents } },
        actor,
        'key',
        'cid',
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    const spy = vi
      .spyOn(store.applications, 'insertOne')
      .mockRejectedValueOnce(new Error('storage'));
    await expect(create()).rejects.toThrow('storage');
    spy.mockRestore();
  });
  it('returns safe 500 errors and provides restrictive CORS and per-consumer rate limiting', async () => {
    const spy = vi
      .spyOn(store.applications, 'countDocuments')
      .mockRejectedValueOnce(new Error('database-password-should-not-leak'));
    const r = await app.inject({ url: '/v1/solicitudes', headers: headers() });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('password');
    spy.mockRestore();
    const cors = await app.inject({
      method: 'OPTIONS',
      url: '/v1/solicitudes',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(cors.headers['access-control-allow-origin']).not.toBe('https://evil.test');
    const tiny = await createApp({ ...cfg, rateLimit: 1 }, store);
    expect((await tiny.inject({ url: '/v1/auth/me', headers: headers() })).statusCode).toBe(200);
    const limited = await tiny.inject({ url: '/v1/auth/me', headers: headers() });
    expect(limited.statusCode).toBe(429);
    valid('Problem', limited.json());
    await tiny.close();
  });
});
describe('Durable processing, leases, retries and isolation', () => {
  it('recovers transient errors with bounded retries', async () => {
    const item = await create('temporal');
    const done = await finish(new Worker(store, cfg), item._id);
    expect(done.state).toBe('OFERTAS');
    expect(done.audit.some((a) => a.action.endsWith('REINTENTO'))).toBe(true);
  });
  it('isolates a failing bank and persists its DLQ and circuit state', async () => {
    const item = await create();
    const good = adapter('pacifico', cfg);
    const bad: Adapter = {
      submit: async () => {
        throw new Error('offline');
      },
      poll: async () => undefined,
      notify: async () => {
        throw new Error('offline');
      },
    };
    const worker = new Worker(
      store,
      { ...cfg, maxAttempts: 3 },
      { pichincha: bad, pacifico: good },
    );
    const done = await finish(worker, item._id);
    expect(done.submissions.pichincha!.job.state).toBe('dead');
    expect(done.submissions.pacifico!.offer).toBeDefined();
    expect((await store.circuits.findOne({ _id: 'pichincha' }))!.failures).toBe(3);
    await store.circuits.updateOne(
      { _id: 'pichincha' },
      { $set: { openUntil: new Date(Date.now() + 100000) } },
    );
    expect(await worker.process('pichincha')).toBe(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/solicitudes/${item._id}/reintentar`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/solicitudes/${item._id}/reintentar`,
          headers: { authorization: `Bearer ${admin}` },
        })
      ).statusCode,
    ).toBe(200);
    await expect(
      service.retry(item._id, { ...actor, role: 'administrador' }, 'test'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('reclaims expired leases after restart and does not duplicate remote records', async () => {
    const item = await create();
    await store.applications.updateOne(
      { _id: item._id },
      {
        $set: {
          'submissions.pichincha.job.state': 'leased',
          'submissions.pichincha.job.leaseUntil': new Date(0),
        },
      },
    );
    const w1 = new Worker(store, cfg);
    const w2 = new Worker(store, cfg);
    await Promise.all([w1.process('pichincha'), w2.process('pichincha')]);
    expect(await mock.records.countDocuments({ bank: 'pichincha' })).toBe(1);
    await finish(w2, item._id);
  });
  it('fences a slow old worker after its lease is replaced', async () => {
    const item = await create();
    let release!: (id: string) => void;
    const old = new Worker(store, cfg, {
      pichincha: {
        submit: () =>
          new Promise((r) => {
            release = r;
          }),
        poll: async () => undefined,
        notify: async () => {},
      },
      pacifico: adapter('pacifico', cfg),
    });
    const work = old.process('pichincha');
    while (!release) await new Promise((r) => setTimeout(r, 1));
    await store.applications.updateOne(
      { _id: item._id },
      { $set: { 'submissions.pichincha.job.leaseUntil': new Date(0) } },
    );
    await new Worker(store, cfg).process('pichincha');
    release('stale-id');
    await work;
    expect((await service.get(item._id, actor)).submissions.pichincha!.externalId).not.toBe(
      'stale-id',
    );
  });
  it('merges concurrent results, rejects mismatches and enforces terminality', async () => {
    const item = await create();
    const worker = new Worker(store, cfg);
    await worker.tick();
    const records = await mock.records.find({}).toArray();
    await Promise.all(records.map((r) => service.result(r.result, 'test')));
    const a = await service.get(item._id, actor);
    expect(Object.values(a.submissions).filter((s) => s.offer)).toHaveLength(2);
    const withdrawn = await service.action(
      a._id,
      actor,
      randomUUID(),
      a.version,
      undefined,
      'test',
    );
    expect(await service.result({ ...records[0].result, eventId: randomUUID() }, 'test')).toBe(
      false,
    );
    await expect(
      service.retry(a._id, { ...actor, role: 'administrador' }, 'test'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(withdrawn.state).toBe('DESISTIDA');
  });
  it('times out external requests and rejects HTTP and malformed integration responses', async () => {
    const item = await create();
    const slow = adapter('pichincha', { ...cfg, timeoutMs: 5 });
    await expect(slow.submit({ ...item, scenario: 'timeout' }, 'test')).rejects.toThrow();
    const missing = adapter('pacifico', cfg);
    await expect(missing.poll('missing', 'test')).rejects.toBeInstanceOf(IntegrationError);
    const mockFetch = vi.spyOn(globalThis, 'fetch');
    mockFetch.mockResolvedValueOnce(new Response('<!DOCTYPE foo><Respuesta/>'));
    await expect(missing.submit(item, 'test')).rejects.toThrow('Unsafe XML');
    mockFetch.mockResolvedValueOnce(new Response('<Respuesta><tramite>x</tramite></Respuesta>'));
    await expect(missing.poll('id', 'test')).rejects.toThrow('Missing XML result');
    mockFetch.mockRestore();
  });
  it('keeps analysis pending durably until its deadline, then moves failures to DLQ', async () => {
    const item = await create();
    const a: Adapter = {
      submit: async () => 'tracking',
      poll: async () => undefined,
      notify: async () => {},
    };
    const worker = new Worker(store, { ...cfg, maxAttempts: 1 }, { pichincha: a, pacifico: a });
    await worker.tick();
    await new Promise((r) => setTimeout(r, 5));
    await worker.tick();
    expect(pendingJobs(await service.get(item._id, actor))).toBe(2);
    await store.applications.updateOne(
      { _id: item._id },
      { $set: { createdAt: new Date(Date.now() - 130000) } },
    );
    await new Promise((r) => setTimeout(r, 5));
    await worker.tick();
    expect((await service.get(item._id, actor)).submissions.pichincha!.job.state).toBe('dead');
  });
  it('retries dead polling jobs using their original external references', async () => {
    const item = await create();
    await store.applications.updateOne(
      { _id: item._id },
      {
        $set: {
          'submissions.pichincha.externalId': 'tracking',
          'submissions.pichincha.state': 'ERROR',
          'submissions.pichincha.job': { ...newJob('poll'), state: 'dead' },
        },
      },
    );
    const retried = await service.retry(item._id, { ...actor, role: 'administrador' }, 'test');
    expect(retried.submissions.pichincha!.job.kind).toBe('poll');
  });
  it('rejects an invalid result from a separate adapter implementation', async () => {
    const item = await create();
    const fake: Adapter = {
      submit: async () => 'tracking',
      poll: async () =>
        ({
          eventId: randomUUID(),
          applicationId: randomUUID(),
          bank: 'pacifico',
          externalId: 'x',
          decision: 'RECHAZADA',
        }) satisfies BankResult,
      notify: async () => {},
    };
    const worker = new Worker(
      store,
      { ...cfg, maxAttempts: 1 },
      { pichincha: fake, pacifico: fake },
    );
    await worker.tick();
    await new Promise((r) => setTimeout(r, 5));
    await worker.tick();
    expect((await service.get(item._id, actor)).submissions.pichincha!.job.state).toBe('dead');
  });
});
