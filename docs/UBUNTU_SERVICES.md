# Servicios persistentes en Ubuntu

La API, el worker y los mocks se ejecutan como tres servicios systemd independientes en EC2. El frontend se publica por separado en Azure. Esta configuración utiliza Node.js y Atlas, sin instalar Docker ni MongoDB en Ubuntu.

El [instalador](../scripts/ubuntu/install-services.sh) detecta el usuario, la carpeta del proyecto y la ruta absoluta de Node, incluida una instalación con nvm. Crea unidades `fabrica-api`, `fabrica-worker` y `fabrica-mocks`, habilita su inicio al arrancar Ubuntu y configura reinicio ante fallo. Node carga el archivo privado `.env.atlas`; las unidades no contienen contraseñas. Consulte [la referencia de servicios de Ubuntu](https://manpages.ubuntu.com/manpages/jammy/man5/systemd.service.5.html).

## Instalar en la instancia

Antes, confirme que compiló el servidor, guardó `.env.atlas` y corrigió `w=majority` en su URI. API y mocks deben haber respondido HTTP 200 en las comprobaciones manuales de [DEPLOYMENT](DEPLOYMENT.md).

1. En cada una de las tres terminales que ejecutan API, worker y mocks manualmente, pulse **Ctrl+C**. Mantenga abierta una terminal SSH para instalar los servicios.
2. Ejecute como `ubuntu`, desde el repositorio:

```bash
cd ~/proyecto-api-final
git pull --ff-only origin main
bash scripts/ubuntu/install-services.sh
```

No anteponga `sudo` al comando Bash: el instalador utiliza la instalación Node del usuario actual y ejecuta `sudo -n` solo para instalar y administrar las unidades. No abre solicitudes de contraseña: si la política existente no permite un comando, termina con error. No modifica sudoers ni crea contraseñas. No ejecuta `npm ci`, no recompila, no inicializa usuarios y no cambia `.env.atlas`, salvo su permiso de archivo a `600`. Si faltan los bundles o la configuración, termina antes de instalar.

Una versión anterior utilizaba `sudo -v`, que puede pedir contraseña aunque `sudo -n true` funcione. Si se detuvo en `[sudo: authenticate] Password:`, cancele con Ctrl+C, actualice el repositorio y ejecute de nuevo el instalador. Los mensajes `CPUAccounting ... removed ... ignored` sobre unidades del sistema son avisos y no esa solicitud de autenticación. La [documentación de sudo](https://www.sudo.ws/docs/man/1.9.14/sudoers.man.pdf) explica que la validación `-v` tiene condiciones específicas para NOPASSWD.

Si encuentra los puertos ocupados, termina sin matar procesos ni instalar las unidades. Detenga únicamente las ejecuciones manuales del proyecto. Si ya estaba usando estos servicios y desea actualizarlos, deténgalos de forma explícita antes de volver a ejecutar el instalador:

```bash
sudo -n systemctl stop fabrica-api fabrica-worker fabrica-mocks
```

Las unidades existentes se conservan con un sufijo `.backup-<fecha>` antes de sustituirse. El instalador valida las unidades con `systemd-analyze verify`, las instala y comprueba estado de procesos y respuestas HTTP de API/mocks. Un error debe revisarse; no se declara la instalación aprobada por haber descargado el script.

## Comprobar y administrar

```bash
sudo -n systemctl is-active fabrica-api fabrica-worker fabrica-mocks
sudo -n systemctl is-enabled fabrica-api fabrica-worker fabrica-mocks
curl -i http://127.0.0.1:4000/health/ready
curl -i http://127.0.0.1:4001/health/live
```

Se esperan tres estados `active`, tres `enabled` y dos respuestas HTTP 200, con los puertos predeterminados. Estos controles no prueban que el worker haya completado una solicitud; ese flujo debe comprobarse aparte. Para revisar logs, sin imprimir el archivo de configuración:

```bash
sudo -n journalctl -u fabrica-api -n 40 --no-pager
sudo -n journalctl -u fabrica-worker -n 40 --no-pager
sudo -n journalctl -u fabrica-mocks -n 40 --no-pager
```

Al cambiar código: detenga los servicios, actualice, instale dependencias si cambió el lockfile, compile backend y mocks y vuelva a iniciarlos. Si cambia la ruta de Node con nvm o mueve el repositorio, ejecute el instalador otra vez para actualizar las rutas absolutas. Cambiar `.env.atlas` requiere reiniciar los procesos que lo consumen:

```bash
sudo -n systemctl restart fabrica-mocks fabrica-api fabrica-worker
```

Puede cerrar las terminales SSH después de las comprobaciones. Una prueba posterior al reinicio de EC2 debe registrar de nuevo los estados y endpoints; el instalador no reinicia la instancia. Para detener y deshabilitar estos servicios:

```bash
sudo -n systemctl disable --now fabrica-api fabrica-worker fabrica-mocks
```

## Abrir Swagger desde Windows mediante SSH

Con la API activa puede consultar `/docs/` sin publicar su puerto. En Ubuntu, actualice el contrato y reinicie la API (el contrato se carga al arrancar):

```bash
cd ~/proyecto-api-final
git pull --ff-only origin main
sudo -n systemctl restart fabrica-api
curl -i http://127.0.0.1:4000/health/ready
```

En **PowerShell de su computadora**, sustituya la ruta por su archivo privado `.pem` y la dirección por la IP pública vigente de EC2:

```powershell
ssh -i "C:\ruta\tu-clave.pem" -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4400:127.0.0.1:4000 ubuntu@IP_PUBLICA_EC2
```

Mantenga esa terminal abierta; que no aparezca un prompt al conectar es normal con `-N`. El puerto SSH 22 debe admitir la IP pública de su computadora; la regla de EC2 Instance Connect corresponde a otro origen. No comparta el `.pem` ni abra 4000/4001 al público. Consulte la [explicación de AWS sobre el reenvío local SSH](https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-ssh-tunnel-local.html).

Abra en el navegador de Windows:

- Swagger: `http://127.0.0.1:4400/docs/`.
- Contrato: `http://127.0.0.1:4400/openapi.json`.
- Readiness: `http://127.0.0.1:4400/health/ready`.

El contrato usa el servidor relativo `/`, de modo que **Try it out** utiliza el mismo origen del túnel. Pruebe primero `GET /health/live` y `GET /health/ready`. Para operaciones protegidas, ejecute `POST /v1/auth/login` con un usuario ficticio sembrado y su contraseña de demostración; copie únicamente el valor de `token` en **Authorize**. No use la contraseña de Atlas para iniciar sesión en la aplicación. Esto prueba acceso a través del túnel; no acredita HTTPS público ni el despliegue del frontend.

## Estado y siguiente paso

Las [alertas Discord](DISCORD_ALERTS.md) utilizan un timer separado para detectar parada, recuperación y reinicios de estos tres servicios. El instalador del monitor no los detiene ni modifica sus unidades. El 24 de octubre de 2026 se comprobó el mensaje real de prueba en Discord y la captura de EC2 mostró el timer activo. Otra captura acredita los avisos de parada y recuperación después de detener e iniciar manualmente el worker. Recuperación automática ante crash y persistencia después de reiniciar EC2 siguen pendientes.

Las unidades se preparan y revisan en el repositorio; su instalación, permanencia al cerrar SSH y recuperación tras reiniciar EC2 requieren evidencia de esa instancia. No se han ejecutado esos pasos desde la computadora de desarrollo.

HTTPS y reverse proxy siguen en [DEPLOYMENT](DEPLOYMENT.md). Mantenga los puertos internos privados. El supervisor no configura DNS, certificados, grupos de seguridad ni el frontend Azure.
