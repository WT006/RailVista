#!/usr/bin/env bash
# 从本机（Git Bash / WSL / macOS / Linux）上传到云服务器
# 用法:
#   cd z8991-map
#   bash deploy/deploy.sh root@1.2.3.4 /var/www/z8991-map

set -euo pipefail

SERVER="${1:?Usage: deploy.sh user@host [/var/www/z8991-map]}"
REMOTE="${2:-/var/www/z8991-map}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Uploading $ROOT -> ${SERVER}:${REMOTE}"

ssh "$SERVER" "mkdir -p '$REMOTE'"

rsync -avz --delete \
  --exclude '.git' \
  --exclude 'scripts' \
  --exclude 'deploy' \
  --exclude 'js/railway-osm-raw.json' \
  "$ROOT/" "${SERVER}:${REMOTE}/"

if [[ -f "$ROOT/config.js" ]]; then
  rsync -avz "$ROOT/config.js" "${SERVER}:${REMOTE}/"
else
  echo "Warning: config.js not found locally. Create it on server for index.html."
fi

echo "Done."
