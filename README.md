# YouTube Playlist Organizer

A Firefox-first browser extension that sorts a YouTube playlist — primarily **Watch Later** — into topic groups using Claude, or by duration.

Single-user tool. Chrome is a secondary target and is not tested regularly.

## What it does

- Adds a floating **Organize** button to playlist pages
- **Analyze & sort** — Claude groups videos into a fixed taxonomy. Needs an Anthropic API key, takes a few seconds
- **Sort by duration** — shortest first. Local, instant, no API key
- Preview the result before applying, with per-video "treat as unwatched" toggles
- Applying sends every move in one batched request, then injects group headings into the real playlist
- **Hide group headings** removes the headings and stops them returning

Videos less than 10% watched count as unwatched. YouTube marks a video partially watched after roughly two seconds, so a stricter threshold promoted far too many videos.

## Install

Build first:

```sh
npm install
./build.sh
```

That produces `dist/firefox/`, `dist/chrome/`, and an unsigned `dist/youtube-playlist-organizer.xpi`.

### Firefox — permanent install (signed)

Release Firefox only installs add-ons Mozilla has signed. Signing on the
**unlisted** channel gets a signed `.xpi` without publishing it publicly.

```sh
./sign.sh
```

Credentials are read from 1Password automatically; override with
`AMO_JWT_ISSUER` / `AMO_JWT_SECRET` if needed. The signed `.xpi` lands in
`dist/`. Install it via `about:addons` → gear icon → **Install Add-on From
File…**.

Two rules that matter:

- **Bump `version` in `package.json` before re-signing.** AMO rejects a version
  it has already seen.
- **Never change the gecko id** in `manifest.firefox.json`. Firefox treats a
  different id as an entirely different add-on.

Self-distributed add-ons do not auto-update — a new version means signing and
installing again.

### Firefox — temporary install (development)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** and pick any file inside `dist/firefox/`

This is wiped every time Firefox restarts.

**You must grant access to YouTube.** Firefox MV3 treats declared `host_permissions` as opt-in, so the content script does not inject until you allow the site — the Organize button simply never appears otherwise. Either:

- Open the extension's popup and click **Grant access to YouTube**, or
- Extensions menu (puzzle piece) → this add-on → **Always Allow on www.youtube.com**

Then reload any YouTube tabs that were already open. The grant does not apply retroactively to them.

### Chrome

Load `dist/chrome/` unpacked at `chrome://extensions`. Chrome grants host permissions at install, so there is nothing extra to allow.

### API key

Only needed for **Analyze & sort**. Open the extension popup, paste an Anthropic API key, click **Save**. It is stored in `chrome.storage.sync` and never leaves the extension except in requests to the Anthropic API.

## Development

```sh
npm test        # node --test tests/*.test.js
./build.sh      # writes dist/ and the .xpi
```

No test framework and no test dependencies — plain `node:test` and `node:assert`, deliberately.

### Layout

```
content/     globals, NOT ES modules, load-ordered by the manifest
  selectors.js   SELECTORS   the only YouTube selectors in the project
  innertube.js   WLInnerTube config scrape, SAPISIDHASH, call(), paging
  playlist.js    WLPlaylist  read() -> Video[], applyOrder()
  enrich.js      WLEnrich    player calls, concurrency 6, best-effort
  storage.js     WLStorage   overrides + group map, serialized writes
  modal.js       WLModal     floating trigger and modal, all UI
  headings.js    WLHeadings  group heading injection
  panel.js       WLPanel     orchestration, SPA lifecycle
lib/         ES modules, background only
  taxonomy.js  sort.js  classify.js
background/
  service-worker.js
```

### Constraints worth knowing before editing

These break the extension at runtime while the tests still pass:

1. **`content/` files are not ES modules.** One global each, load-ordered by the manifest. Adding `import`/`export` breaks them in the browser.
2. **`lib/` files are ES modules**, background only. The Firefox background script is built by concatenating them and stripping module syntax with `sed`. `build.sh` handles `export function`, `export async function`, `export const`, and `import` — any other export form silently produces a broken background script.
3. **Nothing may become a child of the playlist's `DIV#contents` except playlist items.** YouTube's drag-to-reorder indexes a rect cache by child position, so a single foreign sibling breaks dragging for the whole list. Group headings mount *inside* their anchor item for exactly this reason.
4. **No DOM fallback.** The reorder API needs `setVideoId`, which only ever appears in API responses and never in the DOM, so there is nothing to fall back to. InnerTube failures surface as errors.

`docs/HANDOFF.md` carries the full context: measured InnerTube behaviour, decisions and their reasoning, and the failure modes that cost real time.

## How it works

The extension talks to **InnerTube**, YouTube's own internal API, from a content script. The `SAPISID` cookie is readable there, so requests are authenticated with a `SAPISIDHASH` header and no extra permissions are required.

Reordering sends every move in a single `browse/edit_playlist` call. Reads are cached server-side and lag a successful write by around a second, so `applyOrder` polls until the new order appears.

**Marking a video unwatched cannot clear YouTube's red progress bar.** That needs a `feedbackToken` from the watch-history feed, and neither paging nor searching that feed can reach an arbitrary video. The toggle only affects how this extension sorts.

## Licence

None. Personal project.
