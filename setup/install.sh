#!/usr/bin/env bash
# BagelUnit Video Kit installer: launcher for macOS and Linux (Windows: node setup/install.mjs). Options pass through.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 22 or newer is needed first (https://nodejs.org). Then run this again."; exit 1; fi
exec node "$DIR/install.mjs" "$@"
