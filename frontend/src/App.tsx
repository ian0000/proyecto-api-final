import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import type {
  Actor,
  ApplicationInput,
  ApplicationView,
  Bank,
  Offer,
  Scenario,
} from '../../shared/domain';
type Session = { token: string; user: Actor };
type Page = { items: ApplicationView[]; total: number; page: number; size: number };
const money = (cents: number) =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(cents / 100);
const bankName = (bank: string) =>
  bank === 'pichincha' ? 'Banco Pichincha' : 'Banco del Pacífico';
const labels: Record<string, string> = {
  ENVIADA: 'En evaluación',
  OFERTAS: 'Con ofertas',
  SIN_OFERTAS: 'Sin ofertas',
  ACEPTADA: 'Oferta aceptada',
  DESISTIDA: 'Desistida',
  PENDIENTE: 'Pendiente de envío',
  EN_ANALISIS: 'En análisis',
  APROBADA: 'Aprobada',
  CONDICIONES: 'Con condiciones',
  RECHAZADA: 'Rechazada',
  INFORMACION: 'Información requerida',
  ERROR: 'Integración agotada',
};
const scenarioLabels: Record<Scenario, string> = {
  aprobada: 'Aprobación',
  condiciones: 'Aprobación con condiciones',
  rechazada: 'Rechazo',
  informacion: 'Solicitud de información',
  demora: 'Evaluación demorada',
  temporal: 'Fallo temporal y recuperación',
  timeout: 'Timeout persistente',
};
function eventLabel(action: string) {
  const known: Record<string, string> = {
    REGISTRADA_Y_ENCOLADA: 'Solicitud registrada y envío solicitado',
    SOLICITUD_CREADA: 'Solicitud registrada',
    ACEPTADA: 'Oferta seleccionada',
    DESISTIDA: 'Desistimiento registrado',
    APROBADA: 'Solicitud aprobada',
    CONDICIONES: 'Aprobación con condiciones',
    RECHAZADA: 'Solicitud rechazada',
    INFORMACION: 'Información adicional solicitada',
    REINTENTO_MANUAL: 'Reanudación de comunicación solicitada',
  };
  if (known[action]) return known[action];
  const [bank, operation, result] = action.split(':');
  if (!['pichincha', 'pacifico'].includes(bank)) return 'Actividad registrada';
  const name = bankName(bank);
  if (operation === 'DLQ') return `Comunicación con ${name} requiere revisión`;
  if (operation === 'REINTENTO') return `Reintentando la comunicación con ${name}`;
  if (operation === 'RESULTADO_PRESERVADO') return `Respuesta de ${name} confirmada`;
  if (result === 'OK') {
    if (operation === 'submit') return `Solicitud enviada a ${name}`;
    if (operation === 'notify') return `Decisión comunicada a ${name}`;
    if (operation === 'poll') return `Estado consultado en ${name}`;
  }
  return 'Actividad registrada';
}
function eventActor(actor: string) {
  if (actor === 'worker') return 'Plataforma';
  if (actor.startsWith('mock:')) return `${bankName(actor.slice(5))} · simulación`;
  return (
    (
      {
        'demo-asesor': 'Asesor',
        'demo-supervisor': 'Supervisor',
        'demo-administrador': 'Administrador',
      } as Record<string, string>
    )[actor] ?? 'Usuario de la agencia'
  );
}
function Badge({ state }: { state: string }) {
  return (
    <span
      className={`badge ${['OFERTAS', 'APROBADA', 'ACEPTADA'].includes(state) ? 'success' : ['ERROR', 'RECHAZADA', 'SIN_OFERTAS'].includes(state) ? 'warning' : ''}`}
    >
      {labels[state] ?? state}
    </span>
  );
}
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<'list' | 'new' | 'detail'>('list');
  const [page, setPage] = useState<Page>({ items: [], total: 0, page: 1, size: 10 });
  const [filters, setFilters] = useState({ page: 1, state: '', bank: '', sort: 'desc' });
  const [detail, setDetail] = useState<ApplicationView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const generation = useRef(0);
  const creation = useRef({ body: '', key: '' });
  const actionKeys = useRef(new Map<string, string>());
  const token = session?.token;
  function updateDetail(data: ApplicationView) {
    setDetail((previous) =>
      previous?.id === data.id && previous.version > data.version ? previous : data,
    );
  }
  function navigate(next: 'list' | 'new' | 'detail') {
    generation.current++;
    setActionBusy(false);
    setScreen(next);
    if (next === 'list') setFilters((previous) => ({ ...previous }));
  }
  const logout = () => {
    generation.current++;
    setSession(null);
    setDetail(null);
    setScreen('list');
    setError('');
    setNotice('');
    setPage({ items: [], total: 0, page: 1, size: 10 });
    setFilters({ page: 1, state: '', bank: '', sort: 'desc' });
    setActionBusy(false);
    actionKeys.current.clear();
    creation.current = { body: '', key: '' };
  };
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      logout();
      setError('La sesión venció. Ingrese nuevamente.');
    } else setError(e instanceof Error ? e.message : 'No se pudo completar la operación');
  }
  useEffect(() => {
    if (!token || screen !== 'list') return;
    const gen = generation.current;
    let alive = true;
    setLoading(true);
    api<Page>(
      `/v1/solicitudes?${new URLSearchParams({ page: String(filters.page), size: '10', ...(filters.state ? { state: filters.state } : {}), ...(filters.bank ? { bank: filters.bank } : {}), sort: filters.sort })}`,
      token,
    )
      .then((data) => {
        if (alive && gen === generation.current) setPage(data);
      })
      .catch((e) => {
        if (alive && gen === generation.current) handleError(e);
      })
      .finally(() => {
        if (alive && gen === generation.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, screen, filters]);
  useEffect(() => {
    if (!token || screen !== 'detail' || !detail) return;
    const id = detail.id;
    const gen = generation.current;
    let alive = true;
    const timer = setInterval(() => {
      api<ApplicationView>(`/v1/solicitudes/${id}`, token)
        .then((data) => {
          if (alive && gen === generation.current) updateDetail(data);
        })
        .catch((e) => {
          if (alive && gen === generation.current) handleError(e);
        });
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, screen, detail?.id]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoginBusy(true);
    const form = new FormData(event.currentTarget);
    const gen = generation.current;
    try {
      const result = await api<Session>('/v1/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      if (gen !== generation.current) return;
      generation.current++;
      setSession(result);
      setScreen('list');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible iniciar sesión');
    } finally {
      setLoginBusy(false);
    }
  }
  async function open(item: ApplicationView) {
    const gen = ++generation.current;
    setError('');
    setNotice('');
    try {
      const current = await api<ApplicationView>(`/v1/solicitudes/${item.id}`, token);
      if (gen === generation.current) {
        updateDetail(current);
        setScreen('detail');
      }
    } catch (e) {
      if (gen === generation.current) handleError(e);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const gen = generation.current;
    setActionBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const data: ApplicationInput = {
      client: {
        name: String(form.get('name')),
        email: String(form.get('email')),
        identification: String(form.get('identification')),
        incomeCents: Math.round(Number(form.get('income')) * 100),
      },
      vehicle: {
        brand: String(form.get('brand')),
        model: String(form.get('model')),
        year: Number(form.get('year')),
        priceCents: Math.round(Number(form.get('price')) * 100),
      },
      financing: {
        downPaymentCents: Math.round(Number(form.get('downPayment')) * 100),
        termMonths: Number(form.get('term')),
      },
      consent: {
        accepted: form.get('consent') === 'on',
        channel: 'web',
        evidence: 'Consentimiento ficticio registrado por el asesor en el sandbox académico',
      },
      banks: form.getAll('banks') as Bank[],
      scenario: form.get('scenario') as Scenario,
    };
    if (!data.banks.length) {
      setError('Seleccione al menos una financiera');
      setActionBusy(false);
      return;
    }
    const body = JSON.stringify(data);
    if (creation.current.body !== body) creation.current = { body, key: crypto.randomUUID() };
    try {
      const result = await api<ApplicationView>('/v1/solicitudes', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': creation.current.key },
        body,
      });
      if (gen !== generation.current) return;
      updateDetail(result);
      setScreen('detail');
      setNotice('Solicitud registrada. Las financieras están procesando el envío.');
      creation.current = { body: '', key: '' };
    } catch (e) {
      if (gen === generation.current) handleError(e);
    } finally {
      if (gen === generation.current) setActionBusy(false);
    }
  }
  async function act(offer?: Offer) {
    if (!detail || !token) return;
    const gen = generation.current;
    setActionBusy(true);
    setError('');
    const suffix = offer ? `ofertas/${offer.id}/aceptar` : 'desistir';
    const op = `${detail.id}:${suffix}`;
    if (!actionKeys.current.has(op)) actionKeys.current.set(op, crypto.randomUUID());
    try {
      const result = await api<ApplicationView>(`/v1/solicitudes/${detail.id}/${suffix}`, token, {
        method: 'POST',
        headers: {
          'If-Match': `"${detail.version}"`,
          'Idempotency-Key': actionKeys.current.get(op)!,
        },
      });
      if (gen !== generation.current) return;
      updateDetail(result);
      setNotice(
        offer
          ? 'Oferta aceptada. Se notificará a ambas financieras.'
          : 'Solicitud desistida. Se notificará a las financieras.',
      );
    } catch (e) {
      if (gen !== generation.current) return;
      handleError(e);
      if (e instanceof ApiError && e.status === 412) {
        try {
          const current = await api<ApplicationView>(`/v1/solicitudes/${detail.id}`, token);
          if (gen === generation.current) updateDetail(current);
        } catch (refreshError) {
          if (gen === generation.current) handleError(refreshError);
        }
      }
    } finally {
      if (gen === generation.current) setActionBusy(false);
    }
  }
  async function retry() {
    if (!detail || !token) return;
    const gen = generation.current;
    setActionBusy(true);
    setError('');
    try {
      const result = await api<ApplicationView>(
        `/v1/admin/solicitudes/${detail.id}/reintentar`,
        token,
        { method: 'POST' },
      );
      if (gen === generation.current) {
        updateDetail(result);
        setNotice('Trabajos reactivados.');
      }
    } catch (e) {
      if (gen === generation.current) handleError(e);
    } finally {
      if (gen === generation.current) setActionBusy(false);
    }
  }
  const feedback = (
    <>
      {error && (
        <div role="alert" className="message error">
          {error}
          <button type="button" aria-label="Cerrar error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="message">
          {notice}
        </div>
      )}
    </>
  );
  if (!session)
    return (
      <main className="login">
        <section className="login-story">
          <div className="wordmark">
            <span className="logo">F</span> FÁBRICA DE CRÉDITO
          </div>
          <div>
            <p className="eyebrow">UN REGISTRO. MÁS POSIBILIDADES.</p>
            <h1>
              El próximo viaje
              <br />
              empieza aquí.
            </h1>
            <p>
              Un solo canal para solicitar, seguir y comparar
              <br />
              el financiamiento de un vehículo.
            </p>
          </div>
          <small>Proyecto académico · Datos y financieras simulados</small>
        </section>
        <section className="login-panel">
          <div className="login-box">
            <span className="sandbox">SANDBOX ACADÉMICO</span>
            <h2>Bienvenido de nuevo</h2>
            <p className="muted">Ingrese con su cuenta de demostración.</p>
            {feedback}
            <form onSubmit={login}>
              <label>
                Correo electrónico
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  defaultValue="asesor@demo.test"
                  required
                />
              </label>
              <label>
                Contraseña
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  required
                />
              </label>
              <button className="primary full" disabled={loginBusy}>
                {loginBusy ? 'Ingresando…' : 'Ingresar al espacio de trabajo →'}
              </button>
            </form>
            <p className="helper">
              Credenciales generadas en la configuración local. Use exclusivamente información
              ficticia.
            </p>
          </div>
        </section>
      </main>
    );
  const canWrite = session.user.role !== 'supervisor';
  const closed = detail && ['ACEPTADA', 'DESISTIDA'].includes(detail.state);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="wordmark">
          <span className="logo">F</span>
          <span>
            FÁBRICA
            <br />
            DE CRÉDITO
          </span>
        </div>
        <p className="nav-caption">ESPACIO DE TRABAJO</p>
        <nav aria-label="Principal">
          <button
            className={screen !== 'new' ? 'active' : ''}
            onClick={() => {
              navigate('list');
              setError('');
              setNotice('');
            }}
          >
            ▦ <span>Solicitudes</span>
            <span className="nav-count">{page.total}</span>
          </button>
          {canWrite && (
            <button
              className={screen === 'new' ? 'active' : ''}
              onClick={() => {
                navigate('new');
                setError('');
                setNotice('');
              }}
            >
              ＋ <span>Nueva solicitud</span>
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> Entorno de demostración
          <p>Las ofertas son ficticias y no representan decisiones bancarias reales.</p>
        </div>
        <div className="profile">
          <span className="avatar">{session.user.name[0].toUpperCase()}</span>
          <div>
            <strong>{session.user.name}</strong>
            <small>{session.user.agency}</small>
          </div>
          <button onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
            ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Originación vehicular <span className="slash">/</span>{' '}
            {screen === 'new' ? 'Nueva solicitud' : screen === 'detail' ? 'Detalle' : 'Solicitudes'}
          </span>
          <span className="sandbox">SANDBOX</span>
        </header>
        <main className="content">
          {feedback}
          {screen === 'list' && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">TU OPERACIÓN, EN UN SOLO LUGAR</p>
                  <h1>Solicitudes de crédito</h1>
                  <p className="muted">
                    Acompaña cada solicitud desde el registro hasta la mejor oferta.
                  </p>
                </div>
                {canWrite && (
                  <button
                    className="primary"
                    onClick={() => {
                      navigate('new');
                      setNotice('');
                    }}
                  >
                    ＋ Nueva solicitud
                  </button>
                )}
              </div>
              <section className="stats" aria-label="Resumen de la página">
                <Stat
                  label="Solicitudes registradas"
                  value={page.total}
                  caption="Total con los filtros actuales"
                />
                <Stat
                  label="Con ofertas disponibles"
                  value={page.items.filter((i) => i.state === 'OFERTAS').length}
                  caption="En esta página"
                />
                <Stat
                  label="Ofertas aceptadas"
                  value={page.items.filter((i) => i.state === 'ACEPTADA').length}
                  caption="En esta página"
                />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Seguimiento de solicitudes</h2>
                  <span className="muted">{page.total} registros</span>
                </div>
                <div className="filters">
                  <label>
                    Estado
                    <select
                      value={filters.state}
                      onChange={(e) => setFilters({ ...filters, state: e.target.value, page: 1 })}
                    >
                      <option value="">Todos los estados</option>
                      {['ENVIADA', 'OFERTAS', 'SIN_OFERTAS', 'ACEPTADA', 'DESISTIDA'].map((s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Financiera
                    <select
                      value={filters.bank}
                      onChange={(e) => setFilters({ ...filters, bank: e.target.value, page: 1 })}
                    >
                      <option value="">Todas las financieras</option>
                      <option value="pichincha">Banco Pichincha</option>
                      <option value="pacifico">Banco del Pacífico</option>
                    </select>
                  </label>
                  <label>
                    Orden
                    <select
                      value={filters.sort}
                      onChange={(e) => setFilters({ ...filters, sort: e.target.value, page: 1 })}
                    >
                      <option value="desc">Más recientes primero</option>
                      <option value="asc">Más antiguas primero</option>
                    </select>
                  </label>
                  <button
                    className="quiet filter-clear"
                    onClick={() => setFilters({ page: 1, state: '', bank: '', sort: 'desc' })}
                  >
                    Limpiar filtros
                  </button>
                </div>
                {loading ? (
                  <p className="empty" role="status">
                    Cargando solicitudes…
                  </p>
                ) : page.items.length === 0 ? (
                  <div className="empty">
                    <span className="empty-icon">↗</span>
                    <h3>Todo empieza con una solicitud</h3>
                    <p>Registra un cliente ficticio para explorar el proceso de crédito.</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Cliente / solicitud</th>
                          <th>Vehículo</th>
                          <th>Monto a financiar</th>
                          <th>Estado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.client.name}</strong>
                              <small>
                                {item.id.slice(0, 8).toUpperCase()} ·{' '}
                                {new Date(item.createdAt).toLocaleDateString('es-EC')}
                              </small>
                            </td>
                            <td>
                              {item.vehicle.brand} {item.vehicle.model}
                              <small>{item.vehicle.year}</small>
                            </td>
                            <td>
                              {money(item.vehicle.priceCents - item.financing.downPaymentCents)}
                            </td>
                            <td>
                              <Badge state={item.state} />
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => open(item)}
                                aria-label={`Ver solicitud de ${item.client.name}`}
                              >
                                Ver solicitud →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="pagination">
                  <span>Página {filters.page} · Hasta 10 registros</span>
                  <div>
                    <button
                      className="quiet"
                      disabled={filters.page <= 1}
                      onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                    >
                      ← Anterior
                    </button>
                    <button
                      className="quiet"
                      disabled={filters.page * 10 >= page.total}
                      onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                    >
                      Siguiente →
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
          {screen === 'new' && (
            <>
              <button className="text-button back" onClick={() => navigate('list')}>
                ← Volver a solicitudes
              </button>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">REGISTRO ÚNICO</p>
                  <h1>Nueva solicitud</h1>
                  <p className="muted">
                    Completa los datos ficticios y elige las financieras a consultar.
                  </p>
                </div>
                <span className="step-note">01 Registro → 02 Evaluación → 03 Oferta</span>
              </div>
              <form onSubmit={create} className="application-form">
                <FormSection
                  number="01"
                  title="Datos del cliente"
                  description="Identificadores DEMO; no ingrese cédulas reales."
                >
                  <Field
                    label="Nombre completo"
                    name="name"
                    defaultValue="Cliente Ficticio Uno"
                    minLength={3}
                  />
                  <Field
                    label="Correo electrónico"
                    name="email"
                    type="email"
                    defaultValue="cliente@example.test"
                  />
                  <Field
                    label="Identificación ficticia"
                    name="identification"
                    defaultValue="DEMO-000001"
                    pattern="DEMO-[0-9]{6}"
                  />
                  <Field
                    label="Ingreso mensual (USD)"
                    name="income"
                    type="number"
                    defaultValue="2500"
                    min="100"
                    step="0.01"
                  />
                </FormSection>
                <FormSection
                  number="02"
                  title="Vehículo y financiamiento"
                  description="Entrada mínima del 20 % del precio. Importes en dólares."
                >
                  <Field label="Marca" name="brand" defaultValue="Marca Demo" />
                  <Field label="Modelo" name="model" defaultValue="Modelo Uno" />
                  <Field
                    label="Año"
                    name="year"
                    type="number"
                    defaultValue="2026"
                    min="2000"
                    max="2030"
                  />
                  <Field
                    label="Precio (USD)"
                    name="price"
                    type="number"
                    defaultValue="30000"
                    min="1000"
                    max="200000"
                    step="0.01"
                  />
                  <Field
                    label="Entrada (USD)"
                    name="downPayment"
                    type="number"
                    defaultValue="9000"
                    min="0"
                    step="0.01"
                  />
                  <label>
                    Plazo
                    <select name="term" defaultValue="48">
                      {[12, 24, 36, 48, 60, 72].map((n) => (
                        <option key={n} value={n}>
                          {n} meses
                        </option>
                      ))}
                    </select>
                  </label>
                </FormSection>
                <section className="panel form-section">
                  <div className="section-title">
                    <span>03</span>
                    <div>
                      <h2>Financieras y consentimiento</h2>
                      <p>Las dos integraciones son simulaciones académicas independientes.</p>
                    </div>
                  </div>
                  <div className="bank-choices">
                    {(['pichincha', 'pacifico'] as Bank[]).map((b) => (
                      <label className="bank-choice" key={b}>
                        <input type="checkbox" name="banks" value={b} defaultChecked />
                        <span>
                          <strong>{bankName(b)}</strong>
                          <small>Financiera simulada</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="scenario-label">
                    Escenario de demostración
                    <select name="scenario" defaultValue="aprobada">
                      {Object.entries(scenarioLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="consent">
                    <input type="checkbox" name="consent" required />
                    <span>
                      Registro el consentimiento ficticio para tratamiento de datos y consulta de
                      crédito en esta demostración.
                    </span>
                  </label>
                </section>
                <div className="form-footer">
                  <span>Los envíos se procesan en segundo plano.</span>
                  <button className="primary" disabled={actionBusy}>
                    {actionBusy ? 'Registrando…' : 'Registrar y enviar solicitud →'}
                  </button>
                </div>
              </form>
            </>
          )}
          {screen === 'detail' && detail && (
            <>
              <button
                className="text-button back"
                onClick={() => {
                  navigate('list');
                  setNotice('');
                }}
              >
                ← Volver a solicitudes
              </button>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">SOLICITUD {detail.id.slice(0, 8).toUpperCase()}</p>
                  <h1>{detail.client.name}</h1>
                  <p className="muted">
                    {detail.vehicle.brand} {detail.vehicle.model} · {detail.vehicle.year}{' '}
                    <span className="slash">/</span> {detail.agency}
                  </p>
                </div>
                <Badge state={detail.state} />
              </div>
              <section className="summary-strip">
                <div>
                  <small>Monto a financiar</small>
                  <strong>
                    {money(detail.vehicle.priceCents - detail.financing.downPaymentCents)}
                  </strong>
                </div>
                <div>
                  <small>Entrada</small>
                  <strong>{money(detail.financing.downPaymentCents)}</strong>
                </div>
                <div>
                  <small>Plazo</small>
                  <strong>{detail.financing.termMonths} meses</strong>
                </div>
                <div>
                  <small>Escenario ficticio</small>
                  <strong>{scenarioLabels[detail.scenario]}</strong>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Respuestas y ofertas</h2>
                    <p className="muted">
                      Actualización automática cada 1,5 segundos. Cuota y seguro se muestran por
                      separado.
                    </p>
                  </div>
                  <span className="live">
                    <span className="status-dot" /> Seguimiento activo
                  </span>
                </div>
                <div className="offers">
                  {detail.banks.map((bank) => {
                    const s = detail.submissions[bank];
                    const offer = s?.offer;
                    return (
                      <article
                        className={`offer-card ${offer && detail.acceptedOfferId === offer.id ? 'chosen' : ''}`}
                        key={bank}
                      >
                        <div className="offer-header">
                          <span className="bank-symbol">{bank === 'pichincha' ? 'P' : '≋'}</span>
                          <h3>
                            {bankName(bank)}
                            <small>Oferta académica ficticia</small>
                          </h3>
                        </div>
                        <Badge state={s?.state ?? 'PENDIENTE'} />
                        {offer ? (
                          <>
                            <p className="installment">
                              {money(offer.installmentCents)}
                              <small>/ mes, sin seguro</small>
                            </p>
                            <dl>
                              <div>
                                <dt>Tasa anual</dt>
                                <dd>{offer.annualRate.toFixed(2)} %</dd>
                              </div>
                              <div>
                                <dt>Plazo</dt>
                                <dd>{offer.termMonths} meses</dd>
                              </div>
                              <div>
                                <dt>Entrada</dt>
                                <dd>{money(offer.downPaymentCents)}</dd>
                              </div>
                              <div>
                                <dt>Seguro mensual</dt>
                                <dd>{money(offer.insuranceCents)}</dd>
                              </div>
                              <div>
                                <dt>Total mensual estimado</dt>
                                <dd>{money(offer.installmentCents + offer.insuranceCents)}</dd>
                              </div>
                            </dl>
                            <p className="helper">
                              {offer.conditions.join(' · ') ||
                                'Sin condiciones adicionales en esta simulación.'}
                            </p>
                            {canWrite && (
                              <button
                                className={
                                  detail.acceptedOfferId === offer.id
                                    ? 'quiet full'
                                    : 'primary full'
                                }
                                disabled={Boolean(closed) || actionBusy}
                                onClick={() => act(offer)}
                              >
                                {detail.acceptedOfferId === offer.id
                                  ? '✓ Oferta seleccionada'
                                  : 'Aceptar esta oferta'}
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="offer-wait">
                            <p>
                              {s?.state === 'ERROR'
                                ? 'Se agotaron los reintentos de integración. Un administrador puede reactivar el trabajo.'
                                : s?.state === 'RECHAZADA'
                                  ? 'La financiera simulada no presenta una oferta.'
                                  : s?.state === 'INFORMACION'
                                    ? 'Se requiere información adicional. Su envío complementario queda fuera de este MVP.'
                                    : 'La financiera está procesando la solicitud.'}
                            </p>
                          </div>
                        )}
                        <small className="job-note">
                          Comunicación con la financiera:{' '}
                          {s?.jobState === 'dead'
                            ? 'requiere revisión'
                            : s?.jobState === 'done'
                              ? 'completada'
                              : 'en proceso'}
                        </small>
                      </article>
                    );
                  })}
                </div>
              </section>
              <section className="panel timeline">
                <div className="panel-heading">
                  <h2>Historial de la solicitud</h2>
                  <span className="muted">{detail.audit.length} eventos</span>
                </div>
                <ol>
                  {[...detail.audit].reverse().map((event, i) => (
                    <li key={`${event.at}-${i}`}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>{eventLabel(event.action)}</strong>
                        <small>
                          {eventActor(event.actor)} · {new Date(event.at).toLocaleString('es-EC')}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              {canWrite && !closed && (
                <div className="detail-actions">
                  <span className="muted">
                    Si el cliente decide no continuar, registra el desistimiento.
                  </span>
                  <button className="quiet" disabled={actionBusy} onClick={() => act()}>
                    Desistir solicitud
                  </button>
                </div>
              )}
              {session.user.role === 'administrador' &&
                Object.values(detail.submissions).some((s) => s.jobState === 'dead') && (
                  <button className="quiet" disabled={actionBusy} onClick={retry}>
                    Reactivar trabajos agotados
                  </button>
                )}
            </>
          )}
        </main>
        <footer className="page-footer">
          Fábrica de Crédito · Proyecto de Diseño de APIs <span>Solo datos ficticios · USD</span>
        </footer>
      </div>
    </div>
  );
}
function Stat({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <article className="stat">
      <p>{label}</p>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{caption}</small>
    </article>
  );
}
function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel form-section">
      <div className="section-title">
        <span>{number}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="form-grid">{children}</div>
    </section>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      {label}
      <input required maxLength={100} {...props} />
    </label>
  );
}
