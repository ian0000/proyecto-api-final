# Atlas existente y Ubuntu sin Docker

Esta guía conecta API, worker y mocks con un clúster Atlas existente. Compass es un cliente para consultar esa misma base; no sustituye al servidor MongoDB. No hace falta instalar MongoDB ni Docker en Ubuntu. Fastify ya está incluido en las dependencias.

**Estado verificado el 22 de octubre de 2026:** el clúster existente está activo. El usuario `fabrica-credito-test` fue creado por el usuario y sus permisos se comprobaron en Atlas: `readWrite` sobre `credito_test` y `credito_test_mocks`, limitado al clúster elegido. La configuración privada `.env.atlas` está completa en la computadora de desarrollo. Pasaron la conexión de solo lectura, el seed de usuarios e índices y el flujo funcional API/worker/mocks con Atlas. Véase [la evidencia específica](pruebas/ATLAS.md). **La conexión desde EC2 y los despliegues AWS/Azure siguen pendientes de comprobar.** No se creó un clúster ni cambió su capacidad.

## 1. Acceso al clúster existente

En el proyecto Atlas correcto, configure un usuario de base de datos exclusivo de la aplicación con los siguientes permisos:

| Base                 | Rol         | Uso                                                   |
| -------------------- | ----------- | ----------------------------------------------------- |
| `credito_test`       | `readWrite` | Solicitudes, usuarios, auditoría y trabajos de la API |
| `credito_test_mocks` | `readWrite` | Estado de las financieras ficticias                   |

Limite además el usuario al clúster elegido si el proyecto contiene varios. No necesita `Atlas admin`, `readWriteAnyDatabase` ni permisos administrativos globales. Los usuarios de base de datos son diferentes del usuario con el que se entra a la consola Atlas. Consulte [usuarios de base de datos en Atlas](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).

El usuario proporcionó la IPv4 pública de EC2; una regla específica utiliza esa dirección con `/32`, siempre que sea la IP real de salida. Si EC2 sale mediante NAT, corresponde la IP del NAT. **La lista de Atlas ya tenía una regla `0.0.0.0/0`**, que cubre esa IP; no se añadió ni modificó porque el clúster se comparte con otros usos. Esta regla existente permite intentos de conexión desde cualquier origen; no equivale a acceso autenticado ni demuestra conectividad desde EC2. Antes de restringirla, identifique los demás clientes para no interrumpirlos. La ruta recomendada es permitir solo las IP de salida necesarias con `/32`, incluida por separado la de Compass. Una IP dinámica puede cambiar tras detener y arrancar EC2. Véase [lista de acceso IP](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

Desde Connect → Drivers copie la URI del clúster, mantenga TLS y utilice el usuario de aplicación. Los caracteres especiales del usuario o contraseña deben codificarse para una URI. No publique la cadena ni la pegue en mensajes o capturas. Consulte [conexión a Atlas](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## 2. Preparar el proyecto en Ubuntu

Desde la raíz del repositorio, con **Node.js 22.16 o superior**, npm y Git instalados:

```bash
node --version
npm ci
npm run atlas:init
chmod 600 .env.atlas
nano .env.atlas
```

`atlas:init` conserva un `.env.atlas` existente. Si falta, crea una plantilla privada con secretos aleatorios y URI pendiente; no configura el clúster. El archivo local no llega a EC2 con `git clone`: debe inicializarlo o transferir su configuración por un canal privado. Está excluido de Git.

Para usar las cuentas ya creadas en Atlas desde EC2, transfiera el archivo por SSH/SCP y ejecute `chmod 600 .env.atlas`, o complete la configuración por un canal privado. Si genera secretos nuevos, conserve el `DEMO_PASSWORD` con el que se crearon los usuarios de esa base: el seed no cambia sus contraseñas. El frontend Azure no recibe este archivo. Configure:

| Variable             | Valor o criterio                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `MONGODB_URI`        | URI privada `mongodb+srv://...` del clúster, con credenciales y TLS habilitado                 |
| `DB_NAME`            | `credito_test`                                                                                 |
| `JWT_SECRET`         | Secreto aleatorio de al menos 32 caracteres                                                    |
| `WEBHOOK_SECRET`     | Otro secreto aleatorio de al menos 32 caracteres                                               |
| `MOCK_SECRET`        | Otro secreto aleatorio de al menos 32 caracteres                                               |
| `DEMO_PASSWORD`      | Contraseña privada de al menos 12 caracteres para los usuarios demo                            |
| `MOCK_URL`           | `http://127.0.0.1:4001`                                                                        |
| `CALLBACK_URL`       | `http://127.0.0.1:4000`                                                                        |
| `PORT` / `MOCK_PORT` | `4000` / `4001`                                                                                |
| `CORS_ORIGINS`       | Origen exacto del frontend autorizado; conserve los orígenes locales solo para pruebas locales |

Las direcciones `127.0.0.1` son correctas cuando API, worker y mocks corren en **la misma instancia EC2**. Los mocks añaden `_mocks` a `DB_NAME` automáticamente: no cambie `DB_NAME` a `credito_test_mocks`. Mantenga inicialmente los demás valores de tiempos y reintentos de `.env.example`.

No imprima `.env.atlas` para depurar. Las variables ya exportadas en el proceso prevalecen sobre `--env-file`; compruebe que la terminal no tenga una configuración antigua que sustituya los valores del archivo.

## 3. Verificar antes de escribir datos

Ejecute desde EC2:

```bash
npm run atlas:check
```

El comando equivalente es `node --env-file=.env.atlas --import tsx scripts/check-atlas.ts`; ambos cargan expresamente `.env.atlas`.

El comprobador valida la URI Atlas/TLS y el nombre de la base; realiza `ping` y consulta colecciones en `credito_test` y `credito_test_mocks`, **sin crear, modificar ni eliminar datos**. Una base nueva puede devolver cero colecciones. Esta comprobación no prueba permisos de escritura ni el funcionamiento completo de la aplicación.

Antes del seed, confirme que ambas bases corresponden al entorno de pruebas acordado. Si el comprobador falla, no continúe con el seed:

- Timeout o resolución DNS: revise DNS de EC2, IP autorizada y salida de red hacia Atlas.
- Fallo de autenticación: revise el usuario de base de datos, su contraseña codificada y la URI privada.
- Fallo de autorización: revise los roles sobre **ambas** bases y la restricción de clúster.
- Fallo TLS: revise reloj y certificados del sistema; no desactive la validación TLS.

## 4. Inicializar y arrancar

El siguiente comando **sí escribe**: crea los índices del backend y los tres usuarios demo si no existen. No borra los datos existentes ni cambia la contraseña de un usuario ya creado. Ejecútelo únicamente después de validar el destino:

```bash
npm run seed:atlas
npm run build --workspace backend
npm run build --workspace mocks
```

`seed:atlas` ejecuta la comprobación readonly antes del seed y no escribe si esta falla. El comando directo de seed es `node --env-file=.env.atlas --import tsx backend/src/seed.ts`; úselo solo después de validar la conexión y el destino.

Las cuentas son `asesor@demo.test`, `supervisor@demo.test` y `administrador@demo.test`. En una base nueva usan la contraseña privada de `DEMO_PASSWORD`; la base guarda su hash scrypt.

Para una primera comprobación, abra tres terminales en la raíz del proyecto. En cada una arranque uno de estos procesos:

```bash
# Terminal 1: financieras ficticias
node --env-file=.env.atlas mocks/dist/main.js
```

```bash
# Terminal 2: API
node --env-file=.env.atlas backend/dist/main.js
```

```bash
# Terminal 3: worker
node --env-file=.env.atlas backend/dist/worker-main.js
```

`npm run seed` y `npm run dev` cargan `.env`, no `.env.atlas`. Use `npm run dev:atlas` para una sesión de desarrollo que cargue `.env.atlas` en API, worker, mocks y Vite; no es un servicio de producción. Para EC2 use los comandos compilados anteriores y supervisión. Evite ejecutar pruebas destructivas contra Atlas; las pruebas de integración y de navegador conservan sus entornos locales aislados.

## 5. Confirmación funcional y Compass

Consulte la documentación de la API desde la propia instancia en `http://127.0.0.1:4000/docs/`. Compruebe login, creación con cliente ficticio `DEMO-`, procesamiento por el worker y recepción de ofertas. En Compass, conecte con la URI privada del mismo clúster y compruebe las dos bases; no es una copia local de los datos.

La configuración de Atlas no publica por sí sola la aplicación. Para mantenerla funcionando después de cerrar SSH faltan servicios supervisados, por ejemplo systemd, y para acceso público faltan reverse proxy, HTTPS y el origen correcto del frontend. Los procesos actuales escuchan en `0.0.0.0`; mantenga los puertos `4000` y `4001` privados en el firewall y el grupo de seguridad, sin exponer los mocks. No abra un puerto MongoDB entrante en EC2 para conectarse a Atlas.

El frontend se compila y publica por separado en Azure; no necesita otro repositorio. Vea [el despliegue vigente](DEPLOYMENT.md) para `VITE_API_URL`, CSP y CORS. Registre por separado qué se comprobó: acceso a Atlas desde EC2, inicialización, flujo funcional, reinicio de procesos y HTTPS. El éxito de una etapa no demuestra las siguientes ni una disponibilidad mensual.
