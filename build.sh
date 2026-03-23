#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Clean
rm -rf dist
mkdir -p dist/chrome dist/firefox

# Shared files
SHARED=(
  content/selectors.js
  content/scraper.js
  content/reorder.js
  content/panel.js
  styles/content.css
  styles/panel.css
  popup/popup.html
  popup/popup.css
  popup/popup.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
  icons/active/icon16.png
  icons/active/icon48.png
  icons/active/icon128.png
)

copy_shared() {
  local dest="$1"
  for file in "${SHARED[@]}"; do
    mkdir -p "$dest/$(dirname "$file")"
    cp "$file" "$dest/$file"
  done
}

# ── Chrome ──
copy_shared dist/chrome
cp manifest.chrome.json dist/chrome/manifest.json
# Chrome uses ES module service worker — copy lib/ and background/ as-is
mkdir -p dist/chrome/background dist/chrome/lib
cp background/service-worker.js dist/chrome/background/
cp lib/claude-api.js dist/chrome/lib/
cp lib/sort.js dist/chrome/lib/

# ── Firefox ──
copy_shared dist/firefox
cp manifest.firefox.json dist/firefox/manifest.json
# Firefox needs a bundled background script (no ES module support in background)
mkdir -p dist/firefox/background
cat lib/sort.js lib/claude-api.js background/service-worker.js \
  | sed 's/^export function/function/' \
  | sed 's/^export async function/async function/' \
  | sed "s/^import.*from.*$//" \
  > dist/firefox/background/background.bundle.js

# ── Package Firefox .xpi ──
web-ext build --source-dir dist/firefox --artifacts-dir dist --filename youtube-wl-organizer.xpi --overwrite-dest 2>/dev/null || true

echo ""
echo "Build complete:"
echo "  dist/chrome/                    — load as unpacked in chrome://extensions"
echo "  dist/firefox/                   — load as temporary add-on in about:debugging"
if [ -f dist/youtube-wl-organizer.xpi ]; then
echo "  dist/youtube-wl-organizer.xpi   — installable Firefox add-on (unsigned)"
fi
