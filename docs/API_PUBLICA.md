# API y Swagger públicos desde EC2

Guía preparada el 23 de octubre de 2026 para publicar únicamente la API y Swagger de la VM existente. El frontend conserva su destino independiente en Azure. Estos archivos son plantillas: todavía no acreditan Nginx instalado, un certificado emitido ni una URL pública verificada.

El enlace para compartir será `https://IP_PUBLICA_ACTUAL/docs/`. Cada visitante se conecta directamente a Nginx; no necesita su archivo `.pem`, un túnel SSH ni acceso a Atlas. Los endpoints protegidos conservan JWT y permisos por rol. Solo se utilizan datos ficticios `DEMO-`.

La ruta es navegador → HTTPS 443 → Nginx → Fastify en `127.0.0.1:4000`. Los puertos 4000/4001 permanecen cerrados al público. Las [plantillas de Nginx](../scripts/ubuntu/nginx-api-https.conf) no sirven el repositorio ni el archivo `.env.atlas`.

## Condiciones

- API, worker y mocks activos según [UBUNTU_SERVICES](UBUNTU_SERVICES.md), y readiness HTTP 200 dentro de EC2.
- IP pública actual de esa misma VM y puertos 80/443 accesibles desde Internet. Conservar el acceso administrativo por EC2 Instance Connect.
- Finalizar con Ctrl+C la **escucha SSH temporal en 443** en la terminal donde se inició, o esperar su vencimiento. HTTPS y ese proceso no pueden ocupar 443 simultáneamente. No detener el servicio SSH normal del puerto 22.
- Ejecutar los comandos siguientes **en Ubuntu de AWS**, desde `~/proyecto-api-final`, por etapas. Detenerse si un comando falla.
- No reservar una Elastic IP, crear balanceadores ni contratar DNS para seguir esta guía. AWS puede cobrar por la VM, EBS e IPv4 según la cuenta; esto no garantiza Free Tier ni costo cero.

Let’s Encrypt ofrece certificados gratuitos para IP. Certbot necesita versión **5.4 o superior** para el método webroot utilizado aquí; los certificados de IP duran aproximadamente seis días y requieren renovación automática. El plugin `--nginx` no se utiliza para emitir este certificado. Consulte [Let’s Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) y la [instalación oficial de Certbot](https://certbot.eff.org/instructions?ws=nginx&os=snap).

## 1. Instalar las herramientas

```bash
cd ~/proyecto-api-final
git pull --ff-only origin main
sudo -n apt-get update
sudo -n apt-get install -y nginx snapd
sudo -n snap install --classic certbot
/snap/bin/certbot --version
```

Si el snap de Certbot ya está instalado, consulte su versión y use `sudo -n snap refresh certbot` si es necesario. Si existe una instalación anterior de Nginx que sirve otros sitios o un Certbot de otro gestor, revise esa configuración antes de sustituirla. Esta guía conserva el sitio predeterminado de Ubuntu y añade un sitio cuyo `server_name` coincide exactamente con la IP.

## 2. Preparar HTTP exclusivamente para validar el certificado

Sustituya el marcador entre comillas por la IPv4 pública actual que muestra EC2. Mantenga esta variable en la misma terminal para el resto de los pasos:

```bash
export API_IPV4='REEMPLAZAR_CON_IP_PUBLICA_ACTUAL'
sudo -n install -d -m 755 /var/lib/fabrica-acme/.well-known/acme-challenge
sed "s/__PUBLIC_IPV4__/$API_IPV4/g" scripts/ubuntu/nginx-api-bootstrap.conf > /tmp/fabrica-api-bootstrap.conf
```

Antes de instalar un sitio del proyecto que ya exista, conserve una copia:

```bash
if sudo -n test -e /etc/nginx/sites-available/fabrica-api; then
  sudo -n cp -a /etc/nginx/sites-available/fabrica-api "/etc/nginx/sites-available/fabrica-api.backup-$(date +%Y%m%d-%H%M%S)"
fi
sudo -n install -m 644 /tmp/fabrica-api-bootstrap.conf /etc/nginx/sites-available/fabrica-api
if ! sudo -n test -e /etc/nginx/sites-enabled/fabrica-api; then
  sudo -n ln -s /etc/nginx/sites-available/fabrica-api /etc/nginx/sites-enabled/fabrica-api
fi
sudo -n nginx -t
```

Solo si la validación pasa:

```bash
sudo -n systemctl enable --now nginx
sudo -n systemctl reload nginx
```

Compruebe la ruta de validación con un archivo ficticio:

```bash
printf 'acme-ready\n' | sudo -n tee /var/lib/fabrica-acme/.well-known/acme-challenge/comprobacion > /dev/null
curl -fsS "http://$API_IPV4/.well-known/acme-challenge/comprobacion"
```

Debe devolver `acme-ready`. Compruebe también esa misma URL desde el navegador de su computadora: un resultado desde la VM no prueba acceso externo. El resto de HTTP responde 503 hasta habilitar HTTPS; no se publica el login sin cifrar. Si no conecta, revise primero el puerto 80 y Nginx.

## 3. Solicitar el certificado de IP

```bash
sudo -n /snap/bin/certbot certonly \
  --webroot --webroot-path /var/lib/fabrica-acme \
  --preferred-profile shortlived \
  --cert-name fabrica-api \
  --ip-address "$API_IPV4"
```

Certbot puede solicitar un correo y la aceptación de los términos de Let’s Encrypt. El titular debe leer y responder esas preguntas en su terminal; la guía no acepta los términos automáticamente. No solicita la contraseña de Atlas. Si falla la validación, revise el error antes de repetir; evite solicitudes repetidas innecesarias. Un certificado de staging no es confiable para visitantes.

Confirme que se emitió para esa IP:

```bash
sudo -n /snap/bin/certbot certificates --cert-name fabrica-api
```

## 4. Habilitar HTTPS y renovación

```bash
sudo -n cp -a /etc/nginx/sites-available/fabrica-api /etc/nginx/sites-available/fabrica-api.bootstrap-backup
sed "s/__PUBLIC_IPV4__/$API_IPV4/g" scripts/ubuntu/nginx-api-https.conf > /tmp/fabrica-api-https.conf
sudo -n install -m 644 /tmp/fabrica-api-https.conf /etc/nginx/sites-available/fabrica-api
sudo -n nginx -t
```

Si falla `nginx -t`, el proceso activo conserva la configuración anterior: no recargue. Restaure `/etc/nginx/sites-available/fabrica-api.bootstrap-backup` sobre el archivo del sitio y vuelva a validar antes de recargar.

Solo si pasa:

```bash
sudo -n systemctl reload nginx
sudo -n install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo -n install -m 755 scripts/ubuntu/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/fabrica-nginx
sudo -n systemctl list-timers --all 'snap.certbot.renew*'
sudo -n /snap/bin/certbot renew --cert-name fabrica-api --dry-run --run-deploy-hooks
```

Confirme que el temporizador de renovación aparece programado y que la prueba termina correctamente. Si falta, revise `sudo -n systemctl status snap.certbot.renew.timer --no-pager`; debe quedar habilitado antes de considerar listo el servicio. El hook valida Nginx y lo recarga tras cada renovación exitosa. Certbot documenta [renovaciones y deploy hooks](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

## 5. Verificar y compartir

```bash
curl -i "https://$API_IPV4/health/ready"
curl -I "https://$API_IPV4/docs/"
curl -I "http://$API_IPV4/docs/"
```

Se esperan readiness 200, Swagger 200 y redirección HTTP 308 a HTTPS. No use `-k`: ocultaría errores de confianza del certificado. Compruebe además desde una computadora externa y registre la URL y el resultado real antes de declararlo publicado.

Comparta `https://IP_PUBLICA_ACTUAL/docs/`. El visitante puede probar `GET /health/ready` sin iniciar sesión. Para operaciones protegidas, usará un usuario ficticio de aplicación, ejecutará `POST /v1/auth/login` y pegará el valor de `token` en Authorize. Nunca comparta la clave `.pem`, `.env.atlas`, contraseñas de Atlas ni secretos JWT/HMAC. Crear un usuario diferente por probador no está automatizado por esta guía.

Swagger y API comparten origen y el contrato usa `/`; no necesitan habilitar CORS con `*`. El frontend Azure requerirá posteriormente su origen exacto en CORS y la URL HTTPS real en Vite/CSP. Fastify aún contabiliza las peticiones sin autenticar por la IP del proxy, ya que no confía en cabeceras reenviadas: ese límite es compartido entre visitantes. Las peticiones autenticadas se limitan por usuario. No se modifica este comportamiento en estas plantillas.

## Apagado, cambio de IP y límites

Los servicios del proyecto y Nginx administrados por systemd pueden iniciar al arrancar Ubuntu; el acceso depende de que la VM esté encendida. Detener/iniciar EC2 puede cambiar la IPv4 pública. Un certificado para la IP anterior no acredita la nueva: actualice `API_IPV4`, el sitio y el certificado antes de compartir el enlace nuevo. No desactive la validación TLS para ocultar ese cambio. Un dominio propio puede simplificar el nombre público en una preparación posterior, pero no es requisito de esta ruta.

Estas plantillas se revisan localmente; `nginx -t`, emisión, renovación, disponibilidad externa y un recorrido funcional desde otra computadora requieren validación en la VM. No prueban SLA, rendimiento ni disponibilidad permanente. Consulte la [guía oficial de Nginx para reverse proxy](https://nginx.org/en/docs/beginners_guide.html#proxy).
