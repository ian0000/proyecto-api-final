export const banks = ['pichincha', 'pacifico'] as const;
export type Bank = (typeof banks)[number];
export const scenarios = [
  'aprobada',
  'condiciones',
  'rechazada',
  'informacion',
  'demora',
  'temporal',
  'timeout',
] as const;
export type Scenario = (typeof scenarios)[number];
export type Role = 'asesor' | 'supervisor' | 'administrador';
export interface Actor {
  sub: string;
  role: Role;
  agency: string;
  name: string;
}
export interface ApplicationInput {
  client: { name: string; email: string; identification: string; incomeCents: number };
  vehicle: { brand: string; model: string; year: number; priceCents: number };
  financing: { downPaymentCents: number; termMonths: number };
  consent: { accepted: boolean; channel: string; evidence: string };
  banks: Bank[];
  scenario: Scenario;
}
export interface Offer {
  id: string;
  bank: Bank;
  annualRate: number;
  termMonths: number;
  installmentCents: number;
  downPaymentCents: number;
  insuranceCents: number;
  conditions: string[];
}
export type Decision = 'APROBADA' | 'CONDICIONES' | 'RECHAZADA' | 'INFORMACION';
export interface BankResult {
  eventId: string;
  applicationId: string;
  bank: Bank;
  externalId: string;
  decision: Decision;
  offer?: Offer;
}
export interface Job {
  kind: 'submit' | 'poll' | 'notify';
  state: 'pending' | 'leased' | 'done' | 'dead';
  attempts: number;
  dueAt: Date;
  leaseUntil: Date;
  leaseToken: string;
  action?: 'accepted' | 'withdrawn';
}
export interface Submission {
  state: 'PENDIENTE' | 'EN_ANALISIS' | Decision | 'ERROR';
  externalId?: string;
  offer?: Offer;
  events: string[];
  job: Job;
}
export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  correlationId: string;
}
export interface Application extends ApplicationInput {
  _id: string;
  agency: string;
  owner: string;
  state: 'ENVIADA' | 'OFERTAS' | 'SIN_OFERTAS' | 'ACEPTADA' | 'DESISTIDA';
  version: number;
  createdAt: Date;
  consentAt: Date;
  submissions: Partial<Record<Bank, Submission>>;
  audit: AuditEvent[];
  idempotencyKey: string;
  fingerprint: string;
  acceptedOfferId?: string;
  actions: Record<string, string>;
}
export interface ApplicationView {
  id: string;
  agency: string;
  state: Application['state'];
  version: number;
  createdAt: string;
  client: ApplicationInput['client'];
  vehicle: ApplicationInput['vehicle'];
  financing: ApplicationInput['financing'];
  banks: Bank[];
  scenario: Scenario;
  submissions: Partial<
    Record<
      Bank,
      { state: Submission['state']; externalId?: string; offer?: Offer; jobState: Job['state'] }
    >
  >;
  audit: AuditEvent[];
  acceptedOfferId?: string;
}
export function view(a: Application): ApplicationView {
  return {
    id: a._id,
    agency: a.agency,
    state: a.state,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    client: a.client,
    vehicle: a.vehicle,
    financing: a.financing,
    banks: a.banks,
    scenario: a.scenario,
    submissions: Object.fromEntries(
      Object.entries(a.submissions).map(([b, s]) => [
        b,
        { state: s.state, externalId: s.externalId, offer: s.offer, jobState: s.job.state },
      ]),
    ),
    audit: a.audit,
    acceptedOfferId: a.acceptedOfferId,
  };
}
