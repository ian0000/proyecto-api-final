import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CreditService, audit, fingerprint, newJob } from '../../src/service.js';
import type { Store } from '../../src/store.js';
import type {
  Actor,
  Application,
  ApplicationInput,
  BankResult,
  Offer,
} from '../../../shared/domain.js';

const actor: Actor = {
  sub: 'unit-asesor',
  role: 'asesor',
  agency: 'unit-agency',
  name: 'Asesor ficticio',
};
const admin: Actor = { ...actor, role: 'administrador' };
const input = JSON.parse(
  readFileSync(new URL('../../../shared/example.json', import.meta.url), 'utf8'),
) as ApplicationInput;
const offer: Offer = {
  id: 'offer-1',
  bank: 'pichincha',
  annualRate: 12,
  termMonths: input.financing.termMonths,
  installmentCents: 50000,
  downPaymentCents: input.financing.downPaymentCents,
  insuranceCents: 3500,
  conditions: [],
};
function fixture(): Application {
  return {
    ...structuredClone(input),
    _id: 'application-1',
    owner: actor.sub,
    agency: actor.agency,
    state: 'ENVIADA',
    version: 7,
    createdAt: new Date('2026-10-16T00:00:00Z'),
    consentAt: new Date(),
    idempotencyKey: 'key-1',
    fingerprint: fingerprint(input),
    submissions: {
      pichincha: {
        state: 'EN_ANALISIS',
        externalId: 'external-1',
        events: [],
        job: newJob('poll'),
      },
      pacifico: { state: 'PENDIENTE', events: [], job: newJob() },
    },
    audit: [audit(actor.sub, 'CREADA', 'cid-1')],
    actions: {},
  };
}
function result(): BankResult {
  return {
    eventId: 'event-1',
    applicationId: 'application-1',
    bank: 'pichincha',
    externalId: 'external-1',
    decision: 'APROBADA',
    offer: structuredClone(offer),
  };
}
const applications = {
  findOne: vi.fn(),
  insertOne: vi.fn(),
  updateOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  find: vi.fn(),
  countDocuments: vi.fn(),
};
const service = new CreditService({ applications } as unknown as Store);
beforeEach(() => {
  vi.resetAllMocks();
  applications.insertOne.mockResolvedValue({});
  applications.updateOne.mockResolvedValue({ modifiedCount: 1 });
  applications.findOne.mockResolvedValue(fixture());
  applications.findOneAndUpdate.mockResolvedValue(fixture());
});

describe('CreditService unit business rules with mocked persistence port', () => {
  it('canonicalizes property order while preserving array values and records audit metadata', () => {
    expect(fingerprint({ b: [null, 2, { z: 1, a: true }], a: 'x' })).toBe(
      fingerprint({ a: 'x', b: [null, 2, { a: true, z: 1 }] }),
    );
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    expect(audit(actor.sub, 'ACEPTADA', 'cid')).toMatchObject({
      actor: actor.sub,
      action: 'ACEPTADA',
      correlationId: 'cid',
      at: expect.any(String),
    });
    expect(newJob('notify', 'accepted')).toMatchObject({
      kind: 'notify',
      state: 'pending',
      attempts: 0,
      action: 'accepted',
      leaseToken: '',
    });
  });
  it('scopes agency reads and grants only the administrator global reads', async () => {
    expect(service.scope(admin)).toEqual({});
    expect(service.scope(actor)).toEqual({ agency: actor.agency });
    const item = await service.get('application-1', actor);
    expect(item._id).toBe('application-1');
    expect(applications.findOne).toHaveBeenCalledWith({
      _id: 'application-1',
      agency: actor.agency,
    });
    applications.findOne.mockResolvedValueOnce(null);
    await expect(service.get('missing', admin)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('atomically creates canonical data, consent evidence and one durable job per selected bank', async () => {
    const { item, replayed } = await service.create(input, actor, 'request-key', 'cid');
    expect(replayed).toBe(false);
    expect(item).toMatchObject({
      owner: actor.sub,
      agency: actor.agency,
      state: 'ENVIADA',
      version: 1,
      idempotencyKey: 'request-key',
      fingerprint: fingerprint(input),
    });
    expect(item.consentAt).toBeInstanceOf(Date);
    expect(item.audit[0]).toMatchObject({
      actor: actor.sub,
      action: 'REGISTRADA_Y_ENCOLADA',
      correlationId: 'cid',
    });
    expect(Object.keys(item.submissions)).toEqual(input.banks);
    expect(
      Object.values(item.submissions).every(
        (sub) => sub.job.kind === 'submit' && sub.job.state === 'pending',
      ),
    ).toBe(true);
    expect(applications.insertOne).toHaveBeenCalledExactlyOnceWith(item);
  });
  it.each([
    { ...input, consent: { ...input.consent, accepted: false } },
    { ...input, financing: { ...input.financing, downPaymentCents: 1 } },
    { ...input, financing: { ...input.financing, downPaymentCents: input.vehicle.priceCents } },
    { ...input, financing: { ...input.financing, termMonths: 13 } },
  ])('rejects invalid consent or financing before writing %#', async (bad) => {
    await expect(service.create(bad, actor, 'key', 'cid')).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(applications.insertOne).not.toHaveBeenCalled();
  });
  it('replays the current resource for a duplicate key with equivalent canonical content', async () => {
    const previous = { ...fixture(), state: 'OFERTAS' as const };
    applications.insertOne.mockRejectedValueOnce({ code: 11000 });
    applications.findOne.mockResolvedValueOnce(previous);
    expect(await service.create(input, actor, 'key', 'cid')).toEqual({
      item: previous,
      replayed: true,
    });
    expect(applications.findOne).toHaveBeenCalledWith({ owner: actor.sub, idempotencyKey: 'key' });
  });
  it.each([null, { ...fixture(), fingerprint: 'different' }])(
    'rejects absent or conflicting duplicate records %#',
    async (previous) => {
      applications.insertOne.mockRejectedValueOnce({ code: 11000 });
      applications.findOne.mockResolvedValueOnce(previous);
      await expect(service.create(input, actor, 'key', 'cid')).rejects.toMatchObject({
        statusCode: 409,
      });
    },
  );
  it('propagates genuine storage failures rather than treating them as duplicate keys', async () => {
    const failure = new Error('database unavailable');
    applications.insertOne.mockRejectedValueOnce(failure);
    await expect(service.create(input, actor, 'key', 'cid')).rejects.toBe(failure);
  });
  it.each(['asc', 'desc'] as const)(
    'applies stable %s ordering, pagination and agency filters',
    async (sort) => {
      const cursor = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([fixture()]),
      };
      applications.find.mockReturnValue(cursor);
      applications.countDocuments.mockResolvedValue(8);
      expect(await service.list(actor, 2, 3, 'OFERTAS', 'pichincha', sort)).toMatchObject({
        total: 8,
        page: 2,
        size: 3,
      });
      expect(applications.find).toHaveBeenCalledWith({
        agency: actor.agency,
        state: 'OFERTAS',
        banks: 'pichincha',
      });
      expect(cursor.sort).toHaveBeenCalledWith({
        createdAt: sort === 'asc' ? 1 : -1,
        _id: sort === 'asc' ? 1 : -1,
      });
      expect(cursor.skip).toHaveBeenCalledWith(3);
      expect(cursor.limit).toHaveBeenCalledWith(3);
      await service.list(admin, 1, 20);
      expect(applications.find).toHaveBeenLastCalledWith({});
    },
  );
  it('forbids supervisor mutation before reading persistence', async () => {
    await expect(
      service.action('id', { ...actor, role: 'supervisor' }, 'key', 7, undefined, 'cid'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(applications.findOne).not.toHaveBeenCalled();
  });
  it('replays the same action before stale-version checks but rejects a changed operation', async () => {
    const item = fixture();
    item.actions[fingerprint({ actor: actor.sub, key: 'key' })] = fingerprint({ offerId: null });
    applications.findOne.mockResolvedValue(item);
    expect(await service.action(item._id, actor, 'key', 1, undefined, 'cid')).toBe(item);
    await expect(service.action(item._id, actor, 'key', 7, 'another', 'cid')).rejects.toMatchObject(
      { statusCode: 409 },
    );
    expect(applications.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it.each(['ACEPTADA', 'DESISTIDA'] as const)('forbids a new action on %s', async (state) => {
    applications.findOne.mockResolvedValue({ ...fixture(), state });
    await expect(service.action('id', actor, 'key', 7, undefined, 'cid')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
  it('rejects obsolete versions and offers absent from the aggregate', async () => {
    await expect(service.action('id', actor, 'key', 6, undefined, 'cid')).rejects.toMatchObject({
      statusCode: 412,
    });
    await expect(service.action('id', actor, 'key', 7, 'missing', 'cid')).rejects.toMatchObject({
      statusCode: 422,
    });
  });
  it('accepts one offer with CAS and durable selected/withdrawn notifications', async () => {
    const item = fixture();
    item.submissions.pichincha!.offer = offer;
    applications.findOne.mockResolvedValue(item);
    await service.action(item._id, actor, 'key', 7, offer.id, 'cid');
    expect(applications.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: item._id, version: 7, state: { $nin: ['ACEPTADA', 'DESISTIDA'] } },
      expect.objectContaining({
        $inc: { version: 1 },
        $set: expect.objectContaining({
          state: 'ACEPTADA',
          acceptedOfferId: offer.id,
          'submissions.pichincha.job': expect.objectContaining({
            kind: 'notify',
            action: 'accepted',
          }),
          'submissions.pacifico.job': expect.objectContaining({
            kind: 'notify',
            action: 'withdrawn',
          }),
        }),
        $push: {
          audit: expect.objectContaining({
            actor: actor.sub,
            action: 'ACEPTADA',
            correlationId: 'cid',
          }),
        },
      }),
      { returnDocument: 'after' },
    );
  });
  it('withdraws without an accepted offer and reports lost CAS instead of claiming success', async () => {
    await service.action('id', actor, 'key', 7, undefined, 'cid');
    expect(applications.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      state: 'DESISTIDA',
      'submissions.pichincha.job': expect.objectContaining({ action: 'withdrawn' }),
    });
    expect(applications.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty(
      'acceptedOfferId',
    );
    applications.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(service.action('id', actor, 'other', 7, undefined, 'cid')).rejects.toMatchObject({
      statusCode: 412,
    });
  });
  it.each([
    null,
    { ...fixture(), submissions: {} },
    {
      ...fixture(),
      submissions: { pichincha: { ...fixture().submissions.pichincha!, externalId: 'wrong' } },
    },
  ])('rejects uncorrelated external results %#', async (item) => {
    applications.findOne.mockResolvedValue(item);
    await expect(service.result(result(), 'cid')).rejects.toMatchObject({ statusCode: 409 });
    expect(applications.updateOne).not.toHaveBeenCalled();
  });
  it.each([
    { ...result(), offer: undefined },
    { ...result(), decision: 'RECHAZADA' as const },
    { ...result(), offer: { ...offer, bank: 'pacifico' as const } },
    { ...result(), offer: { ...offer, termMonths: 13 } },
    { ...result(), offer: { ...offer, downPaymentCents: 1 } },
  ])(
    'rejects offers incompatible with the decision or requested financing %#',
    async (external) => {
      await expect(service.result(external, 'cid')).rejects.toMatchObject({ statusCode: 422 });
      expect(applications.updateOne).not.toHaveBeenCalled();
    },
  );
  it('ignores event replays, closed applications and an already decided bank', async () => {
    const replay = fixture();
    replay.submissions.pichincha!.events = ['event-1'];
    applications.findOne.mockResolvedValueOnce(replay);
    expect(await service.result(result(), 'cid')).toBe(false);
    applications.findOne.mockResolvedValueOnce({ ...fixture(), state: 'DESISTIDA' });
    expect(await service.result(result(), 'cid')).toBe(false);
    const decided = fixture();
    decided.submissions.pichincha!.state = 'RECHAZADA';
    applications.findOne.mockResolvedValueOnce(decided);
    expect(await service.result(result(), 'cid')).toBe(false);
    expect(applications.updateOne).not.toHaveBeenCalled();
  });
  it('merges an approval using version CAS and appends event identity and correlation audit', async () => {
    applications.updateOne
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    expect(await service.result(result(), 'cid')).toBe(true);
    expect(applications.updateOne).toHaveBeenCalledTimes(2);
    expect(applications.updateOne).toHaveBeenLastCalledWith(
      { _id: 'application-1', version: 7 },
      expect.objectContaining({
        $set: expect.objectContaining({ state: 'OFERTAS', 'submissions.pichincha.offer': offer }),
        $inc: { version: 1 },
        $push: {
          'submissions.pichincha.events': 'event-1',
          audit: expect.objectContaining({
            actor: 'mock:pichincha',
            action: 'APROBADA',
            correlationId: 'cid',
          }),
        },
      }),
    );
  });
  it('keeps pending banks open and consolidates all negative decisions without offers', async () => {
    const rejected = { ...result(), decision: 'RECHAZADA' as const, offer: undefined };
    await service.result(rejected, 'cid');
    expect(applications.updateOne.mock.calls[0][1].$set.state).toBe('ENVIADA');
    const item = fixture();
    item.submissions.pacifico!.state = 'ERROR';
    applications.findOne.mockResolvedValue(item);
    await service.result(rejected, 'cid');
    expect(applications.updateOne.mock.calls[1][1].$set.state).toBe('SIN_OFERTAS');
  });
  it('bounds result CAS retries instead of silently losing concurrent updates', async () => {
    applications.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(service.result(result(), 'cid')).rejects.toMatchObject({ statusCode: 409 });
    expect(applications.updateOne).toHaveBeenCalledTimes(10);
  });
  it('limits manual recovery to administrators and genuinely recoverable jobs', async () => {
    await expect(service.retry('id', actor, 'cid')).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.retry('id', admin, 'cid')).rejects.toMatchObject({ statusCode: 409 });
    const closed = fixture();
    closed.state = 'ACEPTADA';
    closed.submissions.pichincha!.job = { ...newJob('poll'), state: 'dead' };
    applications.findOne.mockResolvedValue(closed);
    await expect(service.retry('id', admin, 'cid')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('preserves closed notification kind and acceptance action when recovering DLQ', async () => {
    const item = fixture();
    item.state = 'ACEPTADA';
    item.acceptedOfferId = offer.id;
    item.submissions.pichincha!.job = { ...newJob('notify', 'accepted'), state: 'dead' };
    applications.findOne.mockResolvedValue(item);
    await service.retry(item._id, admin, 'cid');
    const update = applications.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual({
      'submissions.pichincha.job': expect.objectContaining({
        kind: 'notify',
        action: 'accepted',
        state: 'pending',
        attempts: 0,
      }),
    });
    expect(update.$set).not.toHaveProperty('state');
    expect(update.$push.audit).toMatchObject({
      actor: admin.sub,
      action: 'REINTENTO_MANUAL',
      correlationId: 'cid',
    });
  });
  it('restarts dead submits or polls based on persisted external reference and rejects CAS loss', async () => {
    const item = fixture();
    item.submissions.pichincha!.state = 'ERROR';
    item.submissions.pichincha!.job = { ...newJob('poll'), state: 'dead' };
    item.submissions.pacifico!.job = { ...newJob(), state: 'dead' };
    applications.findOne.mockResolvedValue(item);
    await service.retry('id', admin, 'cid');
    expect(applications.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      'submissions.pichincha.state': 'PENDIENTE',
      'submissions.pichincha.job': expect.objectContaining({ kind: 'poll' }),
      'submissions.pacifico.job': expect.objectContaining({ kind: 'submit' }),
    });
    applications.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(service.retry('id', admin, 'cid')).rejects.toMatchObject({ statusCode: 412 });
  });
  it('does not reconcile missing, closed or already consistent requests', async () => {
    applications.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...fixture(), state: 'ACEPTADA' })
      .mockResolvedValueOnce(fixture());
    await service.reconcile('missing');
    await service.reconcile('closed');
    await service.reconcile('current');
    expect(applications.updateOne).not.toHaveBeenCalled();
  });
  it.each(['SIN_OFERTAS', 'OFERTAS', 'ENVIADA'] as const)(
    'reconciles aggregate %s with CAS',
    async (state) => {
      const item = fixture();
      item.state = 'SIN_OFERTAS';
      if (state === 'SIN_OFERTAS') {
        item.state = 'ENVIADA';
        item.submissions.pichincha!.state = 'ERROR';
        item.submissions.pacifico!.state = 'RECHAZADA';
      }
      if (state === 'OFERTAS') item.submissions.pichincha!.offer = offer;
      applications.findOne.mockResolvedValue(item);
      await service.reconcile(item._id);
      expect(applications.updateOne).toHaveBeenCalledWith(
        { _id: item._id, version: 7 },
        { $set: { state }, $inc: { version: 1 } },
      );
    },
  );
  it('retries reconciliation CAS collisions and bounds persistent contention', async () => {
    const item = fixture();
    item.state = 'SIN_OFERTAS';
    applications.findOne.mockResolvedValue(item);
    applications.updateOne
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    await service.reconcile('id');
    expect(applications.updateOne).toHaveBeenCalledTimes(2);
    applications.updateOne.mockClear().mockResolvedValue({ modifiedCount: 0 });
    await expect(service.reconcile('id')).rejects.toMatchObject({ statusCode: 409 });
    expect(applications.updateOne).toHaveBeenCalledTimes(10);
  });
});
