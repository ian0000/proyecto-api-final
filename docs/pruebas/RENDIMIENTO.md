# Plan reproducible de carga y estrés

**Estado: escenarios preparados; pruebas completas k6 y medición cloud PENDIENTES.** No se inventan RPS, percentiles, punto de ruptura, CPU ni recuperación. Las pruebas funcionales no demuestran rendimiento. Solo ejecutar sobre una instalación aislada autorizada con datos ficticios, con API + worker + mocks y MongoDB persistentes.

## Escenarios implementados

| Escenario                                    | Perfil                                                | Propósito                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Sostenida](../../scripts/load/sustained.js) | 0→200 VUs en 2 min; 200 durante 5 min; 200→0 en 1 min | Estabilidad y degradación durante 8 min, más terminación de iteraciones                                          |
| [Pico](../../scripts/load/spike.js)          | 0→500 VUs en 1 s; 500 por 1 min; 500→0 en 1 s         | Sobrecarga y rechazo controlado                                                                                  |
| Recuperación, incluida en pico               | Tras el segundo 62, 1 VU observador durante 2 min     | Liveness inmediato y consulta autenticada; evalúa errores en la ventana final tras 65 s para dejar expirar cuota |
| [Smoke local](../../scripts/load/smoke.js)   | 5 VUs, 20 s, pausa adicional de 4 s/iteración         | Comprobar ejecutabilidad del script y endpoints; no sustituye carga sostenida ni pico                            |

El VU observador no mantiene el pico: los 500 VUs de tráfico caen a cero. Una rampa de 1 segundo aproxima el salto abrupto de la rúbrica; la precisión depende del generador. El sistema no implementa autoescalado ni se le atribuye elasticidad por ejecutar este escenario.

Cada iteración inicia con creación de solicitud ficticia y clave de idempotencia distinta, consulta el detalle si la creación fue aceptada y consulta el listado paginado. Usa ambas financieras de `shared/example.json`, activando procesamiento persistente y callbacks/polling reales de los mocks. Duerme un segundo entre iteraciones. Los 202 miden recepción asíncrona; **no son el tiempo hasta obtener ofertas**. Esa latencia se mide aparte con eventos/observación de cola.

El `setup` hace un login real con `LOAD_EMAIL` y `LOAD_PASSWORD`, sin tokens codificados. No registra token ni contraseña. Una cuenta compartida prueba la política de cuota de esa identidad. El login tiene además 10 intentos/minuto: no intentar crear cientos de sesiones desde la misma IP en setup ni suprimir la política para maquillar resultados.

## Rate limiting y criterios

La configuración normal permite **120 peticiones por minuto por usuario autenticado** (y por IP en rutas públicas). Los VUs comparten el token del usuario de setup; un escenario de 200 o 500 VUs alcanzará 429 rápidamente. Eso demuestra protección de cuota y no permite deducir la capacidad máxima del backend. Mantener esa configuración en la primera corrida y documentarla.

Para un estudio separado de capacidad haría falta un perfil explícitamente aprobado: identidades de carga suficientes o cuota de laboratorio distinta, con su configuración publicada en el reporte. Los scripts actuales no generan una población de usuarios ni evitan cuotas. No afirmar que cumplen <1 % errores si la corrida obtuvo muchas respuestas 429.

| Indicador              | Fuente k6                                             | Criterio/reporte                                                                         |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| RPS global             | `http_reqs.rate`                                      | Incluir setup, negocio y recuperación por separado usando tags/muestras                  |
| Latencia               | `http_req_duration`, `successful_business_latency_ms` | avg, p90, p95, p99; distinguir éxitos de rechazos rápidos                                |
| p95 de negocio exitoso | Trend custom                                          | Umbral operativo <2000 ms; objetivo ideal <500 ms del RNF/guía, registrar ambos          |
| Error total            | `errors_including_429`                                | <1 % sostenido; incluye 429 y transporte/status 0                                        |
| Error inesperado       | `unexpected_errors`                                   | <1 %; no incluye 429, se reporta además del total                                        |
| Cuota                  | `rate_limited`                                        | Proporción 429 explícita; no diluirla en éxitos                                          |
| Códigos                | `status_codes{code,endpoint}`                         | 200, 202, 4xx, 429, 5xx y 0 por endpoint                                                 |
| Recuperación           | `recovery_tail_errors` + muestras                     | <1 % en ventana final, observar recuperación inmediata y tras expirar cuota              |
| Recurso/cola           | Telemetría externa + `/v1/admin/metrics`              | CPU, RSS, BD conexiones/operaciones, cola pendiente/dead; capturar antes/durante/después |

El umbral `p95<2000` refleja la meta operativa del prompt; no acredita por sí solo el ideal `p95<500`. `check` acepta explícitamente 429 como respuesta de protección; el umbral `errors_including_429` sigue fallando si supera 1 %. Un exit code de fallo debe preservarse y explicarse, incluso cuando el rechazo sea esperado. No filtrar latencias 429 y presentar su p95 bajo como si fuera latencia de negocio exitoso.

## Ejecución posterior autorizada

Instalar k6 desde su distribución oficial. Desde raíz, con API y worker activos y un usuario ficticio con permiso de creación:

```powershell
$env:BASE_URL = 'http://127.0.0.1:4000'
$env:LOAD_ALLOWED_ORIGIN = $env:BASE_URL
$env:LOAD_EMAIL = 'asesor@demo.test'
# Proporcionar LOAD_PASSWORD mediante el entorno privado; nunca en el repositorio.
New-Item -ItemType Directory -Force artifacts/load | Out-Null
k6 run --out json=artifacts/load/sustained-samples.json --summary-export=artifacts/load/sustained-summary.json scripts/load/sustained.js
k6 run --out json=artifacts/load/spike-samples.json --summary-export=artifacts/load/spike-summary.json scripts/load/spike.js
```

Son comandos para ejecutar después, no evidencia de ejecución actual. Para nube usar únicamente un origen HTTPS propio aprobado y [workflow manual](../../.github/workflows/load.yml). El allowlist de k6 es una comprobación de igualdad configurada por quien ejecuta; no prueba propiedad del destino. El workflow añade variables protegidas y validación HTTPS antes del tráfico.

Para comprobar la instalación primero: `k6 run --summary-export=artifacts/load/smoke-summary.json scripts/load/smoke.js`, con el mismo entorno privado. El smoke tiene umbrales idénticos de error/latencia y produce aproximadamente 60 peticiones de negocio, compatible con la cuota si la identidad no fue utilizada antes. Sus resultados se registran en las evidencias locales, separados de las dos pruebas obligatorias pendientes.

Evitar que el generador comparta CPU/memoria con la API en el estudio de nube. Si corre en la misma PC para diagnóstico local, declararlo y no extrapolar. Tener un presupuesto/tiempo máximo, vigilar crecimiento de ambas bases y detener si se aproxima a cuotas. No subir `LOAD_PASSWORD`, logs de auth ni muestras con datos personales.

## Reporte a completar con resultados reales

| Campo                                                            | Sostenida                             | Pico + recuperación |
| ---------------------------------------------------------------- | ------------------------------------- | ------------------- |
| Fecha, commit/digest, máquina generadora, región y tamaño API/BD | PENDIENTE                             | PENDIENTE           |
| RATE_LIMIT, identidad, seed y configuración de mocks             | PENDIENTE                             | PENDIENTE           |
| VUs alcanzados, duración y RPS                                   | PENDIENTE                             | PENDIENTE           |
| avg / p90 / p95 / p99 global y por ruta exitosa                  | PENDIENTE                             | PENDIENTE           |
| % total error / %429 / %error inesperado                         | PENDIENTE                             | PENDIENTE           |
| Conteo por código y comparación objetivo 500 ms / 2 s            | PENDIENTE                             | PENDIENTE           |
| CPU API/worker/mocks, memoria, conexiones/ops Mongo, cola        | PENDIENTE                             | PENDIENTE           |
| Breakpoint en VUs/RPS y causa sustentada                         | PENDIENTE                             | PENDIENTE           |
| Tiempo recuperación de respuestas exitosas y cola                | No aplica si no se degrada; comprobar | PENDIENTE           |
| Exit code, thresholds fallidos, costo, límites y acciones        | PENDIENTE                             | PENDIENTE           |

Adjuntar JSON de resumen y muestras, configuración sin secretos, gráficas de RPS/VUs/latencia/error y telemetría por tiempo. Identificar primer intervalo de degradación sostenida y repetir alrededor de ese volumen para acotar el breakpoint; no deducirlo de un único máximo de 500 VUs. Comparar recuperación de proceso, cuota y backlog por separado. Atlas Free limita operaciones y carece de ciertas métricas avanzadas: declarar las métricas no disponibles y no inventarlas.
