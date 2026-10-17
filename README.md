# Fábrica de Crédito Vehicular

Sandbox académico API-First para registrar una solicitud ficticia, enviarla a dos financieras simuladas, seguir sus respuestas, comparar ofertas y aceptar una. React + Vite, Fastify + Node.js/TypeScript y MongoDB. Pichincha usa JSON/webhook firmado; Pacífico usa XML/polling. Son contratos ficticios y no describen APIs bancarias reales.

Repositorio del proyecto: [ian0000/proyecto-api-final](https://github.com/ian0000/proyecto-api-final). La existencia del repositorio no acredita publicación de la aplicación ni éxito del pipeline.

**Alcance de esta entrega, 16 de octubre de 2026:** preparación y validación local hasta antes de preparar ambientes AWS, Azure y MongoDB Atlas. No hay URLs públicas verificadas ni recursos de nube provisionados. El estado de las pruebas debe consultarse en [EVIDENCIAS](docs/pruebas/EVIDENCIAS.md) y en [TESTING](docs/TESTING.md); que exista código no demuestra que una prueba haya pasado.

## Ejecutar localmente

Requisitos: Node.js >=22.16, npm y Docker con Docker Compose disponible. MongoDB usa el puerto local 27027 y un volumen propio; no necesita Atlas.

```powershell
npm ci
npx tsx scripts/init-local.ts
docker compose up -d mongo
npm run seed
npm run dev
```

`init-local.ts` genera `.env` con secretos aleatorios y se niega a sobrescribir uno existente. Lea `DEMO_PASSWORD` directamente en su `.env` local; no lo publique. Los usuarios iniciales son `asesor@demo.test`, `supervisor@demo.test` y `administrador@demo.test`; comparten esa contraseña local. El seed no cambia contraseñas de cuentas existentes. La configuración de referencia está en [.env.example](.env.example).

| Servicio local       | Dirección                          |
| -------------------- | ---------------------------------- |
| Web                  | http://localhost:5173              |
| API                  | http://localhost:4000              |
| Swagger UI           | http://localhost:4000/docs         |
| Contrato             | http://localhost:4000/openapi.json |
| Mocks independientes | http://localhost:4001/health/live  |

`npm run dev` inicia API, worker, mocks y Vite. Deténgalos con Ctrl+C; `docker compose stop mongo` conserva la base. `docker compose down` también conserva el volumen salvo que se solicite expresamente eliminarlo. Todos los datos de demostración deben ser ficticios: identificaciones `DEMO-000001`, correos `.test` e importes en USD.

## Documentación y entregables

| Tema                                    | Documento                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Problema, objetivos y negocio           | [PRODUCT](docs/PRODUCT.md) · [Fase 1](docs/fase1/ENTREGA.md)                                              |
| Requisitos y diferencias con originales | [REQUIREMENTS](docs/REQUIREMENTS.md)                                                                      |
| Arquitectura, patrones y alternativas   | [ARCHITECTURE](docs/ARCHITECTURE.md) · [Fase 2](docs/fase2/ENTREGA.md)                                    |
| Datos y contrato                        | [DATA_MODEL](docs/DATA_MODEL.md) · [API_CONTRACT](docs/API_CONTRACT.md) · [Fase 3](docs/fase3/ENTREGA.md) |
| Calidad y estado local                  | [TESTING](docs/TESTING.md) · [Fase 4](docs/fase4/ESTADO.md)                                               |
| Despliegue futuro y CI                  | [DEPLOYMENT](docs/DEPLOYMENT.md) · [CICD](docs/CICD.md)                                                   |
| Pendientes, defensa y rúbrica           | [BACKLOG](docs/BACKLOG.md) · [DEFENSA](docs/DEFENSA.md) · [Matriz](docs/MATRIZ_RUBRICA.md)                |

Los originales están preservados en [docs/fuentes](docs/fuentes/manifest.json), con hashes SHA-256. Las versiones actualizadas explican las sustituciones tecnológicas y los requisitos todavía incompletos; no reemplazan ni reescriben las fuentes. No se ha verificado ningún envío a la plataforma académica.

## Comprobaciones

```powershell
npm run lint
npm run typecheck
npm run contract
npm run build
npm test
npm run docs:check
```

`npm run check` agrupa las verificaciones anteriores. Unitarias con cobertura: `npm run test:unit`. Integración real: `npm run test:integration`. E2E: `npm run test:e2e` (instale Chromium con `npx playwright install chromium`; en Windows puede usar `$env:E2E_BROWSER_CHANNEL="msedge"`). Los objetivos de cobertura y carga son criterios a medir, no resultados implícitos. Consulte [TESTING](docs/TESTING.md).
