import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import {
  scenarios,
  type Bank,
  type BankResult,
  type Decision,
  type Scenario,
} from '../../shared/domain.js';
import { signWebhook } from '../../shared/security.js';
export interface MockConfig {
  mongoUrl: string;
  dbName: string;
  secret: string;
  webhookSecret: string;
  callbackOrigin: string;
  seed: string;
  delayMs: number;
  timeoutMs: number;
}
interface Input {
  applicationId: string;
  principalCents: number;
  downPaymentCents: number;
  termMonths: number;
  scenario: Scenario;
  callbackUrl?: string;
}
interface Record {
  _id: string;
  bank: Bank;
  input: Input;
  fingerprint: string;
  result: BankResult;
  readyAt: Date;
  attempts: number;
  callbackUrl?: string;
  callbackDone: boolean;
  callbackDue: Date;
  notification?: string;
}
function stableUuid(value: string) {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function outcome(bank: Bank, input: Input, seed: string): BankResult {
  const id = stableUuid(`${seed}:${bank}:${input.applicationId}`);
  const externalId = `${bank}-${id}`;
  const decision: Decision =
    input.scenario === 'rechazada'
      ? 'RECHAZADA'
      : input.scenario === 'informacion'
        ? 'INFORMACION'
        : input.scenario === 'condiciones'
          ? 'CONDICIONES'
          : 'APROBADA';
  const annualRate =
    (bank === 'pichincha' ? 12.5 : 13.2) +
    (parseInt(
      createHash('sha256')
        .update(seed + input.applicationId)
        .digest('hex')
        .slice(0, 2),
      16,
    ) %
      3) /
      10;
  const r = annualRate / 1200;
  const installmentCents = Math.round(
    (input.principalCents * r) / (1 - (1 + r) ** -input.termMonths),
  );
  return {
    eventId: stableUuid(id + ':event'),
    applicationId: input.applicationId,
    bank,
    externalId,
    decision,
    ...(['APROBADA', 'CONDICIONES'].includes(decision)
      ? {
          offer: {
            id,
            bank,
            annualRate,
            termMonths: input.termMonths,
            installmentCents,
            downPaymentCents: input.downPaymentCents,
            insuranceCents: 3500,
            conditions: decision === 'CONDICIONES' ? ['Garante ficticio requerido'] : [],
          },
        }
      : {}),
  };
}
export async function createMocks(cfg: MockConfig) {
  const client = new MongoClient(cfg.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const records = client.db(cfg.dbName).collection<Record>('submissions');
  await records.createIndex({ bank: 1, 'input.applicationId': 1 }, { unique: true });
  await records.createIndex({ callbackDone: 1, callbackDue: 1 });
  const app = Fastify({ logger: false, bodyLimit: 16384 });
  app.addContentTypeParser('application/xml', { parseAs: 'string' }, (_req, body, done) => {
    try {
      if (String(body).includes('<!')) throw new Error('XML declarations prohibited');
      done(null, new XMLParser({ parseTagValue: false }).parse(String(body)));
    } catch {
      done(Object.assign(new Error('Invalid XML'), { statusCode: 400 }));
    }
  });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health/live') return;
    const key = Buffer.from(String(req.headers['x-mock-key'] ?? ''));
    const secret = Buffer.from(cfg.secret);
    if (key.length !== secret.length || !timingSafeEqual(key, secret))
      return reply.code(401).send({ error: 'Unauthorized' });
  });
  app.get('/health/live', async () => ({ status: 'ok', academic: true }));
  app.addHook('onClose', async () => {
    await client.close();
  });
  for (const bank of ['pichincha', 'pacifico'] as const) {
    const path = bank === 'pichincha' ? '/pichincha/applications' : '/pacifico/tramites';
    app.post(path, async (req, reply) => {
      const body =
        bank === 'pichincha' ? req.body : (req.body as { Solicitud?: unknown })?.Solicitud;
      if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Invalid body' });
      const raw = body as Input;
      const input: Input = {
        applicationId: String(raw.applicationId),
        principalCents: Number(raw.principalCents),
        downPaymentCents: Number(raw.downPaymentCents),
        termMonths: Number(raw.termMonths),
        scenario: raw.scenario,
      };
      if (
        !/^[a-f0-9-]{36}$/.test(input.applicationId) ||
        !Number.isInteger(input.principalCents) ||
        input.principalCents < 1 ||
        input.principalCents > 20_000_000 ||
        !Number.isInteger(input.downPaymentCents) ||
        input.downPaymentCents < 0 ||
        ![12, 24, 36, 48, 60, 72].includes(input.termMonths) ||
        !scenarios.includes(input.scenario)
      )
        return reply.code(400).send({ error: 'Invalid fictitious submission' });
      const callback = bank === 'pichincha' ? raw.callbackUrl : undefined;
      if (
        bank === 'pichincha' &&
        callback !== `${cfg.callbackOrigin}/v1/webhooks/financieras/pichincha`
      )
        return reply.code(400).send({ error: 'Callback not allowed' });
      if (req.headers['idempotency-key'] !== `${input.applicationId}-${bank}`)
        return reply.code(400).send({ error: 'Invalid idempotency key' });
      const result = outcome(bank, input, cfg.seed);
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const base: Record = {
        _id: result.externalId,
        bank,
        input,
        fingerprint: hash,
        result,
        readyAt: new Date(
          Date.now() + (input.scenario === 'demora' ? cfg.delayMs * 8 : cfg.delayMs),
        ),
        attempts: 0,
        callbackUrl: callback,
        callbackDone: bank !== 'pichincha',
        callbackDue: new Date(Date.now() + cfg.delayMs),
      };
      try {
        await records.updateOne({ _id: base._id }, { $setOnInsert: base }, { upsert: true });
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
      const saved = await records.findOneAndUpdate(
        { _id: base._id },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
      if (saved!.fingerprint !== hash)
        return reply.code(409).send({ error: 'Idempotency conflict' });
      if (input.scenario === 'temporal' && saved!.attempts <= 2)
        return reply.code(503).send({ error: 'Simulated temporary failure' });
      if (input.scenario === 'timeout')
        await new Promise((resolve) => setTimeout(resolve, cfg.timeoutMs));
      if (bank === 'pichincha')
        return reply.code(202).send({ trackingId: result.externalId, status: 'received' });
      return reply
        .code(202)
        .type('application/xml')
        .send(
          new XMLBuilder().build({ Respuesta: { tramite: result.externalId, estado: 'recibida' } }),
        );
    });
    app.get(`${path}/:id`, async (req, reply) => {
      const record = await records.findOne({ _id: (req.params as { id: string }).id, bank });
      if (!record) return reply.code(404).send({ error: 'Not found' });
      if (record.readyAt > new Date()) return reply.code(202).send({ status: 'analysis' });
      if (bank === 'pichincha') return record.result;
      return reply
        .type('application/xml')
        .send(
          new XMLBuilder().build({
            Respuesta: { tramite: record._id, resultado: JSON.stringify(record.result) },
          }),
        );
    });
    app.post(
      `${path}/:id/decision`,
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: { action: { type: 'string', enum: ['accepted', 'withdrawn'] } },
          },
        },
      },
      async (req, reply) => {
        const action = (req.body as { action: string }).action;
        const r = await records.findOneAndUpdate(
          {
            _id: (req.params as { id: string }).id,
            bank,
            $or: [{ notification: { $exists: false } }, { notification: action }],
          },
          { $set: { notification: action } },
          { returnDocument: 'after' },
        );
        if (!r) return reply.code(409).send({ error: 'Missing record or conflicting decision' });
        return { accepted: true };
      },
    );
  }
  const deliverCallbacks = async () => {
    const now = new Date();
    const pending = await records
      .find({
        bank: 'pichincha',
        callbackDone: false,
        callbackDue: { $lte: now },
        readyAt: { $lte: now },
        'input.scenario': { $ne: 'timeout' },
      })
      .limit(10)
      .toArray();
    await Promise.all(
      pending.map(async (record) => {
        const raw = JSON.stringify(record.result);
        const timestamp = String(Date.now());
        let delivered = false;
        try {
          const r = await fetch(record.callbackUrl!, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-timestamp': timestamp,
              'x-signature': signWebhook(cfg.webhookSecret, timestamp, raw),
              'x-correlation-id': record.input.applicationId,
            },
            body: raw,
            signal: AbortSignal.timeout(2000),
          });
          delivered = r.ok;
        } catch {
          /* Persisted next attempt below. */
        }
        await records.updateOne(
          { _id: record._id },
          { $set: { callbackDone: delivered, callbackDue: new Date(Date.now() + 1000) } },
        );
      }),
    );
    return pending.length;
  };
  return { app, records, deliverCallbacks };
}
