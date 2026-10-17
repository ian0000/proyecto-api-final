import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { ApplicationView } from '../../shared/domain';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item: ApplicationView = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  agency: 'agencia-quito',
  state: 'ENVIADA',
  version: 1,
  createdAt: '2026-10-16T12:00:00Z',
  client: {
    name: 'Cliente Ficticio Uno',
    email: 'cliente@example.test',
    identification: 'DEMO-000001',
    incomeCents: 250000,
  },
  vehicle: { brand: 'Marca Demo', model: 'Modelo Uno', year: 2026, priceCents: 3000000 },
  financing: { downPaymentCents: 900000, termMonths: 48 },
  banks: ['pichincha', 'pacifico'],
  scenario: 'aprobada',
  submissions: {
    pichincha: { state: 'PENDIENTE', jobState: 'pending' },
    pacifico: { state: 'PENDIENTE', jobState: 'pending' },
  },
  audit: [
    {
      at: '2026-10-16T12:00:00Z',
      actor: 'asesor demo',
      action: 'SOLICITUD_CREADA',
      correlationId: 'test-correlation',
    },
  ],
};
function network(role = 'asesor') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/auth/login'))
      return response({
        token: 'test-token',
        user: { sub: 'demo-' + role, role, agency: 'agencia-quito', name: role + ' demo' },
      });
    if (init?.method === 'POST') return response(item, 202);
    return response({ items: [], total: 0, page: 1, size: 10 });
  });
}
async function login() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Contraseña'), 'Fictitious-test-pass!');
  await user.click(screen.getByRole('button', { name: /Ingresar al espacio/ }));
  await screen.findByRole('heading', { name: 'Solicitudes de crédito' });
  return user;
}
async function newForm() {
  const user = await login();
  await user.click(screen.getAllByRole('button', { name: /Nueva solicitud/ })[0]);
  await screen.findByRole('heading', { name: 'Nueva solicitud' });
  return user;
}
function deferredResponse() {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  return { pending, resolve };
}

describe('workspace interactions', () => {
  it('reports rejected credentials and lets the user dismiss the error', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ detail: 'Correo o contraseña incorrectos' }, 401));
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Contraseña'), 'Wrong-fictitious-pass!');
    await user.click(screen.getByRole('button', { name: /Ingresar al espacio/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Correo o contraseña incorrectos',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cerrar error' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('requires consent and at least one selected bank before submitting', async () => {
    const fetch = network();
    render(<App />);
    const user = await newForm();
    const consent = screen.getByRole('checkbox', {
      name: /Registro el consentimiento/,
    }) as HTMLInputElement;
    expect(consent.required).toBe(true);
    await user.click(screen.getByRole('button', { name: /Registrar y enviar/ }));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    await user.click(consent);
    await user.click(screen.getByRole('checkbox', { name: /Banco Pichincha/ }));
    await user.click(screen.getByRole('checkbox', { name: /Banco del Pacífico/ }));
    await user.click(screen.getByRole('button', { name: /Registrar y enviar/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Seleccione al menos una financiera',
    );
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('sends cents, consent, selected bank and a stable idempotency key when retrying a failed create', async () => {
    const fetch = network();
    let creates = 0;
    fetch.mockImplementation(async (url, init) => {
      if (String(url).includes('/auth/login'))
        return response({
          token: 'test-token',
          user: {
            sub: 'demo-asesor',
            role: 'asesor',
            agency: 'agencia-quito',
            name: 'asesor demo',
          },
        });
      if (init?.method === 'POST') {
        creates++;
        return creates === 1
          ? response({ detail: 'Servicio temporalmente no disponible' }, 503)
          : response({ ...item, banks: ['pichincha'] }, 202);
      }
      return response({ items: [], total: 0, page: 1, size: 10 });
    });
    render(<App />);
    const user = await newForm();
    await user.click(screen.getByRole('checkbox', { name: /Registro el consentimiento/ }));
    await user.click(screen.getByRole('checkbox', { name: /Banco del Pacífico/ }));
    await user.click(screen.getByRole('button', { name: /Registrar y enviar/ }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /Registrar y enviar/ }));
    await screen.findByRole('heading', { name: 'Cliente Ficticio Uno' });
    const calls = fetch.mock.calls.filter(
      ([url, init]) => url === '/v1/solicitudes' && init?.method === 'POST',
    );
    expect(calls).toHaveLength(2);
    const first = calls[0][1]!;
    const second = calls[1][1]!;
    expect(first.headers).toEqual(second.headers);
    expect(new Headers(first.headers).get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
    const body = JSON.parse(String(first.body));
    expect(body.banks).toEqual(['pichincha']);
    expect(body.vehicle.priceCents).toBe(3000000);
    expect(body.consent.accepted).toBe(true);
    expect(body.financing.downPaymentCents).toBe(900000);
    expect(screen.getByText('Solicitud registrada')).toBeTruthy();
  });
  it('filters and clears the list through API queries, then closes the session', async () => {
    const fetch = network();
    render(<App />);
    const user = await login();
    await user.selectOptions(screen.getByLabelText('Estado'), 'OFERTAS');
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('state=OFERTAS'))).toBe(true),
    );
    await user.selectOptions(screen.getByLabelText('Financiera'), 'pacifico');
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('bank=pacifico'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(String(fetch.mock.calls.at(-1)?.[0])).not.toContain('bank='));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeTruthy();
  });
  it('shows a read-only workspace for a supervisor', async () => {
    network('supervisor');
    render(<App />);
    await login();
    expect(screen.queryByRole('button', { name: /Nueva solicitud/ })).toBeNull();
  });
  it('refreshes a stale offer version before retrying acceptance without changing its operation key', async () => {
    const offer = {
      id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      bank: 'pichincha' as const,
      annualRate: 12.5,
      termMonths: 48,
      installmentCents: 55000,
      downPaymentCents: 900000,
      insuranceCents: 3500,
      conditions: [],
    };
    const offered: ApplicationView = {
      ...item,
      state: 'OFERTAS',
      submissions: { pichincha: { state: 'APROBADA', offer, jobState: 'done' } },
    };
    let actions = 0;
    const fetch = network();
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/auth/login'))
        return response({
          token: 'test-token',
          user: {
            sub: 'demo-asesor',
            role: 'asesor',
            agency: 'agencia-quito',
            name: 'asesor demo',
          },
        });
      if (String(url).endsWith('/aceptar')) {
        actions++;
        return actions === 1
          ? response({ detail: 'La solicitud cambió; actualice e intente nuevamente' }, 412)
          : response({ ...offered, state: 'ACEPTADA', version: 4, acceptedOfferId: offer.id });
      }
      if (String(url).includes('?'))
        return response({ items: [offered], total: 1, page: 1, size: 10 });
      return response({ ...offered, version: actions ? 3 : 1 });
    });
    render(<App />);
    const user = await login();
    await user.click(
      await screen.findByRole('button', { name: 'Ver solicitud de Cliente Ficticio Uno' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Aceptar esta oferta' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Aceptar esta oferta' }));
    await screen.findByRole('button', { name: '✓ Oferta seleccionada' });
    const calls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/aceptar'));
    expect(new Headers(calls[0][1]?.headers).get('If-Match')).toBe('"1"');
    expect(new Headers(calls[1][1]?.headers).get('If-Match')).toBe('"3"');
    expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(calls[1][1]?.headers).get('Idempotency-Key'),
    );
  });
  it('keeps an accepted offer when an older polling response arrives afterwards', async () => {
    const offer = {
      id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      bank: 'pichincha' as const,
      annualRate: 12.5,
      termMonths: 48,
      installmentCents: 55000,
      downPaymentCents: 900000,
      insuranceCents: 3500,
      conditions: [],
    };
    const offered: ApplicationView = {
      ...item,
      state: 'OFERTAS',
      banks: ['pichincha'],
      submissions: { pichincha: { state: 'APROBADA', offer, jobState: 'done' } },
    };
    const latePoll = deferredResponse();
    let detailRequests = 0;
    let poll: () => void = () => {
      throw new Error('Polling callback was not registered');
    };
    const originalInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      handler: () => void,
      delay?: number,
    ) => {
      if (delay === 1500) {
        poll = handler;
        return originalInterval(() => {}, 60000);
      }
      return originalInterval(handler, delay);
    }) as typeof setInterval);
    const fetch = network();
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/auth/login'))
        return response({
          token: 'test-token',
          user: {
            sub: 'demo-asesor',
            role: 'asesor',
            agency: 'agencia-quito',
            name: 'asesor demo',
          },
        });
      if (String(url).endsWith('/aceptar'))
        return response({ ...offered, state: 'ACEPTADA', version: 3, acceptedOfferId: offer.id });
      if (String(url).includes('?'))
        return response({ items: [offered], total: 1, page: 1, size: 10 });
      detailRequests++;
      return detailRequests === 1 ? response(offered) : latePoll.pending;
    });
    render(<App />);
    const user = await login();
    await user.click(
      await screen.findByRole('button', { name: 'Ver solicitud de Cliente Ficticio Uno' }),
    );
    await screen.findByRole('button', { name: 'Aceptar esta oferta' });
    await act(async () => {
      poll();
    });
    expect(detailRequests).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Aceptar esta oferta' }));
    expect(
      ((await screen.findByRole('button', { name: '✓ Oferta seleccionada' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      latePoll.resolve(response({ ...offered, version: 2 }));
    });
    expect(screen.getByText('Oferta aceptada', { exact: true })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '✓ Oferta seleccionada' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Aceptar esta oferta' })).toBeNull();
  });
  it('ignores a pending create after logout and a different session starts', async () => {
    const lateCreate = deferredResponse();
    let logins = 0;
    const fetch = network();
    fetch.mockImplementation(async (url, init) => {
      if (String(url).includes('/auth/login')) {
        logins++;
        const role = logins === 1 ? 'asesor' : 'supervisor';
        return response({
          token: `test-${role}`,
          user: { sub: `demo-${role}`, role, agency: 'agencia-quito', name: `${role} demo` },
        });
      }
      if (init?.method === 'POST') return lateCreate.pending;
      return response({ items: [], total: 0, page: 1, size: 10 });
    });
    render(<App />);
    const user = await newForm();
    await user.clear(screen.getByLabelText('Nombre completo'));
    await user.type(screen.getByLabelText('Nombre completo'), 'Cliente Sesión Anterior');
    await user.click(screen.getByRole('checkbox', { name: /Registro el consentimiento/ }));
    await user.click(screen.getByRole('button', { name: /Registrar y enviar/ }));
    await screen.findByRole('button', { name: 'Registrando…' });
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByRole('heading', { name: 'Bienvenido de nuevo' });
    await user.clear(screen.getByLabelText('Correo electrónico'));
    await user.type(screen.getByLabelText('Correo electrónico'), 'supervisor@demo.test');
    await login();
    expect(screen.getByText('supervisor demo')).toBeTruthy();
    await act(async () => {
      lateCreate.resolve(
        response({ ...item, client: { ...item.client, name: 'Cliente Sesión Anterior' } }, 202),
      );
    });
    expect(screen.getByRole('heading', { name: 'Solicitudes de crédito' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cliente Sesión Anterior' })).toBeNull();
    expect(screen.queryByText(/Solicitud registrada/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Nueva solicitud/ })).toBeNull();
    expect(screen.getByText('supervisor demo')).toBeTruthy();
  });
  it('returns to login if a workspace request reports an expired session', async () => {
    const fetch = network();
    fetch.mockImplementation(async (url) =>
      String(url).includes('/auth/login')
        ? response({
            token: 'expired-token',
            user: {
              sub: 'demo-asesor',
              role: 'asesor',
              agency: 'agencia-quito',
              name: 'asesor demo',
            },
          })
        : response({ detail: 'Sesión inválida' }, 401),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Contraseña'), 'Fictitious-test-pass!');
    await user.click(screen.getByRole('button', { name: /Ingresar al espacio/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('La sesión venció');
    expect(screen.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeTruthy();
  });
});
