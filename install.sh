#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/auto-video-gen"
SERVICE="auto-video-gen"
RUN_USER="autovideo"
RUN_GROUP="autovideo"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
    echo "Vui long chay bang sudo: sudo bash install.sh"
    exit 1
fi

echo "=========================================="
echo " Auto Video Gen 2.7.0 - Fresh Install"
echo "=========================================="

echo "[1/9] Cai dependency he thong..."
apt-get update
apt-get install -y \
    ca-certificates \
    curl \
    git \
    ffmpeg \
    rsync \
    unzip \
    build-essential

echo "[2/9] Cai Node.js 22..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

echo "Node: $(node -v)"
echo "npm : $(npm -v)"
echo "FFmpeg: $(ffmpeg -version | head -n 1)"

echo "[3/9] Tao user runtime..."
if ! id "$RUN_USER" >/dev/null 2>&1; then
    useradd \
        --system \
        --home "$APP_ROOT" \
        --shell /usr/sbin/nologin \
        "$RUN_USER"
fi

echo "[4/9] Tao cau truc thu muc..."
mkdir -p \
    "$APP_ROOT/base" \
    "$APP_ROOT/dashboard" \
    "$APP_ROOT/data" \
    "$APP_ROOT/downloads" \
    "$APP_ROOT/output" \
    "$APP_ROOT/base/output" \
    "$APP_ROOT/branding" \
    "$APP_ROOT/backups"

echo "[5/9] Cai Base Video Engine..."
rsync -a --delete \
    --exclude='node_modules/' \
    --exclude='output/' \
    --exclude='.git/' \
    --exclude='.env' \
    --exclude='.env.local' \
    "$REPO_ROOT/base/" \
    "$APP_ROOT/base/"

cd "$APP_ROOT/base"
npm install --omit=dev --no-audit --no-fund

echo "[6/9] Cai Dashboard 2.7.0..."
rsync -a --delete \
    --exclude='.env.local' \
    "$REPO_ROOT/app/" \
    "$APP_ROOT/dashboard/"

if [ ! -f "$APP_ROOT/dashboard/.env.local" ]; then
    if [ -f "$APP_ROOT/dashboard/.env.example" ]; then
        cp "$APP_ROOT/dashboard/.env.example" \
           "$APP_ROOT/dashboard/.env.local"
    else
        touch "$APP_ROOT/dashboard/.env.local"
    fi
fi

cd "$APP_ROOT/dashboard"
npm install --omit=dev --no-audit --no-fund
npm run check

echo "[7/9] Phan quyen..."
chown -R root:root \
    "$APP_ROOT/base" \
    "$APP_ROOT/dashboard"

for dir in \
    "$APP_ROOT/data" \
    "$APP_ROOT/downloads" \
    "$APP_ROOT/output" \
    "$APP_ROOT/base/output" \
    "$APP_ROOT/branding" \
    "$APP_ROOT/backups"
do
    chown -R "$RUN_USER:$RUN_GROUP" "$dir"
    chmod -R u+rwX,g+rwX "$dir"
done

chown "$RUN_USER:$RUN_GROUP" \
    "$APP_ROOT/dashboard/.env.local"

chmod 600 "$APP_ROOT/dashboard/.env.local"

echo "[8/9] Tao systemd service..."
cat > "/etc/systemd/system/${SERVICE}.service" <<SERVICEEOF
[Unit]
Description=Auto Video Gen Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${APP_ROOT}/dashboard
EnvironmentFile=-${APP_ROOT}/dashboard/.env.local
ExecStart=/usr/bin/node ${APP_ROOT}/dashboard/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${APP_ROOT}

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable "$SERVICE"

echo "[9/9] Khoi dong Auto Video Gen..."
systemctl restart "$SERVICE"

sleep 3

if systemctl is-active --quiet "$SERVICE"; then
    IP_ADDR="$(hostname -I | awk '{print $1}')"

    echo
    echo "=========================================="
    echo " CAI DAT THANH CONG"
    echo "=========================================="
    echo "Version : Auto Video Gen 2.7.0"
    echo "Service : active (running)"
    echo "URL     : http://${IP_ADDR}:3080"
    echo
    echo "Kiem tra:"
    echo "  systemctl status ${SERVICE}"
    echo
    echo "Log:"
    echo "  journalctl -u ${SERVICE} -f"
    echo
    echo "Sau do mo Dashboard va cau hinh AI + Voice."
else
    echo
    echo "ERROR: Service khong khoi dong."
    echo "Kiem tra:"
    echo "journalctl -u ${SERVICE} -n 100 --no-pager"
    exit 1
fi
