#!/usr/bin/env bash
set -euo pipefail

# Run as the Ubuntu user that owns the checkout and its NVM installation.
if [[ "$(uname -s)" != Linux ]] || [[ ! -d /run/systemd/system ]]; then
  echo 'Este instalador requiere Ubuntu/Linux con systemd.' >&2
  exit 1
fi
if [[ "$(id -u)" == 0 ]]; then
  echo 'Ejecuta bash scripts/ubuntu/install-services.sh como ubuntu, sin sudo delante.' >&2
  exit 1
fi
for tool in node curl ss systemctl systemd-analyze sudo; do
  if ! command -v "$tool" >/dev/null; then
    echo "Falta el comando requerido: $tool" >&2
    exit 1
  fi
done

CREDITO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CREDITO_NODE="$(readlink -f -- "$(command -v node)")"
CREDITO_USER="$(id -un)"
# Paths enter systemd directives, not a shell. Reject whitespace/specifiers.
if [[ ! "$CREDITO_ROOT" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
   [[ ! "$CREDITO_NODE" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
   [[ ! "$CREDITO_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo 'Usa una ruta y un usuario simples, sin espacios ni caracteres especiales.' >&2
  exit 1
fi
cd -- "$CREDITO_ROOT"
"$CREDITO_NODE" -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<16))process.exit(1)' || {
  echo 'Se requiere Node.js 22.16 o superior en esta terminal.' >&2
  exit 1
}
for file in .env.atlas backend/dist/main.js backend/dist/worker-main.js mocks/dist/main.js; do
  if [[ ! -f "$file" ]]; then
    echo "Falta $file; prepara la configuracion o compila el servidor primero." >&2
    exit 1
  fi
done
CREDITO_API_PORT="$("$CREDITO_NODE" -p 'require("node:util").parseEnv(require("node:fs").readFileSync(".env.atlas","utf8")).PORT || "4000"')"
CREDITO_MOCK_PORT="$("$CREDITO_NODE" -p 'require("node:util").parseEnv(require("node:fs").readFileSync(".env.atlas","utf8")).MOCK_PORT || "4001"')"
if [[ "$CREDITO_API_PORT" == "$CREDITO_MOCK_PORT" ]]; then
  echo 'PORT y MOCK_PORT deben ser diferentes.' >&2
  exit 1
fi
for port in "$CREDITO_API_PORT" "$CREDITO_MOCK_PORT"; do
  if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || ((10#$port < 1 || 10#$port > 65535)); then
    echo 'PORT y MOCK_PORT deben ser puertos TCP validos.' >&2
    exit 1
  fi
  if [[ -n "$(ss -H -ltn "sport = :$port")" ]]; then
    echo "Puerto $port ocupado. Deten los procesos manuales con Ctrl+C antes de instalar." >&2
    echo 'Si ya usas estos servicios, detenlos con sudo systemctl stop fabrica-api fabrica-worker fabrica-mocks.' >&2
    exit 1
  fi
done

chmod 600 .env.atlas
CREDITO_UNITS="$(mktemp -d /tmp/fabrica-credito-units.XXXXXX)"
cleanup() {
  rm -f -- "$CREDITO_UNITS/fabrica-api.service" "$CREDITO_UNITS/fabrica-worker.service" "$CREDITO_UNITS/fabrica-mocks.service"
  rmdir -- "$CREDITO_UNITS"
}
trap cleanup EXIT
for component in api worker mocks; do
  case "$component" in
    api) entry=backend/dist/main.js ;;
    worker) entry=backend/dist/worker-main.js ;;
    mocks) entry=mocks/dist/main.js ;;
  esac
  cat > "$CREDITO_UNITS/fabrica-$component.service" <<EOF
[Unit]
Description=Fabrica de Credito $component
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$CREDITO_USER
WorkingDirectory=$CREDITO_ROOT
ExecStart=$CREDITO_NODE --env-file=.env.atlas $entry
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
done

systemd-analyze verify "$CREDITO_UNITS/"*.service
sudo -v
CREDITO_BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
for component in api worker mocks; do
  target="/etc/systemd/system/fabrica-$component.service"
  if sudo test -e "$target"; then
    sudo cp -p -- "$target" "$target.backup-$CREDITO_BACKUP_STAMP"
  fi
  sudo install -o root -g root -m 0644 "$CREDITO_UNITS/fabrica-$component.service" "$target"
done
sudo systemctl daemon-reload
sudo systemctl enable --now fabrica-mocks.service fabrica-api.service fabrica-worker.service
for service in fabrica-mocks fabrica-api fabrica-worker; do
  if ! sudo systemctl is-active --quiet "$service"; then
    echo "Revisa los logs: sudo journalctl -u $service -n 40 --no-pager" >&2
    exit 1
  fi
done
curl --fail --silent --show-error --retry 8 --retry-delay 2 --retry-connrefused --max-time 5 \
  "http://127.0.0.1:$CREDITO_API_PORT/health/ready" >/dev/null
curl --fail --silent --show-error --retry 8 --retry-delay 2 --retry-connrefused --max-time 5 \
  "http://127.0.0.1:$CREDITO_MOCK_PORT/health/live" >/dev/null
echo 'Servicios habilitados para el arranque. API y mocks respondieron correctamente.'
echo 'Comprueba el worker: sudo systemctl status fabrica-worker --no-pager'
