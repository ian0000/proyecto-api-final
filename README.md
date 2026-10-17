# Fábrica de Crédito Vehicular

Sandbox académico API-First para registrar una solicitud ficticia, enviarla a dos financieras simuladas, seguir sus respuestas, comparar ofertas y aceptar una. React + Vite, Fastify + Node.js/TypeScript y MongoDB. Pichincha usa JSON/webhook firmado; Pacífico usa XML/polling. Son contratos ficticios y no describen APIs bancarias reales.

Repositorio del proyecto: [ian0000/proyecto-api-final](https://github.com/ian0000/proyecto-api-final). La existencia del repositorio no acredita publicación de la aplicación ni éxito del pipeline.

**Alcance de esta entrega, 16 de octubre de 2026:** preparación y validación local hasta antes de preparar ambientes AWS, Azure y MongoDB Atlas. No hay URLs públicas verificadas ni recursos de nube provisionados. El estado de las pruebas debe consultarse en [EVIDENCIAS](docs/pruebas/EVIDENCIAS.md) y en [TESTING](docs/TESTING.md); que exista código no demuestra que una prueba haya pasado.

## Ejecutar en desarrollo (DEV)

Se ejecuta todo en tu PC: frontend, API, worker y financieras simuladas. Solo MongoDB necesita Docker; no necesitas cuentas de AWS, Azure ni Atlas.

### Requisitos

- Node.js **22.16 o superior**, con npm.
- Docker Desktop iniciado, con contenedores Linux y Docker Compose disponible.
- Puertos locales libres: `5173` (web), `4000` (API), `4001` (mocks) y `27027` (MongoDB).

Los comandos siguientes son para **PowerShell**, desde la raíz del repositorio, donde está `package.json`. Si todavía no tienes el código:

```powershell
git clone https://github.com/ian0000/proyecto-api-final.git
cd proyecto-api-final
```

Si ya tienes el proyecto abierto, usa su carpeta actual; no necesitas clonarlo otra vez.

### Primera ejecución

```powershell
# 1. Instalar las dependencias de todos los componentes.
npm ci

# 2. Generar la configuración y secretos locales solo si .env no existe.
if (!(Test-Path -LiteralPath .env)) {
    npx tsx scripts/init-local.ts
}

# 3. Iniciar MongoDB y esperar a que esté listo.
docker compose up -d --wait mongo

# 4. Crear las tres cuentas de demostración si todavía no existen.
npm run seed

# 5. Iniciar frontend, API, worker y mocks juntos.
npm run dev
```

Mantén esa terminal abierta mientras pruebas. `npm run dev` inicia los cuatro procesos; no debes levantar cada componente por separado. Vite actualiza el frontend al editarlo. Si modificas backend, worker, mocks o `.env`, detén el comando con **Ctrl+C** y vuelve a ejecutar `npm run dev`.

Abre la [aplicación DEV](http://127.0.0.1:5173/).

### Usuarios y contraseña

| Usuario                   | Acceso de demostración                                     |
| ------------------------- | ---------------------------------------------------------- |
| `asesor@demo.test`        | Registrar, seguir, comparar ofertas, aceptar y desistir    |
| `supervisor@demo.test`    | Consultar las solicitudes de su agencia                    |
| `administrador@demo.test` | Consultar todas las agencias y reactivar trabajos agotados |

**La contraseña no es la palabra `DEMO_PASSWORD`.** Abre el archivo `.env` en tu editor, busca la línea `DEMO_PASSWORD=` y copia únicamente el valor completo que está después del signo `=`. Las tres cuentas iniciales comparten ese valor generado para tu instalación.

En `.env` la contraseña de demostración está en texto plano; MongoDB guarda su hash scrypt con una sal aleatoria. `.env` está excluido de Git y no debes publicarlo. La configuración de referencia, sin secretos reales, está en [.env.example](.env.example).

`npm run seed` conserva las cuentas existentes y **no cambia sus contraseñas**. Modificar `DEMO_PASSWORD` después de haber creado los usuarios no actualiza el hash almacenado. Conserva tu `.env` entre ejecuciones.

### Probar el flujo principal

1. Ingresa como `asesor@demo.test` con la contraseña de tu `.env`.
2. Abre **Nueva solicitud**; puedes usar los datos ficticios precargados.
3. Selecciona ambas financieras, deja el escenario **Aprobación** y marca el consentimiento ficticio.
4. Pulsa **Registrar y enviar solicitud**. El estado se actualiza automáticamente mientras el worker procesa los envíos.
5. Espera las dos ofertas, compáralas y acepta una. Revisa el historial y la confirmación de comunicación con las financieras.
6. Para probar errores, crea otra solicitud con **Fallo temporal y recuperación** o **Timeout persistente**. El segundo escenario agota los reintentos y requiere revisión; no debe producir una oferta inmediata.

Usa únicamente información ficticia: identificaciones como `DEMO-000001`, correos `.test` e importes en USD.

### Volver a iniciar y detener

Después de la primera instalación, normalmente solo necesitas:

```powershell
docker compose up -d --wait mongo
npm run dev
```

No hace falta regenerar `.env` ni repetir el seed. Si actualizaste el código y cambió `package-lock.json`, ejecuta `npm ci` antes de iniciar.

Para detener la aplicación, pulsa **Ctrl+C** en la terminal de `npm run dev`. Luego puedes detener MongoDB:

```powershell
docker compose stop mongo
```

Esto conserva usuarios, solicitudes y ofertas en el volumen local. No uses `docker compose down -v` para una parada normal: elimina el volumen con los datos de esta instalación.

### Direcciones y diagnóstico rápido

| Servicio local       | Dirección                                          |
| -------------------- | -------------------------------------------------- |
| Web                  | [Aplicación](http://127.0.0.1:5173/)               |
| API lista con Mongo  | [Readiness](http://127.0.0.1:4000/health/ready)    |
| Swagger UI           | [Probar endpoints](http://127.0.0.1:4000/docs/)    |
| Contrato             | [OpenAPI JSON](http://127.0.0.1:4000/openapi.json) |
| Mocks independientes | [Health mocks](http://127.0.0.1:4001/health/live)  |

| Problema                                      | Qué revisar                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No encuentra `.env`                           | Ejecuta el paso de generación desde la raíz del repositorio.                                                                                                                          |
| `.env already exists; not overwritten`        | Ya tienes configuración. Conserva ese archivo y continúa con MongoDB, seed si faltan cuentas, y DEV.                                                                                  |
| No conecta a MongoDB                          | Abre Docker Desktop y ejecuta `docker compose up -d --wait mongo`; confirma el estado con `docker compose ps`. La configuración generada usa `127.0.0.1:27027`.                       |
| Correo o contraseña incorrectos               | Usa una cuenta de la tabla y el valor de `DEMO_PASSWORD`, sin copiar el nombre de la variable. Si cambiaste ese valor después del seed, las cuentas conservan la contraseña anterior. |
| Puerto ocupado / `EADDRINUSE`                 | Comprueba si ya tienes una ejecución de DEV abierta y detenla desde su terminal antes de iniciar otra.                                                                                |
| La web abre, pero las solicitudes fallan      | Revisa la terminal de DEV y el endpoint de readiness. API, worker y mocks deben seguir ejecutándose.                                                                                  |
| Cambiaste backend o `.env` y no ves el efecto | Reinicia `npm run dev`; esos procesos no tienen recarga automática.                                                                                                                   |

## Documentación y entregables

El [informe integral en Word](docs/INFORME_FABRICA_DE_CREDITO.docx) explica el funcionamiento, las decisiones técnicas, las evidencias de la rúbrica, los 40 RF/RNF y los pendientes, con manual DEV y guía de sustentación.

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
