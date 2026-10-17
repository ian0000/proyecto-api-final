import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { adapter, IntegrationError } from '../../src/adapters.js';
import { config } from '../../src/config.js';
import type { Application, ApplicationInput, BankResult } from '../../../shared/domain.js';

const cfg = config({
  JWT_SECRET: 'j'.repeat(40),
  WEBHOOK_SECRET: 'w'.repeat(40),
  MOCK_SECRET: 'm'.repeat(40),
  LOG_LEVEL: 'silent',
});
const input = JSON.parse(
  readFileSync(new URL('../../../shared/example.json', import.meta.url), 'utf8'),
) as ApplicationInput;
const application = { ...input, _id: randomUUID() } as Application;
const fetchMock = vi.fn<typeof fetch>();
const result: BankResult = {
  eventId: randomUUID(),
  applicationId: application._id,
  bank: 'pichincha',
  externalId: 'external-123',
  decision: 'RECHAZADA',
};
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe('Adapters without HTTP network or database', () => {
  it('maps canonical JSON submission and signs the integration request headers', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ trackingId: 'tracking-1' }), { status: 202 }),
    );
    expect(await adapter('pichincha', cfg).submit(application, 'correlation-unit')).toBe(
      'tracking-1',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${cfg.mockUrl}/pichincha/applications`);
    expect(init?.headers).toMatchObject({
      'x-mock-key': cfg.mockSecret,
      'x-correlation-id': 'correlation-unit',
      'idempotency-key': `${application._id}-pichincha`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      applicationId: application._id,
      principalCents: 2100000,
      downPaymentCents: 900000,
      termMonths: 48,
      scenario: 'aprobada',
      callbackUrl: `${cfg.callbackUrl}/v1/webhooks/financieras/pichincha`,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('maps canonical request to XML without using the JSON callback contract', async () => {
    fetchMock.mockResolvedValue(
      new Response('<Respuesta><tramite>xml-1</tramite></Respuesta>', { status: 202 }),
    );
    expect(await adapter('pacifico', cfg).submit(application, 'cid')).toBe('xml-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${cfg.mockUrl}/pacifico/tramites`);
    expect(init?.headers).toMatchObject({
      'content-type': 'application/xml',
      'idempotency-key': `${application._id}-pacifico`,
    });
    expect(new XMLParser().parse(String(init?.body)).Solicitud).toEqual({
      applicationId: application._id,
      principalCents: 2100000,
      downPaymentCents: 900000,
      termMonths: 48,
      scenario: 'aprobada',
    });
  });
  it.each(['pichincha', 'pacifico'] as const)(
    'keeps %s pending on 202 and URL-encodes polling ids',
    async (bank) => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 202 }));
      expect(await adapter(bank, cfg).poll('id/needs encoding', 'cid')).toBeUndefined();
      expect(fetchMock.mock.calls[0][0]).toContain('id%2Fneeds%20encoding');
    },
  );
  it('validates canonical JSON and XML outcomes before returning them', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(result)));
    expect(await adapter('pichincha', cfg).poll('id', 'cid')).toEqual(result);
    const xmlResult = { ...result, bank: 'pacifico' };
    fetchMock.mockResolvedValueOnce(
      new Response(
        new XMLBuilder().build({
          Respuesta: { tramite: 'xml', resultado: JSON.stringify(xmlResult) },
        }),
      ),
    );
    expect(await adapter('pacifico', cfg).poll('id', 'cid')).toEqual(xmlResult);
  });
  it.each(['pichincha', 'pacifico'] as const)(
    'rejects invalid %s canonical payloads',
    async (bank) => {
      const body =
        bank === 'pichincha'
          ? '{}'
          : new XMLBuilder().build({ Respuesta: { tramite: 'x', resultado: '{}' } });
      fetchMock.mockResolvedValueOnce(new Response(body));
      await expect(adapter(bank, cfg).poll('id', 'cid')).rejects.toThrow(
        'Invalid canonical result',
      );
    },
  );
  it.each(['<!DOCTYPE x><Respuesta/>', '<!ENTITY x "unsafe"><Respuesta/>'])(
    'rejects unsafe XML declarations before parsing',
    async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      await expect(adapter('pacifico', cfg).submit(application, 'cid')).rejects.toThrow(
        'Unsafe XML',
      );
    },
  );
  it('rejects XML without a result and propagates malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<Respuesta><tramite>x</tramite></Respuesta>'));
    await expect(adapter('pacifico', cfg).poll('id', 'cid')).rejects.toThrow('Missing XML result');
    fetchMock.mockResolvedValueOnce(
      new Response('<Respuesta><resultado>broken</resultado></Respuesta>'),
    );
    await expect(adapter('pacifico', cfg).poll('id', 'cid')).rejects.toBeInstanceOf(SyntaxError);
  });
  it.each(['pichincha', 'pacifico'] as const)(
    'notifies %s of final business actions with correlation',
    async (bank) => {
      fetchMock.mockResolvedValue(new Response('{}'));
      await adapter(bank, cfg).notify('external-id', 'withdrawn', 'cid-notify');
      expect(fetchMock.mock.calls[0][0]).toContain('/external-id/decision');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        body: '{"action":"withdrawn"}',
        headers: { 'x-correlation-id': 'cid-notify' },
      });
    },
  );
  it('preserves non-success HTTP and transport timeouts as failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(adapter('pichincha', cfg).submit(application, 'cid')).rejects.toEqual(
      new IntegrationError('Mock HTTP 503'),
    );
    fetchMock.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    await expect(adapter('pacifico', cfg).poll('id', 'cid')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});
