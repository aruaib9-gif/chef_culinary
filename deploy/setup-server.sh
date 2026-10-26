#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS (e.g. Hostinger KVM 1/2) for The Chefs Culinary Academy.
# Installs Node 22, PostgreSQL, Nginx, HTTPS certificates, the firewall, the app, its service, daily jobs and backups.
#
# Run as root, after your domain's DNS points at this server:
#   DOMAIN=thechefsculinaryacademy.com EMAIL=you@example.com \
#   SEED_ADMIN_EMAIL=admin@chefsculinary.com SEED_ADMIN_PASSWORD='your-password' \
#   bash setup-server.sh
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=thechefsculinaryacademy.com}"
: "${EMAIL:?Set EMAIL (used for HTTPS certificate expiry notices)}"
: "${SEED_ADMIN_EMAIL:?Set SEED_ADMIN_EMAIL (first super admin)}"
: "${SEED_ADMIN_PASSWORD:?Set SEED_ADMIN_PASSWORD (at least 10 characters)}"
REPO="${REPO:-https://github.com/aruaib9-gif/chef_culinary.git}"
APP_USER=cca
APP_DIR=/opt/cca
SKIP_CERT="${SKIP_CERT:-0}" # set to 1 to skip HTTPS (e.g. DNS not ready yet)

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

step "Updating the system and installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y curl git ufw nginx postgresql postgresql-contrib certbot python3-certbot-nginx unattended-upgrades openssl

step "Installing Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

step "Turning on automatic security updates and the firewall"
dpkg-reconfigure -f noninteractive unattended-upgrades
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

step "Creating the app user"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "/home/$APP_USER" --shell /bin/bash "$APP_USER"

step "Downloading the code"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

step "Creating the database"
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chefs_academy') THEN
        CREATE ROLE chefs_academy LOGIN PASSWORD '$DB_PASS';
      ELSE
        ALTER ROLE chefs_academy PASSWORD '$DB_PASS';
      END IF; END \$\$;"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'chefs_academy'" | grep -q 1 \
    || sudo -u postgres createdb -O chefs_academy chefs_academy

  step "Writing the server settings ($ENV_FILE)"
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://chefs_academy:$DB_PASS@127.0.0.1:5432/chefs_academy
DATABASE_SSL=false
JWT_SECRET=$(openssl rand -hex 32)
WEB_URL=https://$DOMAIN
ADMIN_URL=https://admin.$DOMAIN
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://admin.$DOMAIN
SEED_ADMIN_EMAIL=$SEED_ADMIN_EMAIL
SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD"

# Fill these in, then run: sudo systemctl restart cca-api
PAYSTACK_SECRET_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=The Chefs Culinary Academy <no-reply@$DOMAIN>
ADMIN_NOTIFY_EMAILS=
ENV
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "$ENV_FILE already exists — leaving it unchanged."
fi
echo "DOMAIN=$DOMAIN" > "$APP_DIR/deploy/deploy.env"

step "Installing the services (API, daily jobs, backups)"
install -m 644 "$APP_DIR/deploy/systemd/cca-api.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/cca-daily.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/cca-daily.timer" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/cca-backup.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/cca-backup.timer" /etc/systemd/system/
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/cca-backup
mkdir -p /var/backups/cca
chown postgres:postgres /var/backups/cca
chmod 700 /var/backups/cca
systemctl daemon-reload
systemctl enable cca-api cca-daily.timer cca-backup.timer

step "Configuring Nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx/cca.conf" > /etc/nginx/sites-available/cca.conf
ln -sf /etc/nginx/sites-available/cca.conf /etc/nginx/sites-enabled/cca.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

step "Building and starting the app"
bash "$APP_DIR/deploy/deploy.sh"

if [ "$SKIP_CERT" != "1" ]; then
  step "Getting HTTPS certificates"
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" \
    -d "$DOMAIN" -d "www.$DOMAIN" -d "admin.$DOMAIN"
fi

systemctl start cca-daily.timer cca-backup.timer
step "Done"
echo "Website:  https://$DOMAIN"
echo "Admin:    https://admin.$DOMAIN  (sign in as $SEED_ADMIN_EMAIL)"
echo "API:      https://$DOMAIN/api/health"
echo "Next: add Paystack and SMTP settings to $ENV_FILE, then: sudo systemctl restart cca-api"
