#!/usr/bin/env bash
# =============================================================================
# MolEdit launcher for Linux and macOS.
# Opens index.html in the system browser, or starts a local HTTP server when
# direct file:// opening is not possible.
#
# Usage:
#   bash launch.sh                 # auto: open file directly, fallback to server
#   bash launch.sh --file          # force direct file:// open
#   bash launch.sh --server        # force local HTTP server
#   bash launch.sh --port 9000     # preferred server port (default 8777)
#   bash launch.sh --dry-run       # print what would happen, do nothing
#   bash launch.sh --help
#
# Environment:
#   MOLEDIT_PORT                 preferred port for server mode
#   MOLEDIT_LAUNCH_OS            test hook: linux | macos | other
#   MOLEDIT_LAUNCH_NO_OPENERS    test hook: 1 = pretend no browser opener exists
# =============================================================================
set -u

usage() {
  cat <<'EOF'
MolEdit launcher (Linux / macOS)

Usage: bash launch.sh [options]

Options:
  --file        open index.html directly (file://)
  --server      start a local HTTP server and open it in the browser
  --port N      preferred port for server mode (default 8777, env MOLEDIT_PORT)
  --dry-run     print the detected action and exit (no side effects)
  -h, --help    show this help

Examples:
  bash launch.sh
  bash launch.sh --server --port 9000
  bash launch.sh --dry-run
EOF
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || {
  echo "Error: cannot resolve script directory" >&2
  exit 1
}
APP_DIR="$SCRIPT_DIR"
INDEX="$APP_DIR/index.html"
PORT="${MOLEDIT_PORT:-8777}"
MODE="auto"
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) MODE="server"; shift ;;
    --file) MODE="file"; shift ;;
    --port)
      if [ "$#" -ge 2 ]; then PORT="$2"; shift 2; else
        echo "Error: --port requires a value" >&2; exit 2
      fi ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ ! -f "$INDEX" ]; then
  echo "Error: index.html not found in $APP_DIR" >&2
  exit 1
fi

# ---------- OS detection ----------
if [ -n "${MOLEDIT_LAUNCH_OS:-}" ]; then
  OS="$MOLEDIT_LAUNCH_OS"
else
  UNAME_S=$(uname -s 2>/dev/null || echo unknown)
  case "$UNAME_S" in
    Darwin*) OS="macos" ;;
    Linux*)  OS="linux" ;;
    *)       OS="other" ;;
  esac
fi

# ---------- browser opener detection ----------
OPENER=""
if [ "${MOLEDIT_LAUNCH_NO_OPENERS:-0}" = "1" ]; then
  OPENER=""
elif [ -n "${MOLEDIT_LAUNCH_FORCE_OPENER:-}" ]; then
  # Test hook: pretend the given opener exists (used by tests/portability.test.mjs).
  OPENER="$MOLEDIT_LAUNCH_FORCE_OPENER"
elif [ "$OS" = "macos" ]; then
  command -v open >/dev/null 2>&1 && OPENER="open"
elif [ "$OS" = "linux" ]; then
  for candidate in xdg-open gio sensible-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then OPENER="$candidate"; break; fi
  done
else
  for candidate in xdg-open open; do
    if command -v "$candidate" >/dev/null 2>&1; then OPENER="$candidate"; break; fi
  done
fi

open_target() {
  # $1 = filesystem path or URL
  [ -z "$OPENER" ] && return 1
  if [ "$OPENER" = "gio" ]; then
    gio open "$1" >/dev/null 2>&1
  else
    "$OPENER" "$1" >/dev/null 2>&1
  fi
}

find_interpreters() {
  # Print all usable interpreters (broken stubs like the Windows Store python3
  # alias are skipped because `--version` fails).
  for candidate in python3 python node; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --version >/dev/null 2>&1; then
      echo "$candidate"
    fi
  done
}

# ---------- auto mode: prefer direct file open ----------
if [ "$MODE" = "auto" ]; then
  if [ -n "$OPENER" ]; then MODE="file"; else MODE="server"; fi
fi

if [ "$MODE" = "file" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "mode=file"
    echo "os=$OS"
    echo "opener=${OPENER:-none}"
    echo "open_target=$INDEX"
    exit 0
  fi
  if open_target "$INDEX"; then
    echo "MolEdit opened: $INDEX"
    exit 0
  fi
  echo "Could not open index.html directly; falling back to a local server..." >&2
  MODE="server"
fi

# ---------- server mode ----------
INTERPS=$(find_interpreters)
if [ -z "$INTERPS" ]; then
  echo "Error: no browser opener and no working python3/python/node found." >&2
  echo "Please open $INDEX manually in your browser." >&2
  exit 1
fi
INTERP=$(printf '%s\n' "$INTERPS" | head -n 1)

if [ "$DRY_RUN" = "1" ]; then
  echo "mode=server"
  echo "os=$OS"
  echo "interpreter=$INTERP"
  echo "port=$PORT"
  echo "open_target=http://127.0.0.1:$PORT/"
  exit 0
fi

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

started=0
first_port="$PORT"
for interp in $INTERPS; do
  try_port="$first_port"
  sub_attempt=0
  while [ "$sub_attempt" -lt 3 ]; do
    case "$interp" in
      node)
        node "$APP_DIR/server.mjs" "$try_port" >/dev/null 2>&1 &
        ;;
      python3)
        python3 -m http.server "$try_port" --bind 127.0.0.1 --directory "$APP_DIR" >/dev/null 2>&1 &
        ;;
      *)
        # Older python (2/3 without --directory): run inside the app directory.
        ( cd "$APP_DIR" && exec python -m http.server "$try_port" --bind 127.0.0.1 ) >/dev/null 2>&1 &
        ;;
    esac
    SERVER_PID=$!
    sleep 0.8
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      started=1
      INTERP="$interp"
      PORT="$try_port"
      break 2
    fi
    SERVER_PID=""
    sub_attempt=$((sub_attempt + 1))
    try_port=$((try_port + 1))
  done
done

if [ "$started" != "1" ]; then
  echo "Error: could not start a local server (tried interpreters: $(echo "$INTERPS" | tr '\n' ' '))." >&2
  exit 1
fi

URL="http://127.0.0.1:$PORT/"
echo "MolEdit server running: $URL"
echo "Press Ctrl+C to stop."
if ! open_target "$URL"; then
  echo "Please open this URL in your browser: $URL"
fi

# Keep the terminal attached to the server so Ctrl+C stops it cleanly.
wait "$SERVER_PID"
