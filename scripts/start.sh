#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SIDE="${1:-${HF_SIDE:-}}"
if [[ "$SIDE" != "dirty" && "$SIDE" != "clean" ]]; then
  echo "Usage: scripts/start.sh dirty|clean" >&2
  exit 2
fi
exec node scripts/run.mjs "$SIDE"
