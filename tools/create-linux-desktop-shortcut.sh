#!/usr/bin/env bash
# =============================================================================
# Create a Linux desktop shortcut (freedesktop .desktop entry) for MolEdit.
# Usage:
#   bash tools/create-linux-desktop-shortcut.sh            # create entry
#   bash tools/create-linux-desktop-shortcut.sh --dry-run  # print entry only
# Installs to: ${XDG_DATA_HOME:-$HOME/.local/share}/applications/moledit.desktop
# =============================================================================
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
LAUNCH="$ROOT/launch.sh"
ICON="$ROOT/assets/moledit-256.png"
DEST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DEST="$DEST_DIR/moledit.desktop"

if [ ! -f "$LAUNCH" ]; then
  echo "Error: launch.sh not found at $LAUNCH" >&2
  exit 1
fi

cleanup_path() {
  # Escape backslashes and double quotes for the Exec key.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

ENTRY='[Desktop Entry]
Type=Application
Version=1.0
Name=MolEdit
GenericName=Molecular Editor
Comment=GaussView-style molecular editor
Exec=bash "'"$(cleanup_path "$LAUNCH")"'" %F
Icon='"$ICON"'
Terminal=false
Categories=Science;Chemistry;Education;
MimeType=chemical/x-xyz;chemical/x-mdl-sdfile;
StartupNotify=true
'

if [ "${1:-}" = "--dry-run" ]; then
  printf '%s' "$ENTRY"
  exit 0
fi

mkdir -p "$DEST_DIR"
printf '%s' "$ENTRY" > "$DEST"
chmod +x "$DEST"
echo "Created desktop entry: $DEST"
echo "If it does not appear in your applications menu, log out/in once or run: update-desktop-database \"$DEST_DIR\""
