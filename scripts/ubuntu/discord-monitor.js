import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const services = ['fabrica-api.service', 'fabrica-worker.service', 'fabrica-mocks.service'];
const properties = ['LoadState', 'ActiveState', 'SubState', 'Result', 'NRestarts', 'InvocationID'];
const emptyState = () => ({ version: 1, snapshots: {}, pending: [], dropped: 0, nextAttemptAt: 0 });

export function webhookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Webhook Discord inválido; no se muestra su valor.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'discord.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/api(?:\/v\d+)?\/webhooks\/\d{16,22}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => key !== 'wait')
  ) {
    throw new Error('Se requiere un webhook HTTPS del dominio oficial discord.com.');
  }
  url.searchParams.set('wait', 'true');
  return url;
}

export function parseSnapshot(text) {
  const data = Object.fromEntries(
    text.split(/\r?\n/).map((line) => {
      const at = line.indexOf('=');
      return at < 0 ? ['', ''] : [line.slice(0, at), line.slice(at + 1)];
    }),
  );
  const safe = (value) => (/^[a-z-]{1,40}$/.test(value ?? '') ? value : 'unknown');
  const restarts = Number(data.NRestarts ?? 0);
  return {
    load: safe(data.LoadState),
    active: safe(data.ActiveState),
    sub: safe(data.SubState),
    result: safe(data.Result),
    restarts: Number.isSafeInteger(restarts) && restarts >= 0 ? restarts : 0,
    invocation: /^[a-f0-9]{32}$/.test(data.InvocationID ?? '') ? data.InvocationID : '',
  };
}

export function collectSnapshots(exec = execFileSync) {
  return Object.fromEntries(
    services.map((unit) => {
      let output;
      try {
        output = exec(
          'systemctl',
          ['show', unit, `--property=${properties.join(',')}`, '--no-pager'],
          {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        );
      } catch (error) {
        if (!String(error.stdout ?? '').includes('LoadState=not-found')) {
          throw new Error('No fue posible consultar systemd; revisa el monitor local.');
        }
        output = String(error.stdout);
      }
      return [unit, parseSnapshot(output)];
    }),
  );
}

const healthy = (snapshot) =>
  snapshot?.load === 'loaded' && snapshot.active === 'active' && snapshot.sub === 'running';

export function transition(previous, snapshots, now = Date.now()) {
  const next = { ...previous, snapshots, pending: [...previous.pending] };
  for (const unit of services) {
    const before = previous.snapshots[unit];
    const current = snapshots[unit];
    let kind;
    if (!healthy(current) && (!before || healthy(before))) kind = 'down';
    else if (before && !healthy(before) && healthy(current)) kind = 'recovered';
    else if (
      healthy(before) &&
      healthy(current) &&
      (current.restarts > before.restarts ||
        (before.invocation && current.invocation && before.invocation !== current.invocation))
    )
      kind = 'restarted';
    if (kind)
      next.pending.push({
        id: randomUUID(),
        unit,
        kind,
        at: new Date(now).toISOString(),
        snapshot: current,
      });
  }
  if (next.pending.length > 100) {
    next.dropped += next.pending.length - 100;
    next.pending = next.pending.slice(-100);
  }
  return next;
}

export function notification(events, dropped = 0) {
  const labels = {
    down: 'SERVICIO DETENIDO',
    recovered: 'SERVICIO RECUPERADO',
    restarted: 'REINICIO DETECTADO',
    test: 'PRUEBA DE ALERTAS',
  };
  const lines = events.map((event) => {
    if (!labels[event.kind] || (event.kind !== 'test' && !services.includes(event.unit))) {
      throw new Error('Estado de alertas inválido.');
    }
    const status =
      event.kind === 'test'
        ? 'No se detuvo ningún servicio.'
        : `${event.snapshot.active}/${event.snapshot.sub}; resultado ${event.snapshot.result}`;
    return `**${labels[event.kind]}** · ${event.unit}\n${event.at} · ${status}\nEvento ${event.id}`;
  });
  const content = [
    'Fábrica de Crédito · AWS',
    ...lines,
    ...(dropped
      ? [`Se omitieron ${dropped} eventos antiguos al alcanzar el límite local de 100.`]
      : []),
  ].join('\n\n');
  if (content.length > 2000) throw new Error('El lote de alertas excede el tamaño permitido.');
  return { content, allowed_mentions: { parse: [] } };
}

export async function deliver(url, payload, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { delivered: false, retryMs: 30000, reason: 'Discord sin respuesta; lote conservado.' };
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const seconds = Number(response.headers.get('retry-after') ?? body.retry_after);
    return {
      delivered: false,
      retryMs: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60000,
      reason: 'Discord limitó las peticiones; se respeta Retry-After.',
    };
  }
  if (response.status === 200) {
    const body = await response.json().catch(() => ({}));
    if (typeof body.id === 'string' && /^\d+$/.test(body.id)) return { delivered: true };
  }
  return {
    delivered: false,
    retryMs: [401, 403, 404].includes(response.status) ? 900000 : 30000,
    reason: `Discord no confirmó la entrega (HTTP ${response.status}); lote conservado.`,
  };
}

export function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.version !== 1 ||
      !state.snapshots ||
      !Array.isArray(state.pending) ||
      !Number.isSafeInteger(state.dropped) ||
      state.dropped < 0 ||
      !Number.isFinite(state.nextAttemptAt)
    ) {
      throw new Error('invalid');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw new Error('No se pudo leer el estado del monitor; no se descarta automáticamente.');
  }
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

export async function runMonitor({
  statePath,
  url,
  snapshots,
  now = Date.now(),
  retryClock = Date.now,
  fetchFn = fetch,
  log = console.error,
}) {
  const previous = readState(statePath);
  const state = transition(previous, snapshots, now);
  // Persist the events BEFORE sending. A timeout is retried on a later poll, never in a tight loop.
  if (JSON.stringify(state) !== JSON.stringify(previous)) saveState(statePath, state);
  if (!state.pending.length || state.nextAttemptAt > now) return state;
  const batch = state.pending.slice(0, 5);
  const result = await deliver(url, notification(batch, state.dropped), fetchFn);
  if (result.delivered) {
    state.pending = state.pending.slice(batch.length);
    state.dropped = 0;
    state.nextAttemptAt = 0;
    console.log(`Discord confirmó ${batch.length} evento(s).`);
  } else {
    state.nextAttemptAt = retryClock() + result.retryMs;
    log(result.reason);
  }
  saveState(statePath, state);
  return state;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'validate-stdin') {
    webhookUrl(readFileSync(0, 'utf8').trim());
    return;
  }
  const url = webhookUrl(process.env.DISCORD_WEBHOOK_URL);
  if (mode === 'test') {
    const result = await deliver(
      url,
      notification([
        { id: randomUUID(), unit: 'monitor', kind: 'test', at: new Date().toISOString() },
      ]),
    );
    if (!result.delivered) throw new Error(result.reason);
    console.log('Prueba de Discord confirmada; no se detuvo ningún servicio.');
  } else if (mode === 'monitor') {
    await runMonitor({
      url,
      snapshots: collectSnapshots(),
      statePath: join(process.env.STATE_DIRECTORY ?? '/var/lib/fabrica-discord', 'state.json'),
    });
  } else throw new Error('Modo inválido: monitor o test.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Every error above is deliberately sanitized: never print a fetch error, response body or URL.
    console.error(error.message);
    process.exitCode = 1;
  });
}
