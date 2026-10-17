# Contrato y uso de la API · RA3

La fuente pública es [shared/openapi.json](../shared/openapi.json), OpenAPI 3.0.3 autocontenido. [shared/example.json](../shared/example.json) contiene un registro ficticio válido. Fastify usa schemas del contrato para entrada/salida y sirve Swagger UI en `/docs` y el documento en `/openapi.json`. El comando `npm run contract` valida estructura y ejemplo; las pruebas HTTP ejecutadas acreditan coherencia local; consulte [EVIDENCIAS](pruebas/EVIDENCIAS.md). El contrato independiente de las financieras es [mocks-openapi.json](../shared/mocks-openapi.json).

## Operaciones

| Método | Ruta                                             | Propósito / resultado principal                 |
| ------ | ------------------------------------------------ | ----------------------------------------------- |
| GET    | `/health/live`, `/health/ready`                  | Vida del proceso / conexión Mongo               |
| POST   | `/v1/auth/login`                                 | Email/password ficticios → JWT de una hora      |
| GET    | `/v1/auth/me`                                    | Identidad, rol y agencia autenticados           |
| GET    | `/v1/financieras`                                | Dos financieras académicas y protocolos         |
| POST   | `/v1/solicitudes`                                | Validar, crear y encolar; 202 + Location/ETag   |
| GET    | `/v1/solicitudes`                                | page/size, state, bank y sort asc/desc          |
| GET    | `/v1/solicitudes/{id}`                           | Detalle, versión/ETag; condicional 304          |
| GET    | `/v1/solicitudes/{id}/respuestas`                | Estado y trabajo por financiera                 |
| GET    | `/v1/solicitudes/{id}/ofertas`                   | Ofertas canónicas ficticias                     |
| GET    | `/v1/solicitudes/{id}/eventos`                   | Historial de eventos                            |
| POST   | `/v1/solicitudes/{id}/ofertas/{offerId}/aceptar` | Cerrar con oferta y notificaciones persistentes |
| POST   | `/v1/solicitudes/{id}/desistir`                  | Cerrar y notificar desistimiento                |
| POST   | `/v1/webhooks/financieras/{bank}`                | Resultado firmado, deduplicado                  |
| POST   | `/v1/admin/solicitudes/{id}/reintentar`          | Administrador reactiva DLQ                      |
| GET    | `/v1/admin/metrics`                              | Métricas técnicas de proceso y cola             |

La lista es una guía; tipos, límites, ejemplos y códigos exactos están en OpenAPI. Los contadores queuePending/queueDead cuentan solicitudes con algún trabajo en ese estado, no cantidad total de trabajos.

## Secuencia reproducible

1. Haga login desde Swagger o UI con un usuario seed y la contraseña local de `.env`. JWT propio HS256 no es OAuth/OIDC. En Swagger use `Authorize` con el token.
2. Envíe `shared/example.json` a POST solicitudes con `Idempotency-Key` nueva. El token determina agencia/propietario; no se confía en valores de agencia del body.
3. Guarde `Location`, id y ETag. 202 confirma persistencia y encolado, no aprobación bancaria.
4. Consulte detalle u ofertas hasta obtener respuesta. Pichincha notifica webhook y existe polling de respaldo; Pacífico se consulta por XML.
5. Para aceptar/desistir, envíe `If-Match` con la versión entre comillas y una nueva clave idempotente. Un 412 exige refrescar la vista; un 409 puede indicar cierre previo o reutilización conflictiva.
6. Repita un POST sensible con su misma clave y contenido para demostrar replay sin duplicar efectos, y con contenido diferente para mostrar 409. Crear devuelve el mismo recurso con su estado actual, que puede haber avanzado por el worker; no conserva una copia inmutable de la respuesta inicial. El fingerprint canónico admite distinto orden de propiedades JSON.

Encabezados relevantes: `Authorization: Bearer …`, `Content-Type: application/json` solo si se envía cuerpo JSON, `Idempotency-Key`, `If-Match`, `If-None-Match` y `X-Correlation-ID`. Las claves deben respetar límites del contrato. Para modificar contenido, use otra clave; no se implementa edición de solicitudes.

## Errores y seguridad

Los errores API son `application/problem+json` con type/title/status/detail/instance/correlationId. Casos centrales: 400 entrada inválida, 401 sesión/firma, 403 rol, 404 inexistente o fuera de agencia, 409 conflicto, 412 versión obsoleta, 422 regla de negocio, 429 límite y 503 indisponibilidad. JWT restringe algoritmo, issuer, audience y expiración. CORS admite únicamente orígenes configurados.

Webhooks usan timestamp y firma HMAC-SHA256 del cuerpo bruto con ventana temporal; `eventId` deduplica aplicación. Las rutas mock requieren `x-mock-key` y callback permitido. No use claves bancarias ni envíe datos personales reales. HTTPS/cifrado en reposo del ambiente remoto siguen pendientes.

## Versionado y evolución

Cambios compatibles viven en `/v1`; cambios incompatibles necesitarían `/v2` y plan explícito de migración. No hay versión retirada ni cabeceras Sunset implementadas. Agregar enum de banco exige mantener consumidores y contratos consistentes; no se promete incorporación sin código. Endpoints de documentos, complementos, aprobaciones, notificaciones email, reportes avanzados y CRM no existen; constan en [REQUIREMENTS](REQUIREMENTS.md).
