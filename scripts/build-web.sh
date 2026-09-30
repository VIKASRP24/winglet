#!/usr/bin/env bash
# Build the web app and bundle it into the plugin (plugin/web), which serves it to phones.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/app"
[ -d node_modules ] || npm ci
rm -rf dist
npx expo export --platform web
rm -rf "$ROOT/plugin/web"
cp -r dist "$ROOT/plugin/web"
echo "Bundled web app into plugin/web ($(du -sh "$ROOT/plugin/web" | cut -f1))"
