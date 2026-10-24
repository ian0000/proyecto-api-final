# Alertas de procesos en Discord

El monitor observa los servicios `fabrica-api`, `fabrica-worker` y `fabrica-mocks` de EC2. Utiliza un timer systemd independiente: no añade llamadas a Discord al procesamiento de créditos ni retrasa el reinicio de la API. Esta implementación adapta el objetivo de alertas del laboratorio al supervisor systemd del proyecto.

## Comportamiento

- Comprueba los procesos unos 30 segundos después de terminar cada ejecución. La planificación y la duración de la consulta pueden añadir demora; no es una garantía de alerta instantánea.
- Notifica una vez cuando un servicio pasa a detenido/no disponible y una vez cuando se recupera.
- Detecta reinicios mediante `NRestarts` o el cambio de `InvocationID`, incluso si el proceso volvió a estar activo entre dos consultas. No reconstruye todas las transiciones que ocurrieron entre consultas.
- No envía mensajes en cada sondeo si los tres servicios siguen sin cambios.
- La primera observación de servicios sanos establece una referencia silenciosa. Si alguno ya está detenido, genera su aviso inicial.
- Los mensajes incluyen servicio, estado, hora y un identificador del evento. No incluyen logs de la aplicación, datos de clientes, hostname, IP, contraseñas ni tokens. Las menciones automáticas están desactivadas.

Los [eventos y envíos](../scripts/ubuntu/discord-monitor.js) se conservan antes de enviar en `/var/lib/fabrica-discord/state.json`, con permisos privados. Se mantiene una cola de hasta 100 eventos; si se supera, el siguiente mensaje informa cuántos antiguos se omitieron. Se envían lotes de hasta cinco por ejecución. No existe una retención ilimitada.

Se usa HTTPS al dominio oficial de Discord, sin seguir redirecciones, y `wait=true` para exigir confirmación del mensaje. Un timeout conserva el lote para un sondeo posterior; no provoca un bucle de reintentos. HTTP 429 respeta `Retry-After` o `retry_after`; un webhook rechazado espera más antes de reintentar. Si Discord aceptó un mensaje pero se perdió la respuesta, puede haber duplicados con el mismo identificador: no se promete entrega exactamente una vez. Véanse [webhooks](https://docs.discord.com/developers/resources/webhook) y [rate limits](https://docs.discord.com/developers/topics/rate-limits).

## Preparar el canal

En Discord, crear un canal de texto para alertas dentro del servidor del grupo. En **Editar canal → Integraciones → Webhooks**, crear el webhook y copiar su URL. Esa URL permite publicar en el canal: no se pega en el chat, GitHub, archivos de documentación ni comandos con argumentos visibles.

## Instalar en EC2

Requiere los tres servicios existentes, Node 22.16 o superior y acceso `sudo -n` de la instalación Ubuntu actual. Ejecutar como `ubuntu`, **sin `sudo` delante del script**, en la terminal de EC2:

```bash
cd ~/proyecto-api-final
git pull --ff-only origin main
bash scripts/ubuntu/install-discord-monitor.sh
```

Detenerse si un comando falla. El [instalador](../scripts/ubuntu/install-discord-monitor.sh) pide la URL con entrada oculta. Pegarla únicamente cuando aparezca esa solicitud y pulsar Enter; no se mostrará en pantalla ni quedará como comando del historial. Si ya existe una configuración, Enter vacío la conserva. No ejecutar con trazado `bash -x` ni grabar una sesión que muestre el secreto.

El instalador copia el monitor a `/opt/fabrica-credito-monitor/discord-monitor.mjs` y guarda la URL en `/etc/fabrica-credito/discord.env`, propiedad de root y modo `600`, dentro de un directorio `700`. systemd carga el secreto únicamente para el monitor, ejecutado como el usuario de Ubuntu. No modifica `.env.atlas` ni reinicia API, worker o mocks.

Instala `fabrica-discord@.service` y `fabrica-discord-monitor.timer`. Primero ejecuta `fabrica-discord@test.service`, que debe publicar **PRUEBA DE ALERTAS** y recibir un identificador de confirmación de Discord. Solo después habilita el timer. Al cambiar la ruta de Node con nvm, ejecutar otra vez el instalador para actualizarla.

## Comprobar la instalación

```bash
systemctl is-active fabrica-discord-monitor.timer
systemctl list-timers fabrica-discord-monitor.timer --no-pager
sudo -n systemctl start fabrica-discord@test.service
sudo -n journalctl -u fabrica-discord@monitor.service -n 30 --no-pager
```

El timer debe estar `active`; el servicio oneshot puede estar `inactive` entre ejecuciones y eso es normal. Los logs del monitor contienen resultados de envío sanitizados, nunca el webhook ni cuerpos de respuestas de Discord. Un fallo al consultar systemd o leer el estado se registra localmente y no se convierte en una falsa entrega aprobada.

Para una demostración deliberada de parada y recuperación, detener **solo el worker** en una ventana de pruebas: las solicitudes podrán quedar en espera mientras esté detenido. Después de ver su alerta, volver a iniciarlo. No confundir una parada intencional con un crash: `Restart=on-failure` respeta `systemctl stop`.

```bash
sudo -n systemctl stop fabrica-worker
# Esperar el aviso SERVICIO DETENIDO en Discord.
sudo -n systemctl start fabrica-worker
# Esperar SERVICIO RECUPERADO y comprobar el estado.
systemctl is-active fabrica-worker
```

Para pausar los avisos durante mantenimiento:

```bash
sudo -n systemctl stop fabrica-discord-monitor.timer
# Al terminar el mantenimiento:
sudo -n systemctl start fabrica-discord-monitor.timer
```

La siguiente ejecución puede informar cambios de proceso ocurridos durante la pausa. Para deshabilitar el monitor al arrancar, usar `sudo -n systemctl disable --now fabrica-discord-monitor.timer`. No borrar la configuración privada o el estado para ocultar errores; revisar antes la causa. Un webhook expuesto debe revocarse en Discord y sustituirse mediante el instalador.

## Evidencia y límites

`npm run test:ops` ejecuta pruebas locales con servicios y respuestas HTTP ficticios: caídas, recuperación, reinicios, persistencia antes del envío, timeout, rate limiting, silencio sin cambios, límite de cola y errores sin secretos. CI incluye estas pruebas y la revisión sintáctica del instalador. Las pruebas locales no contactan Discord ni prueban una instalación en EC2.

Activación comprobada el 24 de octubre de 2026: la captura de la terminal EC2 aportada por el usuario muestra «Discord confirmó el mensaje de prueba y el timer está activo». Se observó directamente en Discord el servidor **Fábrica de Crédito**, canal **#alertas-fabrica-credito**, con mensajes **PRUEBA DE ALERTAS** del webhook **Fábrica Monitor**. El [último mensaje de prueba observado](https://discord.com/channels/1563551511357825094/1563551835942297678/1563557882383826974) corresponde a las 09:20:48 de Ecuador (14:20:48 UTC); requiere acceso al servidor. Las ejecuciones repetidas del instalador generaron pruebas separadas.

Las 13 pruebas locales y todos los jobs de [CI del cambio 1900aa6](https://github.com/ian0000/proyecto-api-final/actions/runs/40101707818) pasaron. La entrega real del mensaje de prueba está verificada; la detección remota de una parada, recuperación o reinicio sigue pendiente de una demostración controlada. Tampoco se ha comprobado la persistencia del timer tras reiniciar EC2.

Este monitor depende de que EC2 esté encendida y tenga salida a Discord. **No puede avisar de la caída completa de la misma VM o de su desconexión total.** Tampoco comprueba disponibilidad externa de Azure/Nginx, readiness de Atlas, latencia ni el flujo bancario. Para esos objetivos se necesita monitoreo independiente. No sustituye políticas de logs, backups, escalamiento ni una medición de SLA.
