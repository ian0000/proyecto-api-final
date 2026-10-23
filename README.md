# Fábrica de Crédito Vehicular

Sandbox académico API-First para registrar solicitudes ficticias de crédito, consultar respuestas, comparar ofertas y aceptar o desistir. Pichincha y Pacífico son simulaciones; sus contratos no representan APIs bancarias reales.

**Distribución vigente:** frontend React/Vite en Azure, backend Fastify y worker en AWS EC2 Ubuntu, y datos en MongoDB Atlas. La ejecución utiliza Node.js directamente. Docker no es un requisito de este flujo. Compass permite consultar los datos de Atlas desde tu computadora.

## Frontend y backend separados

Un mismo repositorio contiene componentes que se construyen y publican por separado:

| Carpeta     | Componente                                     | Destino                                  |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| `frontend/` | Web React/Vite; build estático `frontend/dist` | Azure Static Web Apps                    |
| `backend/`  | API REST Fastify y proceso worker              | AWS EC2 Ubuntu con Node.js               |
| `mocks/`    | Bancos ficticios JSON/webhook y XML/polling    | AWS EC2 Ubuntu, proceso separado         |
| `shared/`   | Tipos y contratos OpenAPI                      | Compartidos al construir los componentes |

```text
Navegador → Frontend Azure → API HTTPS en AWS → MongoDB Atlas
                                  ↑                  ↑
                           Webhook del mock    Worker en AWS
                                  ↑                  ↓
                           Bancos simulados ← Adaptadores
```

“Monolito modular” describe la organización interna del backend. La web es independiente, la API y el worker tienen procesos propios, y los mocks tienen su proceso y su base. Esta separación permite publicar el frontend en Azure y el backend en AWS conservando un repositorio Git.

El frontend conoce únicamente la dirección pública de la API (`VITE_API_URL`). Las credenciales de Atlas y los secretos JWT/HMAC permanecen en el servidor.

## Estado

La entrega del 16 de octubre de 2026 se validó localmente. Desde el 22 de octubre se está conectando Atlas y preparando la ejecución directa en Ubuntu. El estado específico está en [ATLAS](docs/ATLAS.md); las pruebas anteriores están en [EVIDENCIAS](docs/pruebas/EVIDENCIAS.md). Una conexión desde la computadora de desarrollo no prueba un despliegue en EC2 o Azure.

Repositorio: [ian0000/proyecto-api-final](https://github.com/ian0000/proyecto-api-final).

## Requisitos de DEV con Atlas

- Git, Node.js **22.16 o superior** y npm.
- Atlas accesible desde tu IP y un usuario con `readWrite` en `credito_test` y `credito_test_mocks`.
- Puertos locales libres: `5173` para la web, `4000` para la API y `4001` para los mocks.

En Ubuntu, npm se instala junto a Node.js. Usa [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) para instalar y seleccionar Node 22. Comprueba `node --version` y `npm --version` antes de continuar.

## Primera ejecución en DEV

Ejecuta desde la raíz del repositorio, donde está `package.json`. Si ya tienes el proyecto, utiliza esa carpeta.

```bash
git clone https://github.com/ian0000/proyecto-api-final.git
cd proyecto-api-final
npm ci
npm run atlas:init
```

`atlas:init` crea el archivo privado `.env.atlas` con secretos aleatorios y conserva cualquier archivo existente. Ábrelo en tu editor y completa `MONGODB_URI` con tu conexión Atlas. Usa `DB_NAME=credito_test`: los mocks añaden `_mocks` automáticamente. El archivo está excluido de Git.

Después de guardar la conexión:

```bash
# Solo lectura: conexión, autenticación y metadatos de ambas bases.
npm run atlas:check

# Escribe índices y crea las tres cuentas demo si no existen.
npm run seed:atlas

# Inicia la web DEV, la API, el worker y los mocks.
npm run dev:atlas
```

Mantén la terminal abierta. Desde tu computadora de desarrollo, abre [la web local](http://127.0.0.1:5173/). Vite sirve para desarrollar; la publicación del frontend en Azure utiliza su build estático.

Vite actualiza la web al editarla. Los cambios en backend, worker, mocks o `.env.atlas` requieren detener DEV con **Ctrl+C** y ejecutar otra vez `npm run dev:atlas`.

## Usuarios y contraseña

| Usuario                   | Acceso                                                  |
| ------------------------- | ------------------------------------------------------- |
| `asesor@demo.test`        | Registrar, consultar, comparar, aceptar y desistir      |
| `supervisor@demo.test`    | Consultar las solicitudes de su agencia                 |
| `administrador@demo.test` | Consulta global, métricas y reactivar trabajos agotados |

La contraseña inicial es el **valor de `DEMO_PASSWORD` en `.env.atlas`**. No es la palabra `DEMO_PASSWORD`, la contraseña de tu cuenta Atlas ni la del usuario de conexión a MongoDB. La base guarda hashes scrypt de las contraseñas de aplicación.

El seed conserva los usuarios existentes y **no cambia sus contraseñas**. Modificar `DEMO_PASSWORD` después de crearlos no actualiza el hash almacenado. Conserva la configuración privada y no publiques contraseñas, URI, JWT ni capturas del archivo.

## Probar el flujo

1. Ingresa como asesor con la contraseña privada de demostración.
2. Abre **Nueva solicitud** y usa datos ficticios: identificación `DEMO-000001` y correo `.test`.
3. Selecciona ambas financieras, el escenario **Aprobación** y el consentimiento ficticio.
4. Pulsa **Registrar y enviar solicitud**. La API responde `202` después de persistir; el worker procesa los envíos.
5. Espera las ofertas, compáralas, acepta una y revisa el historial y las notificaciones a los mocks.
6. Para observar reintentos, crea otro caso con **Fallo temporal y recuperación** o **Timeout persistente**.

## Volver a iniciar y detener DEV

```bash
npm run dev:atlas
```

Pulsa **Ctrl+C** para detener los procesos. Los datos permanecen en Atlas. No necesitas instalar ni iniciar MongoDB localmente. Si cambia `package-lock.json`, ejecuta `npm ci` antes de iniciar otra vez.

## Publicar cada parte por separado

**AWS EC2 Ubuntu:** instala Node.js/npm y descarga el repositorio. Configura `.env.atlas` en esa instancia, valida la conexión desde EC2 y construye únicamente el servidor:

El archivo privado no llega con `git clone`. Transfiérelo por SSH/SCP o configúralo mediante un canal privado. Las cuentas demo de Atlas ya creadas conservan la contraseña original: si generas otro archivo, un `DEMO_PASSWORD` distinto no cambia esas cuentas. Conserva el valor utilizado al crearlas.

```bash
npm ci
npm run atlas:check
npm run build --workspace backend
npm run build --workspace mocks
```

Los tres procesos de servidor son:

```bash
node --env-file=.env.atlas backend/dist/main.js
node --env-file=.env.atlas backend/dist/worker-main.js
node --env-file=.env.atlas mocks/dist/main.js
```

Cada comando inicia un proceso. Para mantenerlos activos al cerrar SSH deben configurarse servicios supervisados. HTTPS, reverse proxy y permisos de red se detallan en [DEPLOYMENT](docs/DEPLOYMENT.md). La API no depende de ejecutar Vite en EC2.

**Azure:** instala dependencias desde la raíz, ejecuta `npm run build --workspace frontend` y publica `frontend/dist`. Configura `VITE_API_URL` al origen HTTPS real de la API antes de construir. Ajusta también la CSP de `frontend/public/staticwebapp.config.json` y `CORS_ORIGINS` en AWS. Nunca agregues credenciales Atlas a variables `VITE_*`.

## Direcciones locales y diagnóstico

| Servicio               | Dirección                                         |
| ---------------------- | ------------------------------------------------- |
| Web DEV                | [Aplicación](http://127.0.0.1:5173/)              |
| API y conexión MongoDB | [Readiness](http://127.0.0.1:4000/health/ready)   |
| Swagger UI             | [Contrato navegable](http://127.0.0.1:4000/docs/) |
| OpenAPI JSON           | [Contrato](http://127.0.0.1:4000/openapi.json)    |
| Mocks                  | [Health](http://127.0.0.1:4001/health/live)       |

| Problema                   | Qué revisar                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm: command not found`   | Instala Node 22 con npm y vuelve a cargar la terminal.                                                   |
| Falta `.env.atlas`         | Ejecuta `npm run atlas:init` y completa la URI privada.                                                  |
| Falla `atlas:check`        | Credenciales, codificación URI, permisos de ambas bases, IP permitida, DNS y TLS.                        |
| Login incorrecto           | Usa `DEMO_PASSWORD` del archivo utilizado al crear esos usuarios; el seed no cambia usuarios existentes. |
| Puerto ocupado             | Revisa si ya tienes otra ejecución de DEV abierta y detenla desde su terminal.                           |
| Web publicada sin conexión | Comprueba `VITE_API_URL`, HTTPS, CORS y CSP con los orígenes reales de Azure y AWS.                      |

Los comandos heredados `npm run dev` y `npm run seed` siguen leyendo `.env`. La ruta actual con Atlas utiliza los comandos terminados en `:atlas`.

## Documentación y entregables

El [informe integral en Word](docs/INFORME_FABRICA_DE_CREDITO.docx) corresponde al corte local del 16 de octubre. La continuación con Atlas y ejecución directa se documenta en las guías siguientes.

| Tema                      | Documento                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| Atlas y ejecución directa | [ATLAS](docs/ATLAS.md) · [DEPLOYMENT](docs/DEPLOYMENT.md)               |
| Negocio y objetivos       | [PRODUCT](docs/PRODUCT.md)                                              |
| Arquitectura y patrones   | [ARCHITECTURE](docs/ARCHITECTURE.md)                                    |
| Modelo y contrato         | [DATA_MODEL](docs/DATA_MODEL.md) · [API_CONTRACT](docs/API_CONTRACT.md) |
| Requisitos y brechas      | [REQUIREMENTS](docs/REQUIREMENTS.md)                                    |
| Pruebas y evidencia       | [TESTING](docs/TESTING.md) · [EVIDENCIAS](docs/pruebas/EVIDENCIAS.md)   |
| Pipeline                  | [CICD](docs/CICD.md)                                                    |
| Rúbrica y sustentación    | [MATRIZ_RUBRICA](docs/MATRIZ_RUBRICA.md) · [DEFENSA](docs/DEFENSA.md)   |

Las fuentes originales permanecen intactas en [docs/fuentes](docs/fuentes/manifest.json).

## Comprobaciones del código

```bash
npm run lint
npm run typecheck
npm run contract
npm run build
npm run test:unit
npm run docs:check
```

`npm run check` incluye además pruebas de integración locales. Las suites de integración y E2E mantienen bases locales aisladas; no las apuntes a Atlas. Las pruebas de carga completas siguen pendientes en [RENDIMIENTO](docs/pruebas/RENDIMIENTO.md).
