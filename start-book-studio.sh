#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then echo "Installing dependencies for the first run..."; npm install; fi
echo "MyPuzzles Book Studio: http://localhost:4173"
node src/cli.js serve