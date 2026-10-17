import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { createMocks, outcome, type MockConfig } from '../src/app.js';
import { verifyWebhook } from '../../shared/security.js';
import type { Scenario } from '../../shared/domain.js';

const cfg: MockConfig = {
  mongoUrl: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27027',
  dbName: `credito_mock_test_${randomUUID().replaceAll('-', '')}`,
  secret: 'test-only-mock-key-0000000000000000',
  webhookSecret: 'test-only-webhook-0000000000000000',
  callbackOrigin: 'http://127.0.0.1:4000',
  seed: 'reproducible-test-v1',
  delayMs: 5,
  timeoutMs: 30,
};
let runtime: Awaited<ReturnType<typeof createMocks>>;
const input = (scenario: Scenario = 'aprobada') => ({
  applicationId: randomUUID(),
  principalCents: 2100000,
  downPaymentCents: 900000,
  termMonths: 48,
  scenario,
  callbackUrl: `${cfg.callbackOrigin}/v1/webhooks/financieras/pichincha`,
});
beforeAll(async () => {
  runtime = await createMocks(cfg);
  await runtime.app.ready();
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (runtime) await runtime.app.close();
  const client = new MongoClient(cfg.mongoUrl);
  await client.connect();
  await client.db(cfg.dbName).dropDatabase();
  await client.close();
});
const submit = (body: ReturnType<typeof input>, headers: Record<string, string> = {}) =>
  runtime.app.inject({
    method: 'POST',
    url: '/pichincha/applications',
    headers: {
      'x-mock-key': cfg.secret,
      'idempotency-key': `${body.applicationId}-pichincha`,
      ...headers,
    },
    payload: body,
  });

describe('deterministic financial simulators', () => {
  it('has stable outcomes for a seed and changes IDs for another seed', () => {
    const body = input();
    expect(outcome('pichincha', body, cfg.seed)).toEqual(outcome('pichincha', body, cfg.seed));
    expect(outcome('pichincha', body, 'another-seed').eventId).not.toBe(
      outcome('pichincha', body, cfg.seed).eventId,
    );
  });
  it.each([
    ['aprobada', 'APROBADA', true],
    ['condiciones', 'CONDICIONES', true],
    ['rechazada', 'RECHAZADA', false],
    ['informacion', 'INFORMACION', false],
  ] as const)('maps %s to the canonical decision %s', (scenario, decision, offered) => {
    const result = outcome('pacifico', input(scenario), cfg.seed);
    expect(result.decision).toBe(decision);
    expect(Boolean(result.offer)).toBe(offered);
    if (result.offer) {
      expect(result.offer.installmentCents).toBeGreaterThan(0);
      expect(result.offer.termMonths).toBe(48);
    }
  });
  it('protects mock endpoints and leaves only liveness public', async () => {
    expect((await runtime.app.inject('/health/live')).statusCode).toBe(200);
    expect((await runtime.app.inject('/pichincha/applications/unknown')).statusCode).toBe(401);
    expect((await submit(input(), { 'x-mock-key': 'invalid' })).statusCode).toBe(401);
    expect(
      (await submit(input(), { 'x-mock-key': 'é'.repeat(cfg.secret.length) })).statusCode,
    ).toBe(401);
  });
  it('rejects invalid financial input, callback destinations and missing idempotency', async () => {
    const invalids = [
      { principalCents: -1 },
      { principalCents: 1.5 },
      { termMonths: 13 },
      { applicationId: 'not-uuid' },
      { scenario: 'unknown' },
      { callbackUrl: 'http://169.254.169.254/latest/meta-data' },
      { callbackUrl: `${cfg.callbackOrigin}.attacker.test/v1/webhooks/financieras/pichincha` },
    ];
    for (const patch of invalids)
      expect((await submit({ ...input(), ...patch } as ReturnType<typeof input>)).statusCode).toBe(
        400,
      );
    expect((await submit(input(), { 'idempotency-key': 'incorrect' })).statusCode).toBe(400);
  });
  it('replays one record and rejects a changed payload under the same key', async () => {
    const body = input();
    const first = await submit(body);
    const replay = await submit(body);
    expect(first.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    expect(
      await runtime.records.countDocuments({ 'input.applicationId': body.applicationId }),
    ).toBe(1);
    expect((await submit({ ...body, principalCents: 2000000 })).statusCode).toBe(409);
  });
  it('recovers exactly after two simulated temporary failures', async () => {
    const body = input('temporal');
    expect((await submit(body)).statusCode).toBe(503);
    expect((await submit(body)).statusCode).toBe(503);
    expect((await submit(body)).statusCode).toBe(202);
  });
  it('delays timeout submissions and withholds their callbacks', async () => {
    await runtime.records.updateMany({}, { $set: { callbackDone: true } });
    const started = performance.now();
    const body = input('timeout');
    const sent = await submit(body);
    expect(sent.statusCode).toBe(202);
    expect(performance.now() - started).toBeGreaterThanOrEqual(cfg.timeoutMs - 2);
    await runtime.records.updateOne(
      { _id: sent.json().trackingId },
      { $set: { readyAt: new Date(0), callbackDue: new Date(0) } },
    );
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await runtime.deliverCallbacks()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it('serves XML polling and makes decision notifications idempotent', async () => {
    const body = input('condiciones');
    const headers = {
      'x-mock-key': cfg.secret,
      'idempotency-key': `${body.applicationId}-pacifico`,
      'content-type': 'application/xml',
    };
    const sent = await runtime.app.inject({
      method: 'POST',
      url: '/pacifico/tramites',
      headers,
      payload: new XMLBuilder().build({ Solicitud: body }),
    });
    expect(sent.statusCode).toBe(202);
    const id = new XMLParser().parse(sent.body).Respuesta.tramite;
    await runtime.records.updateOne({ _id: id }, { $set: { readyAt: new Date(0) } });
    const polled = await runtime.app.inject({
      url: `/pacifico/tramites/${id}`,
      headers: { 'x-mock-key': cfg.secret },
    });
    expect(polled.headers['content-type']).toContain('application/xml');
    const canonical = JSON.parse(new XMLParser().parse(polled.body).Respuesta.resultado);
    expect(canonical.decision).toBe('CONDICIONES');
    for (const action of ['accepted', 'accepted', 'withdrawn', 'bogus']) {
      const result = await runtime.app.inject({
        method: 'POST',
        url: `/pacifico/tramites/${id}/decision`,
        headers: { 'x-mock-key': cfg.secret },
        payload: { action },
      });
      expect(result.statusCode).toBe(action === 'withdrawn' ? 409 : action === 'bogus' ? 400 : 200);
    }
  });
  it('rejects XML declarations and keeps a delayed result pending', async () => {
    const rejected = await runtime.app.inject({
      method: 'POST',
      url: '/pacifico/tramites',
      headers: { 'x-mock-key': cfg.secret, 'content-type': 'application/xml' },
      payload: '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><Solicitud>&a;</Solicitud>',
    });
    expect(rejected.statusCode).toBe(400);
    const body = input('demora');
    const sent = await submit(body);
    await runtime.records.updateOne(
      { _id: sent.json().trackingId },
      { $set: { readyAt: new Date(Date.now() + 60000) } },
    );
    expect(
      (
        await runtime.app.inject({
          url: `/pichincha/applications/${sent.json().trackingId}`,
          headers: { 'x-mock-key': cfg.secret },
        })
      ).statusCode,
    ).toBe(202);
  });
  it('signs callbacks, retries failed delivery and stops after success', async () => {
    await runtime.records.updateMany({}, { $set: { callbackDone: true } });
    const body = input();
    const sent = await submit(body);
    await runtime.records.updateOne(
      { _id: sent.json().trackingId },
      { $set: { readyAt: new Date(0), callbackDue: new Date(0) } },
    );
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    try {
      expect(await runtime.deliverCallbacks()).toBe(1);
      expect((await runtime.records.findOne({ _id: sent.json().trackingId }))?.callbackDone).toBe(
        false,
      );
      await runtime.records.updateOne(
        { _id: sent.json().trackingId },
        { $set: { callbackDue: new Date(0) } },
      );
      expect(await runtime.deliverCallbacks()).toBe(1);
      expect(await runtime.deliverCallbacks()).toBe(0);
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe(body.callbackUrl);
      const headers = new Headers(options?.headers);
      expect(
        verifyWebhook(
          cfg.webhookSecret,
          headers.get('x-timestamp')!,
          String(options?.body),
          headers.get('x-signature')!,
        ),
      ).toBe(true);
      expect(headers.get('x-correlation-id')).toBe(body.applicationId);
    } finally {
      fetch.mockRestore();
    }
  });
});
