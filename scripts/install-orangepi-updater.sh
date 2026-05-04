#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="${CINDR3D_REPO:-exzile/Cindr3D}"
port="${CINDR3D_UPDATER_PORT:-8787}"

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

install -d -m 755 /opt/cindr3d/updater
install -m 755 "$repo_root/scripts/cindr3d-updater.mjs" /opt/cindr3d/updater/cindr3d-updater.mjs
install -d -m 700 /etc/cindr3d-updater
install -d -m 755 /var/lib/cindr3d-updater
install -d -m 755 /var/www/cindr3d

if [[ ! -f /etc/cindr3d-updater/token ]]; then
  openssl rand -hex 24 > /etc/cindr3d-updater/token
  chmod 600 /etc/cindr3d-updater/token
fi

cat > /etc/cindr3d-updater/updater.env <<ENV
CINDR3D_REPO=$repo
CINDR3D_UPDATER_HOST=127.0.0.1
CINDR3D_UPDATER_PORT=$port
CINDR3D_WEB_ROOT=/var/www/cindr3d
CINDR3D_STATE_FILE=/var/lib/cindr3d-updater/state.json
CINDR3D_TOKEN_FILE=/etc/cindr3d-updater/token
ENV
chmod 600 /etc/cindr3d-updater/updater.env

cat > /etc/systemd/system/cindr3d-updater.service <<'UNIT'
[Unit]
Description=Cindr3D self-updater
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/cindr3d-updater/updater.env
ExecStart=/usr/bin/node /opt/cindr3d/updater/cindr3d-updater.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

python3 - <<'PY'
from pathlib import Path
path = Path('/etc/nginx/sites-available/cindr3d')
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
systemctl enable --now cindr3d-updater
systemctl reload nginx

echo "Updater installed."
echo "Updater key: $(cat /etc/cindr3d-updater/token)"
