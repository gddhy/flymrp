#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -x "$ROOT/node_modules/.bin/vite" ]]; then
  echo "Installing npm dependencies…"
  npm install
fi

PORT="${PORT:-5173}"
echo "flymrp web player"
echo "  open  http://127.0.0.1:${PORT}/"
echo "  upload a .mrp in the browser"
echo "  Ctrl+C to stop"
echo

exec "$ROOT/node_modules/.bin/vite" --config "$ROOT/web/vite.config.ts" --host 127.0.0.1 --port "$PORT" --open
