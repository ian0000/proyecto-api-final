# Calidad, pruebas y evidencia

**Un script configurado no equivale a una prueba aprobada.** Este documento define comandos y criterios. Los resultados de la ejecución local deben registrarse con fecha, comando, código de salida y artefacto; no se declara desde aquí una cobertura, latencia, disponibilidad ni despliegue verificados.

## Gates reproducibles

| Comando desde la raíz      | Alcance                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `npm run lint`             | ESLint con cero advertencias                                                        |
| `npm run typecheck`        | TypeScript raíz y workspaces                                                        |
| `npm run contract`         | OpenAPI válido y ejemplo canónico                                                   |
| `npm run build`            | Compilación frontend/backend/mocks                                                  |
| `npm run test:unit`        | Backend unitario sin DB/red + cobertura V8                                          |
| `npm run test:integration` | Backend con Mongo real y mocks HTTP                                                 |
| `npm run test:backend`     | Ambas suites backend, separadas                                                     |
| `npm test`                 | Tests de los tres workspaces                                                        |
| `npm run test:e2e`         | Playwright; su configuración inicia servicios aislados y requiere Mongo y navegador |
| `npm run docs:check`       | Consistencia documental y referencias comprobadas por script                        |
| `npm run check`            | Gate agregado lint/typecheck/contrato/build/tests/documentación                     |

Instale dependencias con `npm ci` y prepare Mongo local según [README](../README.md). No conecte suites a Atlas o a datos reales. Los entornos de prueba deben usar una base separada y limpiar solo sus propios datos.

## Capas que deben probarse

| Capa        | Casos de valor                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Unidad      | Hash/password, firmas, mapeos JSON/XML, decisiones deterministas y reglas de negocio                          |
| Integración | API inyectada con Mongo real local, JWT/roles/agencias, estados y CAS                                         |
| Contrato    | Schemas y ejemplo; requests/responses reales contra contrato, no solo sintaxis                                |
| Asincronía  | Persistencia de jobs, lease vencido, replay, backoff, DLQ y recuperación administrativa                       |
| Mocks       | Escenarios aprobada/condiciones/rechazada/informacion/demora/temporal/timeout; deduplicación y notificaciones |
| Frontend    | Login, error/estado vacío, formulario, filtros, comparación y restricciones de roles                          |
| E2E         | Navegador → API → worker → mock → ofertas → aceptación/desistimiento y bitácora                               |
| Carga       | Dos escenarios k6, errores HTTP, latencia y recuperación; sin costes cloud                                    |

## Cobertura

La rúbrica exige **más del 80 %**. Se configura objetivo interno **85 % en líneas, sentencias, funciones y ramas** para backend. V8 incluye `backend/src/**/*.ts`; excluye únicamente entrypoints de arranque API/worker, no servicios, adaptadores o reglas. Estas exclusiones deben explicarse en defensa y no ampliarse para ocultar fallos. El umbral se aplica a la suite unitaria aislada; la integración no incrementa su cobertura. Reportes esperados en `backend/coverage-unit/` (HTML, lcov y resumen JSON). El reporte generado y el exit code del gate determinan cumplimiento; no el número de tests.

## Rendimiento y criterios de lectura

La carga sostenida implementada en [sustained.js](../scripts/load/sustained.js) sube a 200 VUs en 2 minutos, mantiene 5 minutos y baja en 1 minuto. [spike.js](../scripts/load/spike.js) alcanza 500 VUs en 1 segundo, mantiene 1 minuto, baja en 1 segundo y observa recuperación 2 minutos con un usuario. Los parámetros satisfacen las ventanas propuestas de la rúbrica; el resultado debe medirse. Consulte también [RENDIMIENTO](pruebas/RENDIMIENTO.md) y el workflow manual en [CICD](CICD.md).

Con k6 instalado, configure en la sesión local `BASE_URL` y `LOAD_ALLOWED_ORIGIN` con el mismo origen local exacto, más `LOAD_EMAIL` y `LOAD_PASSWORD` de una cuenta ficticia; no escriba la contraseña en comandos guardados ni reportes. Con los servicios ya iniciados:

```powershell
k6 run --summary-export=artifacts/load/sustained-summary.json scripts/load/sustained.js
k6 run --summary-export=artifacts/load/spike-summary.json scripts/load/spike.js
```

Cree antes el directorio `artifacts/load` si su runner no lo crea. Use una base local exclusiva de carga. Un smoke corto sirve para comprobar el script, no sustituye esos dos escenarios. Los scripts fallan si el origen no coincide con el permitido explícitamente; no apunte a servicios externos.

Reporte RPS, promedio, p90/p95/p99, tasa de errores y códigos HTTP, CPU/memoria y métricas DB cuando se capturen; describa saturación, recuperación y rate limiting. Objetivo sostenido: errores <1 %. Para registro/consulta RNF: p95 <2 s; ideal estándar síncrono: p95 <500 ms. Separe 202 de decisión bancaria: el segundo es tiempo de procesamiento, no latencia HTTP del registro.

Los 429 son rechazos reales de protección y deben informarse, aunque se ejecute una segunda pasada con límite deliberadamente ajustado para medir capacidad. No elimine errores de la estadística para aparentar rendimiento. Si no hay degradación en el rango medido, reporte ese rango y que no se encontró el punto de ruptura; no extrapole uno exacto. CPU acumulada del proceso no equivale a utilización porcentual ni una observación local prueba autoescalado de nube.

## Contenedores

Después de construir ambos targets según [DEPLOYMENT](DEPLOYMENT.md), `node --import tsx scripts/container-smoke.ts` prueba los bundles con dependencias de producción, usando tres contenedores y dos bases temporales propias. Verifica Swagger, login, dos ofertas, aceptación y entrega de notificaciones, y limpia solo sus contenedores/bases. Requiere el Mongo y la red creados por Compose; usa puertos locales 4400/4401.

## Estado externo

No hay ejecución en AWS/Azure/Atlas, SLA mensual ni prueba de backups/restauración acreditados. Los resultados locales y los pendientes de fase 4 se relacionan en [MATRIZ_RUBRICA](MATRIZ_RUBRICA.md) y [BACKLOG](BACKLOG.md).
