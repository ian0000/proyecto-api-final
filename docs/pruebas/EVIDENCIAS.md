# Evidencias de la preparación local

Fecha de trabajo: 16 de octubre de 2026 (America/Guayaquil). Este registro corresponde exclusivamente a este repositorio y a datos ficticios.

## Evidencia ejecutada

- Fuentes: seis archivos copiados; igualdad de bytes comprobada por SHA-256 en [manifest.json](../fuentes/manifest.json). También se leyeron los tres diagramas incrustados en los Word.
- Contratos: OpenAPI 3.0.3 principal (15 rutas) y simuladores (7 rutas), autocontenidos, validados con Swagger Parser. Ejemplos y respuestas comprobados por esquemas en pruebas.
- Integración backend: casos de Mongo real local, autenticación, autorización por agencia, idempotencia, JSON/webhook, XML/polling, aceptación, notificaciones, DLQ, leases y condiciones de carrera.
- Frontend: interacciones y errores de login/formulario, filtros, cierre de sesión, control de versiones e ignorar respuestas posteriores al cierre de sesión.
- Mocks: escenarios deterministas, contratos, autenticación, callback permitido, idempotencia, fallos temporales, XML y notificaciones.
- Navegador real: Playwright con Microsoft Edge en Windows. Flujo de escritorio hasta aceptación y confirmación de ambas notificaciones; formulario de 390 px sin desbordamiento horizontal; supervisor con escritura denegada.
- Docker: targets backend y mocks construidos; smoke de bundles de producción aprobado. Las bases y contenedores de ese smoke fueron temporales y limpiados.
- CI: workflows revisados con actionlint y ejecución real de GitHub Actions aprobada en Linux, incluido navegador Chromium.

## Cierre de las comprobaciones locales

| Comprobación                                 | Resultado observado                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run check`                              | PASS; lint sin advertencias, TypeScript, ambos OpenAPI, los tres builds, suites y enlaces documentales |
| Backend unitario, sin DB/red                 | 102/102 pruebas, 7 archivos, PASS                                                                      |
| Cobertura unitaria                           | Líneas 100 % (368/368), sentencias 100 % (423/423), funciones 100 % (96/96), ramas 99,68 % (321/322)   |
| Backend integración con Mongo y mocks reales | 23/23, PASS                                                                                            |
| Frontend componentes/interacciones           | 9/9, PASS                                                                                              |
| Mocks y contratos                            | 14/14, PASS                                                                                            |
| E2E navegador Edge                           | 2/2, PASS                                                                                              |
| `npm audit --audit-level=moderate`           | PASS; 0 vulnerabilidades conocidas en el lockfile consultado                                           |
| actionlint, tres workflows                   | PASS                                                                                                   |
| Builds Docker y smoke de producción          | PASS; tres procesos en contenedores, Swagger, login, dos ofertas, aceptación y ambas notificaciones    |

Total funcional automatizado: **150 pruebas** (148 en Vitest + 2 navegador); el smoke de contenedores y k6 son verificaciones adicionales. El gate de cobertura se aplica exclusivamente a la suite unitaria, no se mezcla con integración. Incluye todo `backend/src/**/*.ts` salvo `main.ts` y `worker-main.ts`, que contienen arranque/señales de procesos y se ejercitaron en el smoke Docker. No se excluyen servicios, adaptadores, rutas, Store, seed ni reglas. Resumen portable en [cobertura-unitaria.json](cobertura-unitaria.json); HTML/LCOV local en `backend/coverage-unit/`.

Las regresiones demuestran aprobación/rechazo recibidos durante un poll fallido, notificaciones agotadas recuperables sin reabrir el caso, leases vencidos, un worker atrasado sin poder sobrescribir otro, ETag obsoleto y respuestas web tardías tras aceptación o cambio de sesión. Cobertura alta no equivale a ausencia de defectos ni a auditoría de producción.

Los reportes generados no contienen contraseñas ni JWT. `.env`, `artifacts/` y directorios de cobertura están excluidos de Git.

## Smoke k6 local ejecutado

Comando: `k6 run --summary-export=artifacts/load/smoke-summary.json scripts/load/smoke.js`, dentro de la imagen Docker oficial de k6; origen local permitido explícitamente. Los secretos se pasaron por variables de entorno y no se registraron.

| Métrica                       |              Observación |
| ----------------------------- | -----------------------: |
| Usuarios virtuales / duración |          5 / 20 segundos |
| Iteraciones completas         |                       20 |
| Operaciones de negocio        |                       60 |
| HTTP total (incluye login)    |                       61 |
| Throughput HTTP               |      3,014 solicitudes/s |
| Latencia de negocio promedio  |                 10,02 ms |
| p90 / p95 / p99 de negocio    | 23,83 / 30,05 / 37,16 ms |
| Errores / rechazos 429        |                    0 / 0 |
| Checks                        |                    60/60 |

El [resumen JSON original](smoke-local.json) conserva los resultados. Este smoke prueba el funcionamiento del script y una carga pequeña local. No acredita 200/500 VUs, elasticidad, SLA, rendimiento en AWS/Azure/Atlas ni punto de ruptura. No se capturó CPU porcentual ni utilización de recursos de Mongo; no se infieren esos valores. Los escenarios obligatorios permanecen pendientes en [RENDIMIENTO](RENDIMIENTO.md).

## Publicación y CI real

Repositorio público: [ian0000/proyecto-api-final](https://github.com/ian0000/proyecto-api-final). Push del commit `17324f009d6fe4cce40e5eedd96774830cd68fd5` verificado contra `origin/main`.

La [primera ejecución CI](https://github.com/ian0000/proyecto-api-final/actions/runs/38998251785) terminó **success**: detección de cambios, documentación, frontend, backend (unitarias e integración Mongo), mocks, contrato, seguridad, E2E Chromium y `Required checks`. Esta evidencia corresponde a ese SHA; cambios posteriores tienen su propia ejecución. Publicar el repositorio y pasar CI no despliega la aplicación en AWS/Azure.

## Frontera del trabajo

No se han creado ni preparado ambientes AWS, Azure o Atlas, secretos de proveedores, DNS ni recursos facturables. Las guías y los workflows manuales son material para la siguiente etapa. Los RF/RNF parciales y pendientes del MVP permanecen visibles en [REQUIREMENTS](../REQUIREMENTS.md) y [BACKLOG](../BACKLOG.md).
