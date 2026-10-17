import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Worker, pendingJobs } from '../../src/worker.js';
import { newJob } from '../../src/service.js';
import { config } from '../../src/config.js';
import type { Store } from '../../src/store.js';
import type { Adapter } from '../../src/adapters.js';
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
const now = new Date('2026-10-16T12:00:00Z');
function fixture(kind: 'submit' | 'poll' | 'notify' = 'submit'): Application {
  return {
    ...structuredClone(input),
    _id: 'app-1',
    owner: 'unit-owner',
    agency: 'unit-agency',
    state: 'ENVIADA',
    version: 1,
    createdAt: now,
    consentAt: now,
    idempotencyKey: 'unit-key',
    fingerprint: 'hash',
    submissions: {
      pichincha: {
        state: kind === 'submit' ? 'PENDIENTE' : 'EN_ANALISIS',
        events: [],
        externalId: 'external-1',
        job: newJob(kind, kind === 'notify' ? 'accepted' : undefined),
      },
    },
    audit: [
      { at: now.toISOString(), actor: 'unit-owner', action: 'CREADA', correlationId: 'cid-1' },
    ],
    actions: {},
  };
}
const applications = { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() };
const circuits = { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() };
const external = { submit: vi.fn(), poll: vi.fn(), notify: vi.fn() };
const adapters = { pichincha: external, pacifico: external } satisfies Record<string, Adapter>;
let worker: Worker;
const result: BankResult = {
  eventId: 'event-1',
  applicationId: 'app-1',
  bank: 'pichincha',
  externalId: 'external-1',
  decision: 'RECHAZADA',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  applications.findOne.mockResolvedValue(null);
  applications.findOneAndUpdate.mockResolvedValue(fixture());
  applications.updateOne.mockResolvedValue({ modifiedCount: 1 });
  circuits.findOne.mockResolvedValue(null);
  circuits.findOneAndUpdate.mockResolvedValue({ failures: 1 });
  circuits.updateOne.mockResolvedValue({ modifiedCount: 1 });
  external.submit.mockResolvedValue('external-1');
  external.poll.mockResolvedValue(undefined);
  external.notify.mockResolvedValue(undefined);
  worker = new Worker({ applications, circuits } as unknown as Store, cfg, adapters);
  vi.spyOn(worker.service, 'result').mockResolvedValue(true);
  vi.spyOn(worker.service, 'reconcile').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Worker unit tests with mocked store and alternate adapter ports', () => {
  it('ticks independent financial ports and constructs default adapters without connecting to a database', async () => {
    new Worker({ applications, circuits } as unknown as Store, cfg);
    const process = vi.spyOn(worker, 'process').mockResolvedValue(false);
    expect(await worker.tick()).toEqual([false, false]);
    expect(process.mock.calls).toEqual([['pichincha'], ['pacifico']]);
  });
  it('does not claim work while its financial circuit is open', async () => {
    circuits.findOne.mockResolvedValue({ openUntil: new Date(now.getTime() + 1000) });
    expect(await worker.process('pichincha')).toBe(false);
    expect(applications.findOneAndUpdate).not.toHaveBeenCalled();
    expect(external.submit).not.toHaveBeenCalled();
  });
  it('returns idle when no due or reclaimable job exists', async () => {
    applications.findOneAndUpdate.mockResolvedValue(null);
    expect(await worker.process('pichincha')).toBe(false);
    expect(applications.updateOne).not.toHaveBeenCalled();
  });
  it('claims due or expired leases atomically, excludes closed non-notification work and fences completion', async () => {
    await worker.process('pichincha');
    const [filter, claim, options] = applications.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      $and: [
        {
          $or: [
            {
              'submissions.pichincha.job.state': 'pending',
              'submissions.pichincha.job.dueAt': { $lte: now },
            },
            {
              'submissions.pichincha.job.state': 'leased',
              'submissions.pichincha.job.leaseUntil': { $lte: now },
            },
          ],
        },
        {
          $or: [
            { state: { $nin: ['ACEPTADA', 'DESISTIDA'] } },
            { 'submissions.pichincha.job.kind': 'notify' },
          ],
        },
      ],
    });
    expect(claim.$set).toMatchObject({
      'submissions.pichincha.job.state': 'leased',
      'submissions.pichincha.job.leaseUntil': new Date(now.getTime() + cfg.leaseMs),
      'submissions.pichincha.job.leaseToken': expect.any(String),
    });
    expect(options).toEqual({ returnDocument: 'after', sort: { createdAt: 1 } });
    expect(external.submit).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'app-1' }),
      'cid-1',
    );
    expect(applications.updateOne).toHaveBeenCalledWith(
      {
        _id: 'app-1',
        'submissions.pichincha.job.leaseToken': claim.$set['submissions.pichincha.job.leaseToken'],
        'submissions.pichincha.job.state': 'leased',
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          'submissions.pichincha.externalId': 'external-1',
          'submissions.pichincha.state': 'EN_ANALISIS',
          'submissions.pichincha.job.kind': 'poll',
          'submissions.pichincha.job.state': 'pending',
          'submissions.pichincha.job.attempts': 0,
        }),
        $push: {
          audit: expect.objectContaining({ action: 'pichincha:submit:OK', correlationId: 'cid-1' }),
        },
      }),
    );
    expect(circuits.updateOne).toHaveBeenCalledWith(
      { _id: 'pichincha' },
      { $set: { failures: 0, openUntil: new Date(0) } },
      { upsert: true },
    );
  });
  it('drops a non-notification job closed after it was claimed', async () => {
    applications.findOne.mockResolvedValue({ ...fixture(), state: 'DESISTIDA' });
    expect(await worker.process('pichincha')).toBe(false);
    expect(external.submit).not.toHaveBeenCalled();
  });
  it('does not reset circuit state if an old worker lost its completion lease', async () => {
    applications.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await worker.process('pichincha');
    expect(circuits.updateOne).not.toHaveBeenCalled();
  });
  it.each(['', 42])(
    'treats invalid remote tracking ID %s as a retryable failure',
    async (tracking) => {
      external.submit.mockResolvedValue(tracking);
      await worker.process('pichincha');
      expect(applications.updateOne.mock.calls[0][1].$set).toMatchObject({
        'submissions.pichincha.job.state': 'pending',
        'submissions.pichincha.job.attempts': 1,
      });
    },
  );
  it('keeps analysis pending durably before the deadline', async () => {
    applications.findOneAndUpdate.mockResolvedValue(fixture('poll'));
    await worker.process('pichincha');
    expect(external.poll).toHaveBeenCalledWith('external-1', 'cid-1');
    expect(applications.updateOne.mock.calls[0][1].$set).toMatchObject({
      'submissions.pichincha.job.state': 'pending',
      'submissions.pichincha.job.dueAt': new Date(now.getTime() + cfg.pollMs),
    });
    expect(worker.service.result).not.toHaveBeenCalled();
  });
  it('applies a correlated poll result through the business service before completing the job', async () => {
    applications.findOneAndUpdate.mockResolvedValue(fixture('poll'));
    external.poll.mockResolvedValue(result);
    await worker.process('pichincha');
    expect(worker.service.result).toHaveBeenCalledExactlyOnceWith(result, 'cid-1');
    expect(applications.updateOne.mock.calls[0][1].$set).toEqual({
      'submissions.pichincha.job.state': 'done',
    });
  });
  it.each([
    { ...result, bank: 'pacifico' },
    { ...result, applicationId: 'other' },
    { ...result, externalId: 'other' },
  ])('rejects mismatched external correlation %#', async (foreign) => {
    applications.findOneAndUpdate.mockResolvedValue(fixture('poll'));
    external.poll.mockResolvedValue(foreign);
    await worker.process('pichincha');
    expect(worker.service.result).not.toHaveBeenCalled();
    expect(applications.updateOne.mock.calls[0][1].$set['submissions.pichincha.job.state']).toBe(
      'pending',
    );
  });
  it('does not call the remote port after a webhook has already supplied a final decision', async () => {
    const item = fixture('poll');
    item.submissions.pichincha!.state = 'APROBADA';
    applications.findOneAndUpdate.mockResolvedValue(item);
    await worker.process('pichincha');
    expect(external.poll).not.toHaveBeenCalled();
    expect(applications.updateOne.mock.calls[0][1].$set).toEqual({
      'submissions.pichincha.job.state': 'done',
    });
  });
  it('moves overdue analysis to DLQ and asks the service to consolidate aggregate state', async () => {
    const item = fixture('poll');
    item.createdAt = new Date(now.getTime() - 120001);
    item.submissions.pichincha!.job.attempts = cfg.maxAttempts - 1;
    applications.findOneAndUpdate.mockResolvedValue(item);
    await worker.process('pichincha');
    expect(applications.updateOne.mock.calls[0][1].$set).toMatchObject({
      'submissions.pichincha.job.state': 'dead',
      'submissions.pichincha.state': 'ERROR',
      'submissions.pichincha.job.attempts': cfg.maxAttempts,
    });
    expect(worker.service.reconcile).toHaveBeenCalledWith(item._id);
  });
  it('notifies accepted or withdrawn actions even when the aggregate is already closed', async () => {
    const item = fixture('notify');
    item.state = 'ACEPTADA';
    applications.findOneAndUpdate.mockResolvedValue(item);
    applications.findOne.mockResolvedValue(item);
    await worker.process('pichincha');
    expect(external.notify).toHaveBeenCalledExactlyOnceWith('external-1', 'accepted', 'cid-1');
    expect(external.submit).not.toHaveBeenCalled();
  });
  it('recovers a missing remote reference before sending a closing notification', async () => {
    const item = fixture('notify');
    delete item.submissions.pichincha!.externalId;
    item.submissions.pichincha!.job.action = 'withdrawn';
    applications.findOneAndUpdate.mockResolvedValue(item);
    await worker.process('pichincha');
    expect(external.submit).toHaveBeenCalled();
    expect(external.notify).toHaveBeenCalledWith('external-1', 'withdrawn', 'cid-1');
  });
  it('persists exponential backoff and opens a circuit after repeated failures', async () => {
    const item = fixture();
    item.submissions.pichincha!.job.attempts = 1;
    applications.findOneAndUpdate.mockResolvedValue(item);
    external.submit.mockRejectedValue(new Error('offline'));
    circuits.findOneAndUpdate.mockResolvedValue({ failures: 3 });
    await worker.process('pichincha');
    expect(applications.updateOne.mock.calls[0][1].$set).toMatchObject({
      'submissions.pichincha.job.state': 'pending',
      'submissions.pichincha.job.attempts': 2,
      'submissions.pichincha.job.dueAt': new Date(now.getTime() + cfg.retryMs * 2),
    });
    expect(circuits.updateOne).toHaveBeenCalledWith(
      { _id: 'pichincha' },
      { $set: { openUntil: new Date(now.getTime() + cfg.circuitMs) } },
    );
    expect(worker.service.reconcile).not.toHaveBeenCalled();
  });
  it('does not mark a bank ERROR or reopen it when notification delivery exhausts retries', async () => {
    const item = fixture('notify');
    item.submissions.pichincha!.job.attempts = cfg.maxAttempts - 1;
    applications.findOneAndUpdate.mockResolvedValue(item);
    external.notify.mockRejectedValue(new Error('offline'));
    circuits.findOneAndUpdate.mockResolvedValue(null);
    await worker.process('pichincha');
    const update = applications.updateOne.mock.calls[0];
    expect(update[0]).not.toHaveProperty('submissions.pichincha.state');
    expect(update[1].$set['submissions.pichincha.job.state']).toBe('dead');
    expect(update[1].$set).not.toHaveProperty('submissions.pichincha.state');
    expect(worker.service.reconcile).not.toHaveBeenCalled();
  });
  it('preserves a webhook decision that wins while an in-flight poll fails', async () => {
    applications.findOneAndUpdate.mockResolvedValue(fixture('poll'));
    external.poll.mockRejectedValue(new Error('late network failure'));
    applications.updateOne
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    await worker.process('pichincha');
    expect(applications.updateOne.mock.calls[0][0]).toHaveProperty('submissions.pichincha.state', {
      $nin: ['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION'],
    });
    expect(applications.updateOne.mock.calls[1][0]).toHaveProperty('submissions.pichincha.state', {
      $in: ['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION'],
    });
    expect(applications.updateOne.mock.calls[1][1].$set).toEqual({
      'submissions.pichincha.job.state': 'done',
    });
    expect(circuits.findOneAndUpdate).not.toHaveBeenCalled();
    expect(circuits.updateOne).toHaveBeenCalled();
  });
  it('does not settle or count failures after another worker replaced the lease', async () => {
    applications.findOneAndUpdate.mockResolvedValue(fixture('poll'));
    external.poll.mockRejectedValue(new Error('offline'));
    applications.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await worker.process('pichincha');
    expect(applications.updateOne).toHaveBeenCalledTimes(2);
    expect(circuits.findOneAndUpdate).not.toHaveBeenCalled();
    expect(circuits.updateOne).not.toHaveBeenCalled();
  });
  it('ignores failures of a stale submit lease without attempting callback settlement', async () => {
    external.submit.mockRejectedValue(new Error('offline'));
    applications.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await worker.process('pichincha');
    expect(applications.updateOne).toHaveBeenCalledTimes(1);
    expect(circuits.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('counts pending and leased work while excluding completed or dead work', () => {
    const item = fixture();
    item.submissions.pacifico = { state: 'ERROR', events: [], job: { ...newJob(), state: 'dead' } };
    expect(pendingJobs(item)).toBe(1);
    item.submissions.pichincha!.job.state = 'leased';
    expect(pendingJobs(item)).toBe(1);
    item.submissions.pichincha!.job.state = 'done';
    expect(pendingJobs(item)).toBe(0);
  });
});
