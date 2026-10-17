import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { contract, expand } from './contract.js';
import type { Application, Bank, BankResult } from '../../shared/domain.js';
import type { Config } from './config.js';
export interface Adapter {
  submit(app: Application, cid: string): Promise<string>;
  poll(externalId: string, cid: string): Promise<BankResult | undefined>;
  notify(id: string, action: 'accepted' | 'withdrawn', cid: string): Promise<void>;
}
export class IntegrationError extends Error {}
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validateResult = ajv.compile(expand(contract.components.schemas.BankResult) as object);
const canonicalResult = (value: unknown): BankResult => {
  if (!validateResult(value)) throw new IntegrationError('Invalid canonical result');
  return value as BankResult;
};
export function adapter(bank: Bank, cfg: Config): Adapter {
  const request = async (path: string, init: RequestInit, cid: string) => {
    const response = await fetch(`${cfg.mockUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-mock-key': cfg.mockSecret, 'x-correlation-id': cid },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!response.ok) throw new IntegrationError(`Mock HTTP ${response.status}`);
    return response;
  };
  const input = (a: Application) => ({
    applicationId: a._id,
    principalCents: a.vehicle.priceCents - a.financing.downPaymentCents,
    downPaymentCents: a.financing.downPaymentCents,
    termMonths: a.financing.termMonths,
    scenario: a.scenario,
  });
  if (bank === 'pichincha')
    return {
      async submit(a, cid) {
        const r = await request(
          '/pichincha/applications',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': `${a._id}-${bank}` },
            body: JSON.stringify({
              ...input(a),
              callbackUrl: `${cfg.callbackUrl}/v1/webhooks/financieras/pichincha`,
            }),
          },
          cid,
        );
        return ((await r.json()) as { trackingId: string }).trackingId;
      },
      async poll(id, cid) {
        const r = await request(`/pichincha/applications/${encodeURIComponent(id)}`, {}, cid);
        return r.status === 202 ? undefined : canonicalResult(await r.json());
      },
      async notify(id, action, cid) {
        await request(
          `/pichincha/applications/${id}/decision`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          },
          cid,
        );
      },
    };
  const parse = async (r: Response) => {
    const raw = await r.text();
    if (raw.includes('<!DOCTYPE') || raw.includes('<!ENTITY'))
      throw new IntegrationError('Unsafe XML');
    return new XMLParser({ parseTagValue: false }).parse(raw) as {
      Respuesta: { tramite: string; resultado?: string };
    };
  };
  return {
    async submit(a, cid) {
      const body = new XMLBuilder().build({ Solicitud: { ...input(a) } });
      const r = await request(
        '/pacifico/tramites',
        {
          method: 'POST',
          headers: { 'content-type': 'application/xml', 'idempotency-key': `${a._id}-${bank}` },
          body,
        },
        cid,
      );
      return (await parse(r)).Respuesta.tramite;
    },
    async poll(id, cid) {
      const r = await request(`/pacifico/tramites/${encodeURIComponent(id)}`, {}, cid);
      if (r.status === 202) return undefined;
      const parsed = await parse(r);
      if (!parsed.Respuesta.resultado) throw new IntegrationError('Missing XML result');
      return canonicalResult(JSON.parse(parsed.Respuesta.resultado));
    },
    async notify(id, action, cid) {
      await request(
        `/pacifico/tramites/${id}/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
        cid,
      );
    },
  };
}
