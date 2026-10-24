# CI y límite de CD

[CI](../.github/workflows/ci.yml) se ejecuta en pull requests y pushes a `main`, sin filtros globales `paths` que dejen un estado requerido pendiente. El estado a exigir posteriormente en la protección de rama es **CI / Required checks**. No se ha configurado protección de rama. La primera ejecución real de GitHub Actions pasó todos sus trabajos, incluido Chromium/E2E; véase [EVIDENCIAS](pruebas/EVIDENCIAS.md).

## Selección por dependencias

| Cambio                                                                                                             | Trabajos de código                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Solo `docs/**`, Markdown raíz, LICENSE o `.gitignore`                                                              | Ninguno; sí revisión documental                                                                     |
| `frontend/**`                                                                                                      | Frontend, seguridad y navegador                                                                     |
| `backend/**`                                                                                                       | Backend con cobertura, contrato, seguridad y navegador                                              |
| `mocks/**`                                                                                                         | Mocks **y backend**: las pruebas backend consumen el servidor mock; contrato, seguridad y navegador |
| `shared/**`                                                                                                        | Frontend, backend, mocks, contrato, seguridad y navegador                                           |
| Lockfile, dependencias, TypeScript/ESLint, scripts, tests E2E, Docker, workflows, configuración global desconocida | Todos                                                                                               |

[scripts/affected.ts](../scripts/affected.ts) recibe base y HEAD del evento. Diff de PR usa el SHA base y el SHA de la revisión; primer push o base no disponible activa todos los trabajos conservadoramente. Git renames se evalúan como eliminación + creación. Un job `Required checks` con `always()` recibe todos los resultados y falla si cualquiera falló o fue cancelado; permite jobs omitidos por selección de rutas. No convierte fallos en éxitos.

Inspección local sin Git:

```powershell
node --import tsx scripts/affected.ts --paths docs/PRODUCT.md
node --import tsx scripts/affected.ts --paths mocks/src/app.ts
node --import tsx scripts/affected.ts --paths shared/openapi.json
```

Los jobs instalan con `npm ci`, respetan el lockfile y usan Node 22. Backend y mocks disponen de MongoDB 8 en `127.0.0.1:27027` con healthcheck. Se ejecutan ESLint por alcance, TypeScript, build y pruebas del workspace. Backend ejecuta primero las pruebas unitarias sin DB con umbrales de cobertura, y después la integración real; publica HTML/LCOV de `backend/coverage-unit`. Contrato valida OpenAPI y TypeScript de scripts/compartidos. `npm audit --audit-level=high` falla ante vulnerabilidades altas/críticas, incluyendo herramientas; no equivale a un análisis completo de seguridad.

El navegador instala Chromium y usa el servidor E2E real con API, worker, mocks y MongoDB aislada. Sus secretos y usuarios son fixtures ficticios de prueba; no consume secretos ni servicios cloud. Conserva trazas de fallo y capturas de escritorio/móvil como artefactos. La prueba E2E ajusta su cuota para cubrir flujos; esa configuración **no es el perfil de rendimiento** y no sustituye probar `RATE_LIMIT=120`.

[scripts/check-docs.ts](../scripts/check-docs.ts) comprueba que existan los enlaces relativos Markdown y rechaza rutas locales absolutas/no portables. Omite bloques de código, dependencias y salidas generadas. No consulta URLs externas, ni comprueba anclas de títulos o semántica de diagramas. Es una comprobación estructural, complementaria a revisión humana.

## Plantillas manuales bloqueadas

[Cloud preflight](../.github/workflows/cloud-preflight.yml) solo responde a `workflow_dispatch` y requiere `CLOUD_PREPARATION_APPROVED=true`. Su ambiente `cloud-preflight` debe configurarse con revisores antes de activarlo. Valida sintaxis de orígenes HTTPS, construye los tres componentes, ajusta CSP del artefacto web y guarda el build revisable. **No crea infraestructura, autentica proveedores, sube imágenes ni despliega**. No contiene credenciales reales. Las variables previstas son `API_ORIGIN`, `MOCK_ORIGIN` y `FRONTEND_ORIGIN`.

No se llama a esta plantilla “CD completado”: el trabajo de publicación se incorpora después de preparar AWS/Azure, acordar permisos y aprobar el ambiente. [Despliegue](DEPLOYMENT.md) especifica esa continuación y rollback.

[Carga manual](../.github/workflows/load.yml) requiere `LOAD_TEST_APPROVED=true`, ambiente protegido `load-testing`, origen exacto `LOAD_ALLOWED_ORIGIN` y secretos `LOAD_EMAIL`/`LOAD_PASSWORD`. El origen introducido debe coincidir antes de cualquier HTTP. No ejecutar contra banca real, producción ni destinos ajenos. El usuario no ha autorizado ni preparado pruebas remotas en esta etapa. Los scripts también exigen autorización explícita de destino al ejecutarlos localmente.

## Estado verificable

El job `ops` comprueba la sintaxis del instalador Discord y ejecuta `npm run test:ops` cuando el alcance incluye backend/cambios globales. `Required checks` también falla si ese job falla. Estas pruebas usan datos ficticios locales y no publican mensajes ni utilizan el webhook real; la activación se documenta en [DISCORD_ALERTS](DISCORD_ALERTS.md).

Continuación Azure del 23 de octubre: [Azure frontend](../.github/workflows/azure-static-web-apps-thankful-pebble-0ac084b0f.yml) publica únicamente `frontend/dist` en el recurso Free creado desde VS Code. Comprueba lint, las pruebas web y el build específico con el origen AWS. No ejecuta ni despliega backend, worker o mocks. La URL y las comprobaciones remotas, incluida la corrección CORS, se registran en [AZURE](AZURE.md). El [despliegue real](https://github.com/ian0000/proyecto-api-final/actions/runs/40054075901) terminó success; también pasó el [CI completo del helper CORS y la configuración](https://github.com/ian0000/proyecto-api-final/actions/runs/40054219333), con integración Mongo y E2E en el entorno de CI. Esta continuación amplía el límite cloud de la entrega anterior; no completa los pendientes de carga, SLA o recuperación.

El repositorio público es [ian0000/proyecto-api-final](https://github.com/ian0000/proyecto-api-final). La primera ejecución CI y el corte local se conservan en las evidencias de la entrega; la continuación anterior acredita por separado el CD frontend. Quedan pendientes automatización de despliegue backend, separación formal y protecciones de ambientes, mediciones de nube y pruebas de recuperación. El éxito del frontend no acredita esos pendientes.
