#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  exec node scripts/serve-dist.mjs
fi
echo "Node.js is unavailable; serving the production build with Python."
cd dist
exec python3 -m http.server 8080 --bind 127.0.0.1
