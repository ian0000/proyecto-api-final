# Despliegue vigente: Ubuntu y Atlas sin Docker; frontend en Azure

**Actualización del 22 de octubre de 2026.** La ruta acordada utiliza Node.js directamente en EC2 Ubuntu, MongoDB Atlas y frontend React/Vite independiente en Azure. Docker queda como alternativa histórica conservada en el repositorio; no es un requisito de esta ruta. El contenido anterior de este documento se preservó antes de actualizarlo.

El usuario informa que EC2 ya existe. Se observó en la consola Atlas el proyecto `Project 0` con `Cluster0` activo, de tipo Free. Eso no demuestra conexión desde EC2, publicación de la API ni despliegue del frontend. La preparación concreta de Atlas y sus pendientes están en [ATLAS](ATLAS.md).

## Separación entre frontend y backend

Un repositorio contiene varios componentes; **no es necesario dividirlo en dos repositorios para desplegar frontend y backend por separado**.

| Componente            | Código      | Destino y ejecución                                                  |
| --------------------- | ----------- | -------------------------------------------------------------------- |
| Frontend React/Vite   | `frontend/` | Azure: archivos estáticos de `frontend/dist`                         |
| API Fastify           | `backend/`  | EC2 Ubuntu: `node --env-file=.env.atlas backend/dist/main.js`        |
| Worker                | `backend/`  | EC2 Ubuntu: `node --env-file=.env.atlas backend/dist/worker-main.js` |
| Financieras ficticias | `mocks/`    | EC2 Ubuntu: `node --env-file=.env.atlas mocks/dist/main.js`          |
| Persistencia          | Atlas       | `credito_test` y `credito_test_mocks`                                |
| Contrato y tipos      | `shared/`   | Compartidos durante desarrollo y compilación                         |

El backend mantiene una arquitectura de monolito modular con worker separado. El navegador consume una API HTTP y no accede a MongoDB. Azure sirve el frontend y AWS ejecuta los procesos del backend; son despliegues independientes aunque compartan monorepo y lockfile.

```text
Navegador -> Frontend HTTPS (Azure)
          -> API HTTPS (reverse proxy EC2 -> Fastify)
                            |              |
                            v              v
                          Atlas <------ Worker -> Mocks internos
                            ^                       |
                            +-----------------------+
```

API, worker y mocks comienzan en una sola instancia EC2. El worker no abre un puerto HTTP. La VM es un punto único de fallo y no tiene autoescalado configurado; la persistencia de trabajos y leases vive en Atlas. Los mocks son procesos ficticios con su propia base y contrato.

## Acceso SSH desde la consola AWS

La regla SSH con origen "Mi IP" admite conexiones desde la computadora del usuario. La terminal **EC2 Instance Connect del navegador** necesita además permitir el origen del servicio AWS: en el grupo de seguridad de la instancia, use TCP 22 y la lista administrada `com.amazonaws.<region>.ec2-instance-connect` de su región. Conserve el usuario Ubuntu `ubuntu` y confirme que la instancia esté en ejecución con sus comprobaciones de estado aprobadas. Véase [la configuración oficial de EC2 Instance Connect](https://docs.aws.amazon.com/us_en/AWSEC2/latest/UserGuide/ec2-instance-connect-tutorial.html).

Abrir HTTP 80 y HTTPS 443 no habilita SSH. Los puertos internos de este proyecto son 4000 y 4001; no requieren exposición pública. Instalar `curl` y `ca-certificates` no edita el grupo de seguridad.

## Ubuntu: dependencias y compilación

Requiere Git, **Node.js 22.16 o superior** y npm. No requiere Express, MongoDB local ni Docker: Fastify y el driver MongoDB vienen en las dependencias. Desde la raíz del repositorio:

Si falta npm, instale Node 22 con el instalador publicado por [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), desde una terminal SSH de Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o /tmp/nvm-install.sh
bash /tmp/nvm-install.sh
export NVM_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/nvm"
[ -s "$HOME/.nvm/nvm.sh" ] && export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
node --version
npm --version
```

Después, desde la carpeta del proyecto:

```bash
node --version
npm ci
npm run atlas:init
chmod 600 .env.atlas
nano .env.atlas
npm run atlas:check
```

`atlas:init` conserva un archivo existente; en un archivo nuevo genera secretos privados y deja la URI pendiente de completar. No crea usuarios ni recursos de Atlas. `atlas:check` consulta Atlas sin escribir; no sustituye un recorrido funcional. Configure la URI y permisos según [ATLAS](ATLAS.md) antes de continuar.

Después de confirmar ambas bases de pruebas, el seed **escribe índices y usuarios demo ausentes**. No cambia contraseñas existentes ni borra datos:

```bash
npm run seed:atlas
npm run build --workspace backend
npm run build --workspace mocks
```

`seed:atlas` ejecuta primero la comprobación de Atlas y solo continúa si pasa. Para una primera prueba, ejecute los tres comandos de producción de la tabla en terminales separadas. No use `dev:atlas` como servicio de producción: inicia procesos de desarrollo, incluido Vite; Azure recibirá el build estático del frontend.

Los bundles mantienen dependencias externas: conserve las dependencias instaladas en el monorepo y el lockfile. La instalación y compilación requieren dependencias de desarrollo; no ejecute inicialmente `npm ci --omit=dev`.

## Supervisión y entrada HTTPS en EC2

La configuración concreta para compartir API y Swagger está en [API_PUBLICA](API_PUBLICA.md): Nginx, certificado de IP y renovación automática. Incluye plantillas y comprobaciones; no acredita publicación hasta observar su resultado en EC2 y desde otra computadora.

Para mantener los procesos al cerrar SSH, use [el instalador de servicios Ubuntu](UBUNTU_SERVICES.md). Prepara tres unidades systemd con el usuario actual sin privilegios, la ruta absoluta de Node y `.env.atlas`, y configura reinicio ante fallo. Las unidades deben instalarse y comprobarse en EC2; disponer del script no acredita permanencia al cerrar SSH ni recuperación tras reiniciar la instancia.

Use un reverse proxy para terminar HTTPS y reenviar la API a `127.0.0.1:4000`. API y mocks actualmente escuchan en `0.0.0.0`; restrinja sus puertos con firewall y grupo de seguridad. Publique únicamente los puertos necesarios para HTTPS/HTTP y limite SSH al acceso administrativo. Mantenga `4001` privado: los mocks se comunican con la API por loopback dentro de EC2, sin necesitar un dominio público propio. Atlas requiere salida de red, no abrir un puerto MongoDB entrante en EC2.

La API expone `/health/ready` para readiness; los mocks, `/health/live`. El worker exige supervisión del proceso y seguimiento de trabajos pendientes/dead, además de comprobar que la API responda.

## Configuración privada del backend

| Variable             | Valor o criterio para esta ruta                                                  |
| -------------------- | -------------------------------------------------------------------------------- |
| `MONGODB_URI`        | URI privada Atlas con TLS; nunca incorporarla al frontend                        |
| `DB_NAME`            | `credito_test`; los mocks añaden `_mocks` automáticamente                        |
| `JWT_SECRET`         | Aleatorio, mínimo 32 caracteres                                                  |
| `WEBHOOK_SECRET`     | Mismo secreto HMAC en API y mocks; independiente del JWT                         |
| `MOCK_SECRET`        | Mismo secreto de integración en API/worker y mocks                               |
| `DEMO_PASSWORD`      | Solo inicialización de usuarios demo; mínimo 12 caracteres                       |
| `MOCK_URL`           | `http://127.0.0.1:4001`, procesos en la misma EC2                                |
| `CALLBACK_URL`       | `http://127.0.0.1:4000`, mismo valor para API/worker y mocks                     |
| `CORS_ORIGINS`       | Origen HTTPS exacto del frontend Azure, sin comodín                              |
| `PORT` / `MOCK_PORT` | `4000` / `4001`, privados detrás de controles de red                             |
| `RATE_LIMIT`         | Inicialmente 120 por minuto/identidad; no alterar para aparentar mayor capacidad |

Mantenga los tiempos de [.env.example](../.env.example); `LEASE_MS` debe superar tres timeouts de integración. `.env.atlas` está excluido de Git. Las variables exportadas en la terminal prevalecen sobre `--env-file`; evite que sustituyan inadvertidamente la configuración prevista.

## Azure: construir únicamente el frontend

La continuación del 23 de octubre está en [AZURE](AZURE.md): API AWS indicada y comprobada en `https://18.117.111.251`, build específico y publicación frontend en preparación. La publicación Azure requiere su propia verificación. Desde la raíz del repositorio, en un entorno de compilación con Node y npm:

```bash
npm ci
export VITE_API_URL='https://REPLACE_WITH_AWS_API_HOST'
npm run build:azure --workspace frontend
```

Reemplace el marcador por el **origen HTTPS real de la API**, sin añadir `/v1`: las rutas ya lo incluyen en el cliente. `VITE_API_URL` es público y queda incorporado al JavaScript al compilar. Nunca coloque URI Atlas, contraseñas ni secretos en variables `VITE_*`.

El resultado que se publica es `frontend/dist`, no el repositorio completo. Si posteriormente se configura una acción Azure para publicar un artefacto ya construido, su `app_location` corresponde a `frontend/dist` con `skip_app_build: true`, y no se configura una API de Azure Functions: Fastify vive en AWS. Esta es una indicación futura, no un workflow desplegado. Consulte [configuración de compilación de Azure](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration).

El build sustituye automáticamente en `frontend/dist/staticwebapp.config.json` el marcador de `connect-src` por ese mismo origen API. Compruebe que no quede el marcador y que el archivo esté en la raíz del artefacto. [Azure documenta esa ubicación y las cabeceras globales](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration).

Son tres ajustes distintos:

1. `VITE_API_URL` determina a dónde llama el cliente.
2. CSP `connect-src`, servida por Azure, permite al navegador conectar a la API.
3. `CORS_ORIGINS`, aplicado por Fastify, admite el origen del frontend Azure.

Ambos extremos públicos deben usar HTTPS. El proxy Vite de desarrollo no existe en el sitio estático publicado. El [preflight existente](../.github/workflows/cloud-preflight.yml) prepara un build y ajusta CSP; no provisiona ni despliega. [CI/CD](CICD.md) describe el pipeline actual.

## Pendientes y aceptación remota

1. Transferir o configurar de forma privada `.env.atlas` en EC2 y comprobar desde esa instancia el acceso a las dos bases. El usuario de aplicación, los permisos y un flujo con Atlas ya se verificaron desde desarrollo; consulte [la evidencia](pruebas/ATLAS.md).
2. Conservar la inicialización demo existente, construir API/worker/mocks en Ubuntu y confirmar Node, cuentas de acceso y SHA publicado.
3. Configurar supervisión, reverse proxy y HTTPS en EC2; validar reinicio y recuperación de trabajos persistidos.
4. Preparar el destino Azure y publicar solo el frontend, con API HTTPS, CSP y CORS coherentes.
5. Validar desde navegador: login, permisos por rol, cliente `DEMO-`, solicitud, dos financieras, ofertas, aceptación y auditoría. Confirmar HMAC y recuperación tras reinicio.
6. Registrar por separado URLs reales, resultados y pendientes. Las pruebas completas [de rendimiento](pruebas/RENDIMIENTO.md) se ejecutan deliberadamente y se documentan; no se deducen de un smoke ni de Atlas Free.

Esta actualización documental no crea recursos, DNS, reservas ni despliegues; no demuestra disponibilidad ni autoriza gastos nuevos. Revise región, capacidad y precios en las consolas antes de contratar cambios: las estimaciones históricas del corte anterior no son una cotización actual.

## Versiones y rollback

Conserve el SHA Git, lockfile y artefactos compilados de la versión anterior, incluido el frontend. Antes de modificar datos, acuerde un export/backup de las dos bases si deben preservarse. Volver a una versión de código solo es seguro si sigue siendo compatible con el esquema; detenga el worker antes de una restauración y reanúdelo considerando los leases. Un rollback de frontend no revierte Atlas.

Registre fecha, versión, causa, copia utilizada y validación posterior. Hasta completar las comprobaciones remotas correspondientes, declare cada componente como preparado, configurado o verificado según evidencia, sin atribuir un despliegue exitoso al conjunto.
