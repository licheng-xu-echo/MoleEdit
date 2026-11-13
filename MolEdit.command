#!/usr/bin/env bash
# =============================================================================
# macOS double-click launcher (Finder runs .command files in Terminal).
# First run may require:  chmod +x "MolEdit.command"
# =============================================================================
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec bash "$DIR/launch.sh" "$@"
