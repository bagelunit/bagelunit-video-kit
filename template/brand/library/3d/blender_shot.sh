#!/usr/bin/env bash
# blender_shot.sh: the same as blender_shot.py (it runs it). Mac and Linux; on Windows run blender_shot.py with python.
#   bash blender_shot.sh shots/product.py --video <name> [--still 45 | --clip product.mov | --mp4 product.mp4] [shot options...]
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY=$(command -v python3 || command -v python) || { echo "Python 3 was not found: install it (brew install python, or python.org), or run the shot by hand."; exit 1; }
exec "$PY" "$DIR/blender_shot.py" "$@"
