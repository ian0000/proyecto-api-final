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

No anteponga `sudo` al comando Bash: el instalador utiliza la instalación Node del usuario actual y solicita sudo solo para instalar y administrar las unidades. No ejecuta `npm ci`, no recompila, no inicializa usuarios y no cambia `.env.atlas`, salvo su permiso de archivo a `600`. Si faltan los bundles o la configuración, termina antes de instalar.

Si encuentra los puertos ocupados, termina sin matar procesos ni instalar las unidades. Detenga únicamente las ejecuciones manuales del proyecto. Si ya estaba usando estos servicios y desea actualizarlos, deténgalos de forma explícita antes de volver a ejecutar el instalador:

```bash
sudo systemctl stop fabrica-api fabrica-worker fabrica-mocks
```

Las unidades existentes se conservan con un sufijo `.backup-<fecha>` antes de sustituirse. El instalador valida las unidades con `systemd-analyze verify`, las instala y comprueba estado de procesos y respuestas HTTP de API/mocks. Un error debe revisarse; no se declara la instalación aprobada por haber descargado el script.

## Comprobar y administrar

```bash
sudo systemctl is-active fabrica-api fabrica-worker fabrica-mocks
sudo systemctl is-enabled fabrica-api fabrica-worker fabrica-mocks
curl -i http://127.0.0.1:4000/health/ready
curl -i http://127.0.0.1:4001/health/live
```

Se esperan tres estados `active`, tres `enabled` y dos respuestas HTTP 200, con los puertos predeterminados. Estos controles no prueban que el worker haya completado una solicitud; ese flujo debe comprobarse aparte. Para revisar logs, sin imprimir el archivo de configuración:

```bash
sudo journalctl -u fabrica-api -n 40 --no-pager
sudo journalctl -u fabrica-worker -n 40 --no-pager
sudo journalctl -u fabrica-mocks -n 40 --no-pager
```

Al cambiar código: detenga los servicios, actualice, instale dependencias si cambió el lockfile, compile backend y mocks y vuelva a iniciarlos. Si cambia la ruta de Node con nvm o mueve el repositorio, ejecute el instalador otra vez para actualizar las rutas absolutas. Cambiar `.env.atlas` requiere reiniciar los procesos que lo consumen:

```bash
sudo systemctl restart fabrica-mocks fabrica-api fabrica-worker
```

Puede cerrar las terminales SSH después de las comprobaciones. Una prueba posterior al reinicio de EC2 debe registrar de nuevo los estados y endpoints; el instalador no reinicia la instancia. Para detener y deshabilitar estos servicios:

```bash
sudo systemctl disable --now fabrica-api fabrica-worker fabrica-mocks
```

## Estado y siguiente paso

Las unidades se preparan y revisan en el repositorio; su instalación, permanencia al cerrar SSH y recuperación tras reiniciar EC2 requieren evidencia de esa instancia. No se han ejecutado esos pasos desde la computadora de desarrollo.

HTTPS y reverse proxy siguen en [DEPLOYMENT](DEPLOYMENT.md). Mantenga los puertos internos privados. El supervisor no configura DNS, certificados, grupos de seguridad ni el frontend Azure.
