import { createHash, randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import {
  banks,
  type Actor,
  type Application,
  type ApplicationInput,
  type BankResult,
  type Bank,
  type Job,
  type AuditEvent,
} from '../../shared/domain.js';
import type { Store } from './store.js';
import { Problem } from './errors.js';
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
export const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const audit = (actor: string, action: string, correlationId: string): AuditEvent => ({
  at: new Date().toISOString(),
  actor,
  action,
  correlationId,
});
export const newJob = (kind: Job['kind'] = 'submit', action?: Job['action']): Job => ({
  kind,
  state: 'pending',
  attempts: 0,
  dueAt: new Date(),
  leaseUntil: new Date(0),
  leaseToken: '',
  ...(action ? { action } : {}),
});
export class CreditService {
  constructor(public store: Store) {}
  scope(actor: Actor): Filter<Application> {
    return actor.role === 'administrador' ? {} : { agency: actor.agency };
  }
  async get(id: string, actor: Actor) {
    const item = await this.store.applications.findOne({ _id: id, ...this.scope(actor) });
    if (!item) throw new Problem(404, 'Solicitud no encontrada');
    return item;
  }
  async create(input: ApplicationInput, actor: Actor, key: string, cid: string) {
    if (!input.consent.accepted) throw new Problem(422, 'Debe registrar el consentimiento');
    const { priceCents } = input.vehicle;
    const { downPaymentCents, termMonths } = input.financing;
    if (
      downPaymentCents < Math.ceil(priceCents * 0.2) ||
      downPaymentCents >= priceCents ||
      ![12, 24, 36, 48, 60, 72].includes(termMonths)
    )
      throw new Problem(
        422,
        'Entrada mínima 20 %, menor al precio; plazo de 12 a 72 meses en intervalos de 12',
      );
    const hash = fingerprint(input);
    const item: Application = {
      ...input,
      _id: randomUUID(),
      owner: actor.sub,
      agency: actor.agency,
      state: 'ENVIADA',
      version: 1,
      createdAt: new Date(),
      consentAt: new Date(),
      idempotencyKey: key,
      fingerprint: hash,
      submissions: Object.fromEntries(
        input.banks.map((bank) => [bank, { state: 'PENDIENTE', events: [], job: newJob() }]),
      ),
      audit: [audit(actor.sub, 'REGISTRADA_Y_ENCOLADA', cid)],
      actions: {},
    };
    try {
      await this.store.applications.insertOne(item);
      return { item, replayed: false };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const previous = await this.store.applications.findOne({
        owner: actor.sub,
        idempotencyKey: key,
      });
      if (!previous || previous.fingerprint !== hash)
        throw new Problem(409, 'La clave ya se utilizó con otro contenido');
      return { item: previous, replayed: true };
    }
  }
  async list(
    actor: Actor,
    page: number,
    size: number,
    state?: string,
    bank?: string,
    sort: 'asc' | 'desc' = 'desc',
  ) {
    const filter: Filter<Application> = {
      ...this.scope(actor),
      ...(state ? { state: state as Application['state'] } : {}),
      ...(bank ? { banks: bank as Bank } : {}),
    };
    const [items, total] = await Promise.all([
      this.store.applications
        .find(filter)
        .sort({ createdAt: sort === 'asc' ? 1 : -1, _id: sort === 'asc' ? 1 : -1 })
        .skip((page - 1) * size)
        .limit(size)
        .toArray(),
      this.store.applications.countDocuments(filter),
    ]);
    return { items, total, page, size };
  }
  async action(
    id: string,
    actor: Actor,
    key: string,
    version: number,
    offerId: string | undefined,
    cid: string,
  ) {
    if (actor.role === 'supervisor')
      throw new Problem(403, 'El supervisor tiene acceso de consulta');
    const item = await this.get(id, actor);
    const hash = fingerprint({ offerId: offerId ?? null });
    const actionKey = fingerprint({ actor: actor.sub, key });
    if (item.actions[actionKey]) {
      if (item.actions[actionKey] !== hash) throw new Problem(409, 'Clave de acción reutilizada');
      return item;
    }
    if (item.state === 'ACEPTADA' || item.state === 'DESISTIDA')
      throw new Problem(409, 'La solicitud ya está cerrada');
    if (item.version !== version) throw new Problem(412, 'La solicitud cambió; actualice la vista');
    if (offerId && !Object.values(item.submissions).some((s) => s.offer?.id === offerId))
      throw new Problem(422, 'Oferta no disponible');
    const state = offerId ? 'ACEPTADA' : 'DESISTIDA';
    const set: Record<string, unknown> = { state, [`actions.${actionKey}`]: hash };
    if (offerId) set.acceptedOfferId = offerId;
    for (const b of item.banks) {
      set[`submissions.${b}.job`] = newJob(
        'notify',
        item.submissions[b]?.offer?.id === offerId && offerId ? 'accepted' : 'withdrawn',
      );
    }
    const updated = await this.store.applications.findOneAndUpdate(
      { _id: id, version, state: { $nin: ['ACEPTADA', 'DESISTIDA'] } },
      { $set: set, $inc: { version: 1 }, $push: { audit: audit(actor.sub, state, cid) } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new Problem(412, 'Cambio concurrente; actualice la vista');
    return updated;
  }
  async result(result: BankResult, cid: string) {
    // CAS retries merge independent bank responses and reject stale/replayed events.
    for (let attempt = 0; attempt < 10; attempt++) {
      const item = await this.store.applications.findOne({ _id: result.applicationId });
      const sub = item?.submissions[result.bank];
      if (!item || !sub || sub.externalId !== result.externalId)
        throw new Problem(409, 'Trámite no registrado');
      if (
        Boolean(result.offer) !== ['APROBADA', 'CONDICIONES'].includes(result.decision) ||
        (result.offer &&
          (result.offer.bank !== result.bank ||
            result.offer.termMonths !== item.financing.termMonths ||
            result.offer.downPaymentCents !== item.financing.downPaymentCents))
      )
        throw new Problem(422, 'Oferta inconsistente con el financiamiento solicitado');
      if (sub.events.includes(result.eventId) || ['ACEPTADA', 'DESISTIDA'].includes(item.state))
        return false;
      if (['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION'].includes(sub.state)) return false;
      const submissions = {
        ...item.submissions,
        [result.bank]: {
          ...sub,
          state: result.decision,
          ...(result.offer ? { offer: result.offer } : {}),
        },
      };
      const allDone = item.banks.every((b) =>
        ['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION', 'ERROR'].includes(
          submissions[b]!.state,
        ),
      );
      const state = Object.values(submissions).some((s) => s.offer)
        ? 'OFERTAS'
        : allDone
          ? 'SIN_OFERTAS'
          : 'ENVIADA';
      const r = await this.store.applications.updateOne(
        { _id: item._id, version: item.version },
        {
          $set: {
            state,
            [`submissions.${result.bank}.state`]: result.decision,
            ...(result.offer ? { [`submissions.${result.bank}.offer`]: result.offer } : {}),
          },
          $inc: { version: 1 },
          $push: {
            [`submissions.${result.bank}.events`]: result.eventId,
            audit: audit(`mock:${result.bank}`, result.decision, cid),
          },
        },
      );
      if (r.modifiedCount) return true;
    }
    throw new Problem(409, 'Conflicto concurrente; reintente');
  }
  async retry(id: string, actor: Actor, cid: string) {
    if (actor.role !== 'administrador') throw new Problem(403, 'Solo administrador');
    const item = await this.get(id, actor);
    const closed = ['ACEPTADA', 'DESISTIDA'].includes(item.state);
    const set: Record<string, unknown> = {};
    for (const b of banks) {
      const sub = item.submissions[b];
      if (sub?.job.state !== 'dead' || (closed && sub.job.kind !== 'notify')) continue;
      set[`submissions.${b}.job`] =
        sub.job.kind === 'notify'
          ? newJob('notify', sub.job.action)
          : newJob(sub.externalId ? 'poll' : 'submit');
      if (sub.state === 'ERROR' && sub.job.kind !== 'notify')
        set[`submissions.${b}.state`] = 'PENDIENTE';
    }
    if (!Object.keys(set).length) throw new Problem(409, 'No existen trabajos agotados');
    const updated = await this.store.applications.findOneAndUpdate(
      { _id: id, version: item.version },
      {
        $set: set,
        $inc: { version: 1 },
        $push: { audit: audit(actor.sub, 'REINTENTO_MANUAL', cid) },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new Problem(412, 'Cambio concurrente');
    return updated;
  }
  async reconcile(id: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const item = await this.store.applications.findOne({ _id: id });
      if (!item || ['ACEPTADA', 'DESISTIDA'].includes(item.state)) return;
      const allDone = Object.values(item.submissions).every((s) =>
        ['APROBADA', 'CONDICIONES', 'RECHAZADA', 'INFORMACION', 'ERROR'].includes(s.state),
      );
      const state = Object.values(item.submissions).some((s) => s.offer)
        ? 'OFERTAS'
        : allDone
          ? 'SIN_OFERTAS'
          : 'ENVIADA';
      if (state === item.state) return;
      if (
        (
          await this.store.applications.updateOne(
            { _id: id, version: item.version },
            { $set: { state }, $inc: { version: 1 } },
          )
        ).modifiedCount
      )
        return;
    }
    throw new Problem(409, 'No se pudo consolidar el estado; reintente');
  }
}
