#!/usr/bin/env bash
# =============================================================================
# MolEdit local HTTP server for Linux / macOS.
# Usage:  bash start-server.sh [port]
#         (default port 8777 or MOLEDIT_PORT; Ctrl+C to stop)
# =============================================================================
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
APP_DIR="$SCRIPT_DIR"
PORT="${1:-${MOLEDIT_PORT:-8777}}"

case "$PORT" in
  ''|*[!0-9]*) echo "Error: invalid port: $PORT" >&2; exit 2 ;;
esac

if [ ! -f "$APP_DIR/index.html" ]; then
  echo "Error: index.html not found in $APP_DIR" >&2
  exit 1
fi

echo "MolEdit local server: http://127.0.0.1:$PORT/"
echo "Open that URL in your browser. Press Ctrl+C to stop."

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$APP_DIR"
elif command -v python >/dev/null 2>&1; then
  cd "$APP_DIR" && exec python -m http.server "$PORT" --bind 127.0.0.1
elif command -v node >/dev/null 2>&1; then
  exec node "$APP_DIR/server.mjs" "$PORT"
else
  echo "Error: no python3/python/node found. Open index.html manually in your browser." >&2
  exit 1
fi
