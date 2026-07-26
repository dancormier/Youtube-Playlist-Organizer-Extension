#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(node -p "require('./package.json').version")
echo "Building version $VERSION"

# Clean
rm -rf dist
mkdir -p dist/chrome dist/firefox

# Shared files
SHARED=(
  content/selectors.js
  content/innertube.js
  content/playlist.js
  content/enrich.js
  content/storage.js
  content/modal.js
  content/panel.js
  styles/content.css
  styles/panel.css
  styles/modal.css
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
node -e "
  const m = require('./manifest.chrome.json');
  m.version = process.argv[1];
  require('fs').writeFileSync('dist/chrome/manifest.json', JSON.stringify(m, null, 2));
" "$VERSION"
# Chrome uses ES module service worker — copy lib/ and background/ as-is
mkdir -p dist/chrome/background dist/chrome/lib
cp background/service-worker.js dist/chrome/background/
cp lib/classify.js dist/chrome/lib/
cp lib/sort.js dist/chrome/lib/
cp lib/taxonomy.js dist/chrome/lib/

# ── Firefox ──
copy_shared dist/firefox
node -e "
  const m = require('./manifest.firefox.json');
  m.version = process.argv[1];
  require('fs').writeFileSync('dist/firefox/manifest.json', JSON.stringify(m, null, 2));
" "$VERSION"
# Firefox needs a bundled background script (no ES module support in background)
mkdir -p dist/firefox/background
cat lib/taxonomy.js lib/sort.js lib/classify.js background/service-worker.js \
  | sed 's/^export function/function/' \
  | sed 's/^export async function/async function/' \
  | sed 's/^export const/const/' \
  | sed "s/^import.*from.*$//" \
  > dist/firefox/background/background.bundle.js

# Catches syntax defects in the bundle (e.g. an unstripped `export`). It cannot
# catch linkage bugs — a lib/ module imported by the service worker but missing
# from the `cat` list above still parses fine and only throws ReferenceError at
# message-handling time in the real browser — but it's a cheap, automated floor.
node --check dist/firefox/background/background.bundle.js

# ── Package Firefox .xpi ──
if command -v web-ext >/dev/null 2>&1; then
  web-ext build --source-dir dist/firefox --artifacts-dir dist --filename youtube-wl-organizer.xpi --overwrite-dest 2>/dev/null
else
  echo "web-ext not found — skipping .xpi packaging" >&2
fi

echo ""
echo "Build complete:"
echo "  dist/chrome/                    — load as unpacked in chrome://extensions"
echo "  dist/firefox/                   — load as temporary add-on in about:debugging"
if [ -f dist/youtube-wl-organizer.xpi ]; then
echo "  dist/youtube-wl-organizer.xpi   — installable Firefox add-on (unsigned)"
fi
