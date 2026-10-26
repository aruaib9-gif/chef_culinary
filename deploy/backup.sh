#!/usr/bin/env bash
# Nightly database backup (spec §12). Keeps 14 days on the server.
# Copy /var/backups/cca off the server too (see VPS_SETUP.md, "Off-server backups").
set -euo pipefail
DIR=/var/backups/cca
STAMP=$(date +%Y%m%d-%H%M)
sudo -u postgres pg_dump -Fc chefs_academy > "$DIR/chefs_academy-$STAMP.dump"
chown postgres:postgres "$DIR/chefs_academy-$STAMP.dump"
chmod 600 "$DIR/chefs_academy-$STAMP.dump"
find "$DIR" -name 'chefs_academy-*.dump' -mtime +14 -delete
echo "backup written: $DIR/chefs_academy-$STAMP.dump"
