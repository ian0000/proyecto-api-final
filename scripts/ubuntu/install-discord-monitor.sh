#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$(uname -s)" != Linux || ! -d /run/systemd/system || "$(id -u)" == 0 ]]; then
  echo 'Ejecuta este instalador como ubuntu, sin sudo delante, desde EC2 con systemd.' >&2
  exit 1
fi
for tool in node systemctl systemd-analyze sudo; do
  command -v "$tool" >/dev/null || { echo "Falta $tool." >&2; exit 1; }
done
CREDITO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CREDITO_NODE="$(readlink -f -- "$(command -v node)")"
CREDITO_USER="$(id -un)"
if [[ ! "$CREDITO_ROOT" =~ ^/[A-Za-z0-9_./-]+$ || ! "$CREDITO_NODE" =~ ^/[A-Za-z0-9_./-]+$ || ! "$CREDITO_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo 'Las rutas y el usuario deben ser simples, sin espacios ni caracteres especiales.' >&2
  exit 1
fi
"$CREDITO_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<16))process.exit(1)' || {
  echo 'Se requiere Node 22.16 o superior.' >&2; exit 1;
}
sudo -n true
for component in api worker mocks; do
  systemctl cat "fabrica-$component.service" >/dev/null || {
    echo "Falta fabrica-$component.service; instala primero los servicios del proyecto." >&2; exit 1;
  }
done
CREDITO_TEMP="$(mktemp -d /tmp/fabrica-discord.XXXXXX)"
cleanup() {
  rm -f -- "$CREDITO_TEMP/discord.env" "$CREDITO_TEMP/fabrica-discord@.service" "$CREDITO_TEMP/fabrica-discord-monitor.timer"
  rmdir -- "$CREDITO_TEMP"
}
trap cleanup EXIT
echo 'El webhook permite escribir en tu canal. No se mostrará ni se guardará en el historial.'
if sudo -n test -f /etc/fabrica-credito/discord.env; then
  echo 'Ya existe una configuración privada; Enter conserva el webhook existente.'
fi
IFS= read -r -s -p 'Pega la URL del webhook Discord y pulsa Enter: ' CREDITO_WEBHOOK
printf '\n'
if [[ -n "$CREDITO_WEBHOOK" ]]; then
  printf '%s' "$CREDITO_WEBHOOK" | "$CREDITO_NODE" "$CREDITO_ROOT/scripts/ubuntu/discord-monitor.js" validate-stdin
  printf 'DISCORD_WEBHOOK_URL=%s\n' "$CREDITO_WEBHOOK" > "$CREDITO_TEMP/discord.env"
  unset CREDITO_WEBHOOK
  sudo -n install -d -o root -g root -m 0700 /etc/fabrica-credito
  sudo -n install -o root -g root -m 0600 "$CREDITO_TEMP/discord.env" /etc/fabrica-credito/discord.env
elif ! sudo -n test -f /etc/fabrica-credito/discord.env; then
  echo 'Falta el webhook. No se instalaron unidades ni se enviaron mensajes.' >&2; exit 1
fi
sudo -n install -d -o root -g root -m 0755 /opt/fabrica-credito-monitor
sudo -n install -o root -g root -m 0644 "$CREDITO_ROOT/scripts/ubuntu/discord-monitor.js" /opt/fabrica-credito-monitor/discord-monitor.mjs
cat > "$CREDITO_TEMP/fabrica-discord@.service" <<EOF
[Unit]
Description=Fabrica de Credito Discord %i
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$CREDITO_USER
EnvironmentFile=/etc/fabrica-credito/discord.env
ExecStart=$CREDITO_NODE /opt/fabrica-credito-monitor/discord-monitor.mjs %i
StateDirectory=fabrica-discord
StateDirectoryMode=0700
TimeoutStartSec=45
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
UMask=0077
EOF
cat > "$CREDITO_TEMP/fabrica-discord-monitor.timer" <<'EOF'
[Unit]
Description=Comprueba los procesos de Fabrica de Credito para Discord

[Timer]
OnBootSec=45s
OnUnitInactiveSec=30s
AccuracySec=1s
Unit=fabrica-discord@monitor.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify "$CREDITO_TEMP/fabrica-discord@.service" "$CREDITO_TEMP/fabrica-discord-monitor.timer"
for file in 'fabrica-discord@.service' fabrica-discord-monitor.timer; do
  sudo -n install -o root -g root -m 0644 "$CREDITO_TEMP/$file" "/etc/systemd/system/$file"
done
sudo -n systemctl daemon-reload
sudo -n systemctl start fabrica-discord@test.service
sudo -n systemctl enable --now fabrica-discord-monitor.timer
sudo -n systemctl start fabrica-discord@monitor.service
systemctl is-active --quiet fabrica-discord-monitor.timer
echo 'Discord confirmó el mensaje de prueba y el timer está activo.'
echo 'La API, el worker y los mocks no se detuvieron ni reiniciaron.'
