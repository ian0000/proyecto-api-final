import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CreditService, newJob } from '../src/service.js';
import { Worker } from '../src/worker.js';
import { config } from '../src/config.js';
import type { Adapter } from '../src/adapters.js';
import type { Actor, ApplicationInput, BankResult } from '../../shared/domain.js';
import { outcome } from '../../mocks/src/app.js';

const cfg = {
  ...config({
    JWT_SECRET: 'j'.repeat(40),
    WEBHOOK_SECRET: 'w'.repeat(40),
    MOCK_SECRET: 'm'.repeat(40),
    LOG_LEVEL: 'silent',
  }),
  mongoUrl: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27027',
  dbName: `credito_races_${randomUUID().replaceAll('-', '')}`,
  maxAttempts: 1,
};
const store = new Store(cfg.mongoUrl, cfg.dbName);
const service = new CreditService(store);
const actor: Actor = {
  sub: 'race-asesor',
  role: 'asesor',
  agency: 'agencia-quito',
  name: 'Asesor ficticio',
};
const admin: Actor = { ...actor, role: 'administrador' };
const input = JSON.parse(
  readFileSync(new URL('../../shared/example.json', import.meta.url), 'utf8'),
) as ApplicationInput;
const unused: Adapter = {
  submit: async () => {
    throw new Error('Unexpected submit');
  },
  poll: async () => {
    throw new Error('Unexpected poll');
  },
  notify: async () => {},
};
const create = async (scenario: ApplicationInput['scenario'] = 'aprobada') =>
  (
    await service.create(
      { ...input, banks: ['pichincha'], scenario },
      actor,
      randomUUID(),
      'race-test',
    )
  ).item;
function resultFor(item: Awaited<ReturnType<typeof create>>): BankResult {
  return outcome(
    'pichincha',
    {
      applicationId: item._id,
      principalCents: item.vehicle.priceCents - item.financing.downPaymentCents,
      downPaymentCents: item.financing.downPaymentCents,
      termMonths: item.financing.termMonths,
      scenario: item.scenario,
    },
    'race',
  );
}
beforeAll(async () => {
  await store.connect();
});
beforeEach(async () => {
  await store.applications.deleteMany({});
  await store.circuits.deleteMany({});
});
afterAll(async () => {
  await store.client.db(cfg.dbName).dropDatabase();
  await store.close();
});

describe('Concurrent callbacks and recovery of closing notifications', () => {
  it.each(['aprobada', 'rechazada'] as const)(
    'does not degrade a webhook decision when an in-flight final poll fails (%s)',
    async (scenario) => {
      const item = await create(scenario);
      const result = resultFor(item);
      await store.applications.updateOne(
        { _id: item._id },
        {
          $set: {
            'submissions.pichincha.externalId': result.externalId,
            'submissions.pichincha.state': 'EN_ANALISIS',
            'submissions.pichincha.job': newJob('poll'),
          },
        },
      );
      let rejectPoll!: (reason: Error) => void;
      let entered!: () => void;
      const polling = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const worker = new Worker(store, cfg, {
        pichincha: {
          ...unused,
          poll: () =>
            new Promise((_resolve, reject) => {
              rejectPoll = reject;
              entered();
            }),
        },
        pacifico: unused,
      });
      const processing = worker.process('pichincha');
      await polling;
      expect(await service.result(result, 'webhook-race')).toBe(true);
      rejectPoll(new Error('Request failed after the callback arrived'));
      await processing;
      const saved = await service.get(item._id, actor);
      expect(saved.submissions.pichincha!.state).toBe(result.decision);
      expect(saved.submissions.pichincha!.job.state).toBe('done');
      expect(saved.state).toBe(scenario === 'aprobada' ? 'OFERTAS' : 'SIN_OFERTAS');
      expect(saved.audit.some((event) => event.action.endsWith(':DLQ'))).toBe(false);
    },
  );

  it.each(['accepted', 'withdrawn'] as const)(
    'recovers a dead %s notification on a closed request preserving its action',
    async (action) => {
      const item = await create();
      const result = resultFor(item);
      await store.applications.updateOne(
        { _id: item._id },
        { $set: { 'submissions.pichincha.externalId': result.externalId } },
      );
      await service.result(result, 'offer');
      const ready = await service.get(item._id, actor);
      const closed = await service.action(
        item._id,
        actor,
        randomUUID(),
        ready.version,
        action === 'accepted' ? result.offer!.id : undefined,
        'close',
      );
      const failing = new Worker(store, cfg, {
        pichincha: {
          ...unused,
          notify: async () => {
            throw new Error('Temporary notification outage');
          },
        },
        pacifico: unused,
      });
      await failing.process('pichincha');
      expect((await service.get(item._id, actor)).submissions.pichincha!.job.state).toBe('dead');
      const retried = await service.retry(item._id, admin, 'manual-recovery');
      expect(retried.state).toBe(closed.state);
      expect(retried.submissions.pichincha!.job).toMatchObject({
        kind: 'notify',
        action,
        state: 'pending',
        attempts: 0,
      });
      const notify = vi.fn(async () => {});
      await new Worker(store, cfg, { pichincha: { ...unused, notify }, pacifico: unused }).process(
        'pichincha',
      );
      expect(notify).toHaveBeenCalledWith(result.externalId, action, 'race-test');
      const saved = await service.get(item._id, actor);
      expect(saved.state).toBe(closed.state);
      expect(saved.submissions.pichincha!.job.state).toBe('done');
      expect(saved.acceptedOfferId).toBe(closed.acceptedOfferId);
    },
  );
});
