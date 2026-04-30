#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="${DESIGNCAD_REPO:-exzile/DesignCAD}"
port="${DESIGNCAD_UPDATER_PORT:-8787}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl nginx rsync unzip

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

install -d -m 755 /opt/designcad/updater
install -m 755 "$repo_root/scripts/designcad-updater.mjs" /opt/designcad/updater/designcad-updater.mjs
install -d -m 700 /etc/designcad-updater
install -d -m 755 /var/lib/designcad-updater
install -d -m 755 /var/www/designcad

if [[ ! -f /etc/designcad-updater/token ]]; then
  openssl rand -hex 24 > /etc/designcad-updater/token
  chmod 600 /etc/designcad-updater/token
fi

cat > /etc/designcad-updater/updater.env <<ENV
DESIGNCAD_REPO=$repo
DESIGNCAD_UPDATER_HOST=127.0.0.1
DESIGNCAD_UPDATER_PORT=$port
DESIGNCAD_WEB_ROOT=/var/www/designcad
DESIGNCAD_STATE_FILE=/var/lib/designcad-updater/state.json
DESIGNCAD_TOKEN_FILE=/etc/designcad-updater/token
ENV
chmod 600 /etc/designcad-updater/updater.env

cat > /etc/systemd/system/designcad-updater.service <<'UNIT'
[Unit]
Description=DesignCAD self-updater
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/designcad-updater/updater.env
ExecStart=/usr/bin/node /opt/designcad/updater/designcad-updater.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

python3 - <<'PY'
from pathlib import Path
path = Path('/etc/nginx/sites-available/designcad')
text = path.read_text()
block = """    location /api/update/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 900s;
    }

"""
if 'location /api/update/' not in text:
    marker = '    location /assets/ {'
    if marker in text:
        text = text.replace(marker, block + marker)
    else:
        text = text.replace('}\n', block + '}\n', 1)
    path.write_text(text)
PY

nginx -t
systemctl daemon-reload
systemctl enable --now designcad-updater
systemctl reload nginx

echo "Updater installed."
echo "Updater key: $(cat /etc/designcad-updater/token)"
