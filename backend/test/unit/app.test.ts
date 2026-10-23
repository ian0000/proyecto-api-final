import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { hashPassword } from '../../src/auth.js';
import { CreditService, newJob } from '../../src/service.js';
import { Problem } from '../../src/errors.js';
import type { Store } from '../../src/store.js';
import { signWebhook } from '../../../shared/security.js';
import type {
  Actor,
  Application,
  ApplicationInput,
  BankResult,
  Offer,
} from '../../../shared/domain.js';

const cfg = config({
  JWT_SECRET: 'unit-jwt-secret'.repeat(3),
  WEBHOOK_SECRET: 'unit-hook-secret'.repeat(3),
  MOCK_SECRET: 'unit-mock-secret'.repeat(3),
  LOG_LEVEL: 'silent',
  RATE_LIMIT: '1000',
  CORS_ORIGINS: 'http://unit.test',
});
const actor: Actor = {
  sub: 'unit-advisor',
  role: 'asesor',
  agency: 'agencia-quito',
  name: 'Unit advisor',
};
const input = JSON.parse(
  readFileSync(new URL('../../../shared/example.json', import.meta.url), 'utf8'),
) as ApplicationInput;
const password = 'fictional-unit-password';
const user = {
  ...actor,
  _id: actor.sub,
  email: 'unit@demo.test',
  passwordHash: hashPassword(password),
};
const command = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const findOne = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const countDocuments = vi.fn<(...args: unknown[]) => Promise<number>>();
const store = {
  client: { db: () => ({ command }) },
  users: { findOne },
  applications: { countDocuments },
} as unknown as Store;
const offer: Offer = {
  id: randomUUID(),
  bank: 'pichincha',
  annualRate: 12.5,
  termMonths: 48,
  installmentCents: 55000,
  downPaymentCents: 900000,
  insuranceCents: 3500,
  conditions: [],
};
const item: Application = {
  ...input,
  _id: randomUUID(),
  agency: actor.agency,
  owner: actor.sub,
  state: 'OFERTAS',
  version: 3,
  createdAt: new Date(),
  consentAt: new Date(),
  submissions: {
    pichincha: { state: 'APROBADA', externalId: 'external-p', offer, events: [], job: newJob() },
    pacifico: { state: 'PENDIENTE', events: [], job: newJob() },
  },
  audit: [
    {
      at: new Date().toISOString(),
      actor: actor.sub,
      action: 'CREATED',
      correlationId: 'unit-correlation',
    },
  ],
  idempotencyKey: 'unit-key',
  fingerprint: 'unit-fingerprint',
  actions: {},
};
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  app = await createApp(cfg, store);
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  vi.restoreAllMocks();
  command.mockReset().mockResolvedValue({ ok: 1 });
  findOne.mockReset().mockResolvedValue(user);
  countDocuments.mockReset().mockResolvedValue(2);
});
const authorization = (role: Actor['role'] = 'asesor') => ({
  authorization: `Bearer ${app.jwt.sign({ ...actor, role, sub: `unit-${role}` })}`,
});
const writeHeaders = (role: Actor['role'] = 'asesor') => ({
  ...authorization(role),
  'idempotency-key': 'unit-key-1234',
  'x-correlation-id': 'unit-correlation',
});
const signed = (result: BankResult) => {
  const raw = JSON.stringify(result);
  const timestamp = String(Date.now());
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': signWebhook(cfg.webhookSecret, timestamp, raw),
    },
  };
};
describe('HTTP controller units: Fastify.inject with service/store doubles, no sockets or database', () => {
  it('serves health and contract publicly, including readiness dependency failure', async () => {
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    expect(command).toHaveBeenCalledWith({ ping: 1 });
    command.mockRejectedValueOnce(new Error('private database URI'));
    const failed = await app.inject('/health/ready');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private database URI');
    const contract = await app.inject('/openapi.json');
    expect(contract.statusCode).toBe(200);
    expect(contract.json().openapi).toBe('3.0.3');
    expect(contract.json().servers[0].url).toBe('/');
    expect((await app.inject('/docs/')).statusCode).toBe(200);
  });
  it('authenticates against a salted hash, normalizes email and returns no hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'UNIT@DEMO.TEST', password },
    });
    expect(response.statusCode).toBe(200);
    expect(findOne).toHaveBeenCalledWith({ email: 'unit@demo.test' });
    expect(response.json()).toMatchObject({ user: actor, expiresIn: 3600 });
    expect(response.body).not.toContain('passwordHash');
    const token = response.json().token;
    expect(
      (
        await app.inject({ url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } })
      ).json(),
    ).toEqual(actor);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'unit@demo.test', password: 'incorrect-password' },
    });
    expect(bad.statusCode).toBe(401);
    findOne.mockResolvedValueOnce(null);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'unknown@demo.test', password },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rejects missing/invalid JWTs and generates safe correlation ids', async () => {
    const missing = await app.inject('/v1/solicitudes?ignored=secret');
    expect(missing.statusCode).toBe(401);
    expect(missing.json().instance).toBe('/v1/solicitudes');
    expect(missing.headers['x-correlation-id']).toMatch(/^[a-f0-9-]{36}$/);
    const invalid = await app.inject({
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer invalid', 'x-correlation-id': 'short' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.headers['x-correlation-id']).not.toBe('short');
    const expired = app.jwt.sign(actor, { expiresIn: -1 });
    expect(
      (await app.inject({ url: '/v1/auth/me', headers: { authorization: `Bearer ${expired}` } }))
        .statusCode,
    ).toBe(401);
  });
  it('returns academic bank descriptors and CORS preflight headers', async () => {
    const banks = await app.inject({ url: '/v1/financieras', headers: authorization() });
    expect(banks.json()).toEqual([
      { id: 'pichincha', name: 'Banco Pichincha', protocol: 'JSON + webhook HMAC', academic: true },
      { id: 'pacifico', name: 'Banco del Pacífico', protocol: 'XML + polling', academic: true },
    ]);
    const cors = await app.inject({
      method: 'OPTIONS',
      url: '/v1/solicitudes',
      headers: {
        origin: 'http://unit.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,idempotency-key',
      },
    });
    expect(cors.statusCode).toBe(204);
    expect(cors.headers['access-control-allow-origin']).toBe('http://unit.test');
  });
  it('creates asynchronous requests and propagates idempotency, location, ETag and correlation', async () => {
    const create = vi
      .spyOn(CreditService.prototype, 'create')
      .mockResolvedValue({ item, replayed: false });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/solicitudes',
      headers: writeHeaders(),
      payload: input,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().id).toBe(item._id);
    expect(response.headers).toMatchObject({
      location: `/v1/solicitudes/${item._id}`,
      etag: '"3"',
      'idempotency-replayed': 'false',
      'x-correlation-id': 'unit-correlation',
    });
    expect(create).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ role: 'asesor' }),
      'unit-key-1234',
      'unit-correlation',
    );
    create.mockResolvedValueOnce({ item, replayed: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: writeHeaders(),
          payload: input,
        })
      ).headers['idempotency-replayed'],
    ).toBe('true');
  });
  it('forbids supervisor writes before calling the application service', async () => {
    const create = vi.spyOn(CreditService.prototype, 'create');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: writeHeaders('supervisor'),
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it('validates JSON, headers and query parameters before calling services', async () => {
    const create = vi.spyOn(CreditService.prototype, 'create');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/solicitudes',
          headers: { ...authorization(), 'content-type': 'application/json' },
          payload: '{broken',
        })
      ).statusCode,
    ).toBe(400);
    const absentKey = await app.inject({
      method: 'POST',
      url: '/v1/solicitudes',
      headers: authorization(),
      payload: input,
    });
    expect(absentKey.statusCode).toBe(400);
    expect(absentKey.json().detail).toContain('Revise los campos');
    expect(
      (await app.inject({ url: '/v1/solicitudes?size=101', headers: authorization() })).statusCode,
    ).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('coerces validated pagination/filter values and applies contract defaults', async () => {
    const list = vi
      .spyOn(CreditService.prototype, 'list')
      .mockResolvedValue({ items: [item], page: 1, size: 20, total: 1 });
    const response = await app.inject({ url: '/v1/solicitudes', headers: authorization() });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].id).toBe(item._id);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'asesor' }),
      1,
      20,
      undefined,
      undefined,
      undefined,
    );
    await app.inject({
      url: '/v1/solicitudes?page=2&size=5&state=OFERTAS&bank=pichincha&sort=asc',
      headers: authorization(),
    });
    expect(list).toHaveBeenLastCalledWith(expect.any(Object), 2, 5, 'OFERTAS', 'pichincha', 'asc');
  });
  it('returns ETags and 304, and maps nested answers, offers and audit', async () => {
    const get = vi.spyOn(CreditService.prototype, 'get').mockResolvedValue(item);
    const base = `/v1/solicitudes/${item._id}`;
    expect((await app.inject({ url: base, headers: authorization() })).headers.etag).toBe('"3"');
    const unchanged = await app.inject({
      url: base,
      headers: { ...authorization(), 'if-none-match': '"3"' },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');
    expect(
      (await app.inject({ url: `${base}/respuestas`, headers: authorization() })).json().pichincha
        .offer,
    ).toEqual(offer);
    expect((await app.inject({ url: `${base}/ofertas`, headers: authorization() })).json()).toEqual(
      [offer],
    );
    expect((await app.inject({ url: `${base}/eventos`, headers: authorization() })).json()).toEqual(
      item.audit,
    );
    expect(get).toHaveBeenCalledWith(item._id, expect.objectContaining({ role: 'asesor' }));
  });
  it('routes acceptance and withdrawal with optimistic version headers', async () => {
    const action = vi.spyOn(CreditService.prototype, 'action').mockResolvedValue(item);
    const headers = { ...writeHeaders(), 'if-match': '"3"' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/solicitudes/${item._id}/ofertas/${offer.id}/aceptar`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(action).toHaveBeenLastCalledWith(
      item._id,
      expect.any(Object),
      'unit-key-1234',
      3,
      offer.id,
      'unit-correlation',
    );
    expect(
      (await app.inject({ method: 'POST', url: `/v1/solicitudes/${item._id}/desistir`, headers }))
        .statusCode,
    ).toBe(200);
    expect(action).toHaveBeenLastCalledWith(
      item._id,
      expect.any(Object),
      'unit-key-1234',
      3,
      undefined,
      'unit-correlation',
    );
  });
  it('requires valid HMAC, consistent bank and decision/offer semantics', async () => {
    const result = vi.spyOn(CreditService.prototype, 'result').mockResolvedValue(true);
    const body: BankResult = {
      eventId: randomUUID(),
      applicationId: item._id,
      bank: 'pichincha',
      externalId: 'external',
      decision: 'APROBADA',
      offer,
    };
    const url = '/v1/webhooks/financieras/pichincha';
    const valid = await app.inject({ method: 'POST', url, ...signed(body) });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ accepted: true });
    expect(result).toHaveBeenCalledWith(body, expect.any(String));
    const invalid = signed(body);
    invalid.headers['x-signature'] = '0'.repeat(64);
    expect((await app.inject({ method: 'POST', url, ...invalid })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url, ...signed({ ...body, bank: 'pacifico' }) }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          ...signed({ ...body, offer: { ...offer, bank: 'pacifico' } }),
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: 'POST', url, ...signed({ ...body, offer: undefined }) }))
        .statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: 'POST', url, ...signed({ ...body, decision: 'RECHAZADA' }) }))
        .statusCode,
    ).toBe(422);
    result.mockResolvedValueOnce(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          ...signed({ ...body, decision: 'RECHAZADA', offer: undefined }),
        })
      ).json(),
    ).toEqual({ accepted: false });
  });
  it('restricts manual retry and queue metrics to administrators', async () => {
    const retry = vi.spyOn(CreditService.prototype, 'retry').mockResolvedValue(item);
    const url = `/v1/admin/solicitudes/${item._id}/reintentar`;
    expect((await app.inject({ method: 'POST', url, headers: authorization() })).statusCode).toBe(
      403,
    );
    expect(retry).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: 'POST', url, headers: authorization('administrador') }))
        .statusCode,
    ).toBe(200);
    expect(retry).toHaveBeenCalledWith(
      item._id,
      expect.objectContaining({ role: 'administrador' }),
      expect.any(String),
    );
    expect(
      (await app.inject({ url: '/v1/admin/metrics', headers: authorization() })).statusCode,
    ).toBe(403);
    countDocuments.mockResolvedValueOnce(7).mockResolvedValueOnce(2);
    const metrics = await app.inject({
      url: '/v1/admin/metrics',
      headers: authorization('administrador'),
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json()).toMatchObject({
      queuePending: 7,
      queueDead: 2,
      memoryRssBytes: expect.any(Number),
      cpuUserMicros: expect.any(Number),
    });
    expect(countDocuments).toHaveBeenCalledWith({
      $or: [
        { 'submissions.pichincha.job.state': 'pending' },
        { 'submissions.pacifico.job.state': 'pending' },
      ],
    });
  });
  it('normalizes domain errors, unknown routes and unexpected errors without leaking internal details', async () => {
    const get = vi
      .spyOn(CreditService.prototype, 'get')
      .mockRejectedValue(new Problem(404, 'No access to item'));
    const denied = await app.inject({
      url: `/v1/solicitudes/${item._id}`,
      headers: authorization(),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.headers['content-type']).toContain('application/problem+json');
    get.mockRejectedValueOnce(new Error('mongodb://secret-host/credentials'));
    const failed = await app.inject({
      url: `/v1/solicitudes/${item._id}`,
      headers: authorization(),
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().detail).toBe('Intente nuevamente más tarde');
    expect(failed.body).not.toContain('secret-host');
    expect(
      (await app.inject({ url: '/missing-unit-route', headers: authorization() })).json(),
    ).toMatchObject({ status: 404, title: 'No encontrado' });
  });
  it('enforces 429 rather than calling the service after the identity quota', async () => {
    const limited = await createApp({ ...cfg, rateLimit: 2 }, store);
    try {
      await limited.ready();
      const headers = { authorization: `Bearer ${limited.jwt.sign(actor)}` };
      expect((await limited.inject({ url: '/v1/auth/me', headers })).statusCode).toBe(200);
      expect((await limited.inject({ url: '/v1/auth/me', headers })).statusCode).toBe(200);
      const third = await limited.inject({ url: '/v1/auth/me', headers });
      expect(third.statusCode).toBe(429);
      expect(third.json().detail).toContain('Demasiadas solicitudes');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await limited.close();
    }
  });
});
