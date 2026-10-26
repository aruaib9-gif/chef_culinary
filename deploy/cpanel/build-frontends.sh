#!/usr/bin/env bash
# Builds the website and the admin app for cPanel and packages each as a zip to upload with File Manager.
# Run on your own computer from the project folder:
#   bash deploy/cpanel/build-frontends.sh https://api.yourdomain.com
set -euo pipefail
API_URL="${1:?Usage: build-frontends.sh https://api.yourdomain.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/deploy/cpanel/out"
cd "$ROOT"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Building with API at $API_URL"
VITE_API_URL="$API_URL" npm run build:web
VITE_API_URL="$API_URL" npm run build:admin

rm -rf "$OUT" && mkdir -p "$OUT"
# Zip the *contents* of each dist folder (including .htaccess) so they extract straight into the document root.
(cd apps/web/dist && zip -qr "$OUT/website.zip" . -x '_redirects')
(cd apps/admin/dist && zip -qr "$OUT/admin.zip" .)

echo
echo "Done:"
echo "  $OUT/website.zip  → extract into public_html (the main domain's folder)"
echo "  $OUT/admin.zip    → extract into the admin subdomain's folder (e.g. admin.yourdomain.com)"
