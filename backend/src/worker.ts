import { randomUUID } from 'node:crypto';
import { banks, type Bank, type Application } from '../../shared/domain.js';
import { adapter, type Adapter } from './adapters.js';
import type { Store } from './store.js';
import type { Config } from './config.js';
import { CreditService, audit } from './service.js';
export class Worker {
  service: CreditService;
  constructor(
    public store: Store,
    public cfg: Config,
    public adapters: Record<Bank, Adapter> = {
      pichincha: adapter('pichincha', cfg),
      pacifico: adapter('pacifico', cfg),
    },
  ) {
    this.service = new CreditService(store);
  }
  async tick() {
    return Promise.all(banks.map((b) => this.process(b)));
  }
  async process(bank: Bank) {
    const base = `submissions.${bank}`;
    const jobPath = `${base}.job`;
    const now = new Date();
    const token = randomUUID();
    const circuit = await this.store.circuits.findOne({ _id: bank });
    if (circuit && circuit.openUntil > now) return false;
    const item = await this.store.applications.findOneAndUpdate(
      {
        $and: [
          {
            $or: [
              { [`${jobPath}.state`]: 'pending', [`${jobPath}.dueAt`]: { $lte: now } },
              { [`${jobPath}.state`]: 'leased', [`${jobPath}.leaseUntil`]: { $lte: now } },
            ],
          },
          {
            $or: [
              { state: { $nin: ['ACEPTADA', 'DESISTIDA'] } },
              { [`${jobPath}.kind`]: 'notify' },
            ],
          },
        ],
      },
      {
        $set: {
          [`${jobPath}.state`]: 'leased',
          [`${jobPath}.leaseUntil`]: new Date(now.getTime() + this.cfg.leaseMs),
          [`${jobPath}.leaseToken`]: token,
        },
      },
      { returnDocument: 'after', sort: { createdAt: 1 } },
    );
    if (!item) return false;
    const sub = item.submissions[bank]!;
    const job = sub.job;
    const cid = item.audit[0].correlationId;
    const lease = {
      _id: item._id,
      [`${jobPath}.leaseToken`]: token,
      [`${jobPath}.state`]: 'leased',
    };
    const terminal = await this.store.applications.findOne({
      _id: item._id,
      state: { $in: ['ACEPTADA', 'DESISTIDA'] },
      [`${jobPath}.leaseToken`]: token,
    });
    if (terminal && job.kind !== 'notify') return false;
    try {
      const set: Record<string, unknown> = { [`${jobPath}.state`]: 'done' };
      if (job.kind === 'submit') {
        const id = await this.adapters[bank].submit(item, cid);
        if (!id || typeof id !== 'string') throw new Error('Invalid tracking ID');
        Object.assign(set, {
          [`${base}.externalId`]: id,
          [`${base}.state`]: 'EN_ANALISIS',
          [`${jobPath}.kind`]: 'poll',
          [`${jobPath}.state`]: 'pending',
          [`${jobPath}.attempts`]: 0,
          [`${jobPath}.dueAt`]: new Date(Date.now() + this.cfg.pollMs),
        });
      } else if (job.kind === 'poll') {
        // Completed webhook outcomes need no extra remote call.
        if (!['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION'].includes(sub.state)) {
          const result = await this.adapters[bank].poll(sub.externalId!, cid);
          if (result) {
            if (
              result.bank !== bank ||
              result.applicationId !== item._id ||
              result.externalId !== sub.externalId
            )
              throw new Error('Mismatched external result');
            await this.service.result(result, cid);
          } else {
            if (item.createdAt.getTime() + 120000 < Date.now())
              throw new Error('Analysis deadline exceeded');
            Object.assign(set, {
              [`${jobPath}.state`]: 'pending',
              [`${jobPath}.dueAt`]: new Date(Date.now() + this.cfg.pollMs),
            });
          }
        }
      } else {
        // A submit may have completed remotely before its lease was replaced by acceptance.
        const id = sub.externalId ?? (await this.adapters[bank].submit(item, cid));
        await this.adapters[bank].notify(id, job.action!, cid);
        set[`${base}.externalId`] = id;
      }
      const updated = await this.store.applications.updateOne(lease, {
        $set: set,
        $inc: { version: 1 },
        $push: { audit: audit('worker', `${bank}:${job.kind}:OK`, cid) },
      });
      if (updated.modifiedCount)
        await this.store.circuits.updateOne(
          { _id: bank },
          { $set: { failures: 0, openUntil: new Date(0) } },
          { upsert: true },
        );
    } catch {
      const attempts = job.attempts + 1;
      const dead = attempts >= this.cfg.maxAttempts;
      const set: Record<string, unknown> = {
        [`${jobPath}.state`]: dead ? 'dead' : 'pending',
        [`${jobPath}.attempts`]: attempts,
        [`${jobPath}.dueAt`]: new Date(Date.now() + this.cfg.retryMs * 2 ** (attempts - 1)),
      };
      if (dead && job.kind !== 'notify') set[`${base}.state`] = 'ERROR';
      // A callback can finish the bank while this HTTP request is still in flight.
      // Fence the failure write by both lease and current bank state.
      const decisions = ['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION'];
      const failureLease =
        job.kind === 'notify' ? lease : { ...lease, [`${base}.state`]: { $nin: decisions } };
      const r = await this.store.applications.updateOne(failureLease, {
        $set: set,
        $inc: { version: 1 },
        $push: { audit: audit('worker', `${bank}:${dead ? 'DLQ' : 'REINTENTO'}`, cid) },
      });
      if (!r.modifiedCount && job.kind === 'poll') {
        const settled = await this.store.applications.updateOne(
          { ...lease, [`${base}.state`]: { $in: decisions } },
          {
            $set: { [`${jobPath}.state`]: 'done' },
            $inc: { version: 1 },
            $push: { audit: audit('worker', `${bank}:RESULTADO_PRESERVADO`, cid) },
          },
        );
        if (settled.modifiedCount)
          await this.store.circuits.updateOne(
            { _id: bank },
            { $set: { failures: 0, openUntil: new Date(0) } },
            { upsert: true },
          );
      }
      if (r.modifiedCount) {
        const c = await this.store.circuits.findOneAndUpdate(
          { _id: bank },
          { $inc: { failures: 1 }, $setOnInsert: { openUntil: new Date(0) } },
          { upsert: true, returnDocument: 'after' },
        );
        if (c && c.failures >= 3)
          await this.store.circuits.updateOne(
            { _id: bank },
            { $set: { openUntil: new Date(Date.now() + this.cfg.circuitMs) } },
          );
        if (dead && job.kind !== 'notify') await this.service.reconcile(item._id);
      }
    }
    return true;
  }
}
export function pendingJobs(item: Application) {
  return Object.values(item.submissions).filter(
    (s) => s.job.state === 'pending' || s.job.state === 'leased',
  ).length;
}
