import Fastify, { type FastifyRequest, type FastifyReply, type RouteHandlerMethod } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import {
  banks,
  view,
  type Actor,
  type ApplicationInput,
  type BankResult,
} from '../../shared/domain.js';
import { verifyWebhook } from '../../shared/security.js';
import { Store } from './store.js';
import { CreditService } from './service.js';
import { Problem } from './errors.js';
import { hashPassword, checkPassword } from './auth.js';
import { contractPath, routeSchema } from './contract.js';
import type { Config } from './config.js';
declare module 'fastify' {
  interface FastifyRequest {
    rawBody: string;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Actor;
    user: Actor;
  }
}
export async function createApp(config: Config, store: Store) {
  const app = Fastify({
    logger: config.log
      ? {
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-signature'],
          level: 'info',
        }
      : false,
    bodyLimit: 65536,
    ajv: { customOptions: { removeAdditional: false } },
    genReqId: (req) => {
      const id = req.headers['x-correlation-id'];
      return typeof id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : randomUUID();
    },
  });
  const service = new CreditService(store);
  const counters = { requests: 0, failures: 0 };
  const started = Date.now();
  await app.register(cors, {
    origin: config.origins,
    exposedHeaders: ['ETag', 'Location', 'X-Correlation-ID'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'If-Match',
      'If-None-Match',
      'X-Correlation-ID',
    ],
  });
  await app.register(helmet, { contentSecurityPolicy: false }); // Swagger UI requires its own assets; frontend has a separate CSP.
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '1h', iss: 'credito-api', aud: 'credito-web' },
    verify: { algorithms: ['HS256'], allowedIss: 'credito-api', allowedAud: 'credito-web' },
  });
  app.decorateRequest('rawBody', '');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = String(body);
    try {
      done(null, JSON.parse(req.rawBody));
    } catch {
      done(new Problem(400, 'JSON inválido'));
    }
  });
  app.addHook('onRequest', async (req, reply) => {
    counters.requests++;
    reply.header('X-Correlation-ID', req.id);
    const path = req.url.split('?')[0];
    if (
      req.method === 'OPTIONS' ||
      path === '/health/live' ||
      path === '/health/ready' ||
      path === '/v1/auth/login' ||
      path === '/openapi.json' ||
      path.startsWith('/docs') ||
      path.startsWith('/v1/webhooks/')
    )
      return;
    try {
      await req.jwtVerify();
    } catch {
      throw new Problem(401, 'Sesión inválida o vencida');
    }
  });
  await app.register(rateLimit, {
    max: config.rateLimit,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => req.user?.sub ?? req.ip,
  });
  app.setErrorHandler((unknownError, req, reply) => {
    const error = unknownError as {
      statusCode?: number;
      name: string;
      code?: string;
      validation?: unknown;
      message: string;
    };
    const status = error.statusCode ?? 500;
    if (status >= 500)
      req.log.error(
        { err: { name: error.name, code: error.code }, requestId: req.id },
        'Request failed',
      );
    reply
      .code(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: status >= 500 ? 'Servicio no disponible' : 'Solicitud no procesada',
        status,
        detail:
          status >= 500
            ? 'Intente nuevamente más tarde'
            : error.validation
              ? 'Revise los campos, formatos y encabezados requeridos'
              : status === 429
                ? 'Demasiadas solicitudes; espere antes de reintentar'
                : error.message,
        instance: req.url.split('?')[0],
        correlationId: req.id,
      });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: 'No encontrado',
        status: 404,
        detail: 'Ruta no disponible',
        instance: req.url.split('?')[0],
        correlationId: req.id,
      }),
  );
  app.addHook('onResponse', async (_req, reply) => {
    if (reply.statusCode >= 400) counters.failures++;
  });
  await app.register(swagger, {
    mode: 'static',
    specification: { path: contractPath, baseDir: dirname(contractPath) },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', async (_req, reply) =>
    reply.type('application/json').send(await app.swagger()),
  );
  const route = (
    method: 'GET' | 'POST',
    path: string,
    handler: RouteHandlerMethod,
    login = false,
  ) =>
    app.route({
      method,
      url: path.replace(/\{([^}]+)\}/g, ':$1'),
      schema: routeSchema(path, method),
      ...(login ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } } : {}),
      handler,
    });
  const actor = (req: FastifyRequest) => req.user;
  const params = (req: FastifyRequest) =>
    req.params as { id: string; offerId?: string; bank?: string };
  const key = (req: FastifyRequest) => req.headers['idempotency-key'] as string;
  const send = (reply: FastifyReply, item: Parameters<typeof view>[0]) =>
    reply.header('ETag', `"${item.version}"`).send(view(item));
  const admin = (req: FastifyRequest) => {
    if (req.user.role !== 'administrador') throw new Problem(403, 'Solo administrador');
  };
  const dummyHash = hashPassword(randomUUID());
  route('GET', '/health/live', async () => ({ status: 'ok' }));
  route('GET', '/health/ready', async () => {
    try {
      await store.client.db().command({ ping: 1 });
      return { status: 'ok' };
    } catch {
      throw new Problem(503, 'Base de datos no disponible');
    }
  });
  route(
    'POST',
    '/v1/auth/login',
    async (req) => {
      const { email, password } = req.body as { email: string; password: string };
      const u = await store.users.findOne({ email: email.toLowerCase() });
      const valid = checkPassword(password, u?.passwordHash ?? dummyHash);
      if (!u || !valid) throw new Problem(401, 'Correo o contraseña incorrectos');
      const user: Actor = { sub: u.sub, role: u.role, agency: u.agency, name: u.name };
      return { token: await app.jwt.sign(user), user, expiresIn: 3600 };
    },
    true,
  );
  route('GET', '/v1/auth/me', async (req) => actor(req));
  route('GET', '/v1/financieras', async () =>
    banks.map((id) => ({
      id,
      name: id === 'pichincha' ? 'Banco Pichincha' : 'Banco del Pacífico',
      protocol: id === 'pichincha' ? 'JSON + webhook HMAC' : 'XML + polling',
      academic: true,
    })),
  );
  route('POST', '/v1/solicitudes', async (req, reply) => {
    if (actor(req).role === 'supervisor')
      throw new Problem(403, 'El supervisor tiene acceso de consulta');
    const { item, replayed } = await service.create(
      req.body as ApplicationInput,
      actor(req),
      key(req),
      req.id,
    );
    reply
      .code(202)
      .header('Location', `/v1/solicitudes/${item._id}`)
      .header('Idempotency-Replayed', String(replayed));
    return send(reply, item);
  });
  route('GET', '/v1/solicitudes', async (req) => {
    const q = req.query as {
      page?: number;
      size?: number;
      state?: string;
      bank?: string;
      sort?: 'asc' | 'desc';
    };
    const page = await service.list(actor(req), q.page ?? 1, q.size ?? 20, q.state, q.bank, q.sort);
    return { ...page, items: page.items.map(view) };
  });
  route('GET', '/v1/solicitudes/{id}', async (req, reply) => {
    const item = await service.get(params(req).id, actor(req));
    if (req.headers['if-none-match'] === `"${item.version}"`)
      return reply.header('ETag', `"${item.version}"`).code(304).send();
    return send(reply, item);
  });
  route(
    'GET',
    '/v1/solicitudes/{id}/respuestas',
    async (req) => view(await service.get(params(req).id, actor(req))).submissions,
  );
  route('GET', '/v1/solicitudes/{id}/ofertas', async (req) =>
    Object.values((await service.get(params(req).id, actor(req))).submissions).flatMap((s) =>
      s.offer ? [s.offer] : [],
    ),
  );
  route(
    'GET',
    '/v1/solicitudes/{id}/eventos',
    async (req) => (await service.get(params(req).id, actor(req))).audit,
  );
  for (const [path, accept] of [
    ['/v1/solicitudes/{id}/ofertas/{offerId}/aceptar', true],
    ['/v1/solicitudes/{id}/desistir', false],
  ] as const)
    route('POST', path, async (req, reply) =>
      send(
        reply,
        await service.action(
          params(req).id,
          actor(req),
          key(req),
          Number(String(req.headers['if-match']).replaceAll('"', '')),
          accept ? params(req).offerId : undefined,
          req.id,
        ),
      ),
    );
  route('POST', '/v1/webhooks/financieras/{bank}', async (req) => {
    if (
      !verifyWebhook(
        config.webhookSecret,
        String(req.headers['x-timestamp']),
        req.rawBody,
        String(req.headers['x-signature']),
      )
    )
      throw new Problem(401, 'Firma o fecha inválida');
    const result = req.body as BankResult;
    if (
      result.bank !== params(req).bank ||
      (result.offer && (result.offer.bank !== result.bank || result.offer.termMonths % 12 !== 0))
    )
      throw new Problem(422, 'Respuesta inconsistente');
    const positive = ['APROBADA', 'CONDICIONES'].includes(result.decision);
    if (positive !== Boolean(result.offer))
      throw new Problem(422, 'Oferta incompatible con decisión');
    return { accepted: await service.result(result, req.id) };
  });
  route('POST', '/v1/admin/solicitudes/{id}/reintentar', async (req, reply) => {
    admin(req);
    return send(reply, await service.retry(params(req).id, actor(req), req.id));
  });
  route('GET', '/v1/admin/metrics', async (req) => {
    admin(req);
    const [queuePending, queueDead] = await Promise.all(
      ['pending', 'dead'].map((state) =>
        store.applications.countDocuments({
          $or: banks.map((b) => ({ [`submissions.${b}.job.state`]: state })),
        }),
      ),
    );
    const cpu = process.cpuUsage();
    return {
      ...counters,
      uptimeSeconds: (Date.now() - started) / 1000,
      memoryRssBytes: process.memoryUsage().rss,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      queuePending,
      queueDead,
    };
  });
  return app;
}
