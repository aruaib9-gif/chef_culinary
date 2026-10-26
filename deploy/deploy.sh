#!/usr/bin/env bash
# Deploys the latest code from GitHub: install, build both websites, migrate the database, restart the API.
# Run as root:  sudo bash /opt/cca/deploy/deploy.sh
set -euo pipefail
APP_DIR=/opt/cca
APP_USER=cca
source "$APP_DIR/deploy/deploy.env" # provides DOMAIN
as_app() { sudo -u "$APP_USER" -H bash -c "cd $APP_DIR && $*"; }

echo "==> Fetching the latest code"
as_app "git pull --ff-only"

echo "==> Installing dependencies"
as_app "npm ci --no-audit --no-fund"

echo "==> Building the website and the admin app"
# No API address needed: each site calls /api on its own domain and Nginx forwards it to the API.
as_app "npm run build:web"
as_app "npm run build:admin"

echo "==> Updating the database"
as_app "npm run release --workspace server"

echo "==> Restarting the API"
systemctl restart cca-api
sleep 3
if curl -fsS http://127.0.0.1:4000/api/health >/dev/null; then
  echo "API is healthy."
else
  echo "API health check failed — see: journalctl -u cca-api -n 50"
  exit 1
fi
