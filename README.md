# YouTube Playlist Organizer

A browser extension that sorts a YouTube playlist — most usefully **Watch Later** — into topic groups using an AI model of your choice, or by duration, title or channel. Works in Firefox and Chrome.

## What it does

- Adds an **Organize** button to the playlist's filter-chip row (floating at the bottom right if that row is missing)
- **Analyze & sort** — the model you configure groups videos into your categories. Needs an API key (or a local Ollama), takes a few seconds
- **Sort by duration** — shortest first. Local, instant, no API key
- **Sort by title** — A to Z. Local, instant, no API key
- **Sort by channel** — channel name A to Z, then title. Local, instant, no API key
- Preview the result before applying and, in AI mode, mark a started video as unwatched so it sorts with the rest of its group
- Applying switches the playlist to **Manual** sort if it is on another sort (a reorder only shows through the Manual view), sends every move in one batched request, then draws group headings into the playlist
- A **Hide headings / Show headings** chip next to Organize toggles the headings; **Hide group headings** in the Organize dialog removes them for good

Videos less than 10% watched count as unwatched. YouTube marks a video partially watched after roughly two seconds, so a stricter threshold promoted far too many videos.

## Install from source

Store builds are planned. Until then, build it yourself:

```sh
npm install
./build.sh
```

That produces `dist/chrome/`, `dist/firefox/`, and (if `web-ext` is installed) an unsigned `dist/youtube-playlist-organizer.xpi`.

### Chrome

1. Open `chrome://extensions` and turn on **Developer mode**
2. **Load unpacked** and pick `dist/chrome/`

Chrome grants host permissions at install, so there is nothing else to allow.

### Firefox — temporary add-on (quickest)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** and pick any file inside `dist/firefox/`

This is wiped every time Firefox restarts.

### Firefox — permanent install (signed, unlisted)

Release Firefox only installs add-ons Mozilla has signed. Signing on the **unlisted** channel gets a signed `.xpi` without publishing it:

```sh
AMO_JWT_ISSUER=... AMO_JWT_SECRET=... ./sign.sh
```

Get API credentials at <https://addons.mozilla.org/developers/addon/api/key/>. The signed `.xpi` lands in `dist/`; install it via `about:addons` → gear icon → **Install Add-on From File…**.

Two rules that matter:

- **Bump `version` in `package.json` before re-signing.** AMO rejects a version it has already seen.
- **If you fork this, change the gecko id** in `manifest.firefox.json` before signing. Firefox treats the id as the add-on's identity.

Self-distributed add-ons do not auto-update — a new version means signing and installing again.

### Firefox: grant access to YouTube

Firefox MV3 treats declared `host_permissions` as opt-in, so the content script does not inject until you allow the site — the Organize button simply never appears otherwise. Either:

- Open the extension's popup and click **Grant access to YouTube**, or
- Extensions menu (puzzle piece) → this add-on → **Always Allow on www.youtube.com**

Then reload any YouTube tabs that were already open. The grant does not apply retroactively to them.

## Setup

Only **Analyze & sort** needs any of this; the duration, title and channel sorts work out of the box. Click the toolbar icon to open the popup:

1. **Provider** — pick where the requests go (see the table below).
2. **API key** — paste a key for that provider. The **Get a key** link opens the right page. Ollama needs no key.
3. **Base URL** — only shown for Ollama and the custom option; leave the default unless your server lives elsewhere.
4. **Model** — click **Load models** to fetch the provider's list. The one marked **(recommended)** is the cheapest tier that does the job; this task is labelling titles, so the smallest current model is enough. If listing fails, type a model id instead.
5. **Categories** — one per line, top to bottom is the order groups appear in. **Reset to defaults** restores the built-in list.
6. **Max new categories** — how many categories the model may invent when nothing on your list fits. `0` forces everything into your list (or **Other**).
7. **Extra instructions** — free text passed to the model, e.g. "Keep cooking and baking separate".
8. **Sort** — defaults for how **Analyze & sort** lays the playlist out. The preview shows the same controls above the list; changing one there re-sorts instantly (no second model call) and becomes the new default.
9. **Save**.

| Sort option | Choices | Notes |
|---|---|---|
| Within a group | Shortest first (default), Longest first, Playlist order, Title A–Z | Playlist order keeps the videos exactly as they sit in the playlist today |
| Group in progress | Checked (default) or unchecked | Checked puts every started video in its own **In progress** group at the top, least time left first. Unchecked keeps each one inside its category, first within the group, least time left first |
| Group order | My category order (default), Largest group first, Smallest group first, Alphabetical | Size ties keep your category order. **Other** is always the last group and **Unavailable** always comes after it, whichever you pick |

## Providers

| Provider | Where to get a key | Notes |
|---|---|---|
| Anthropic | <https://console.anthropic.com/settings/keys> | Default. Uses a Haiku-class model. The request carries `anthropic-dangerous-direct-browser-access`, which Anthropic requires for browser-originated calls — fine for your own key on your own machine |
| OpenAI | <https://platform.openai.com/api-keys> | A "mini" or "nano" model is plenty |
| Google Gemini | <https://aistudio.google.com/apikey> | Uses Google's OpenAI-compatible endpoint; pick a "flash" model |
| OpenRouter | <https://openrouter.ai/settings/keys> | One key for many vendors; model ids look like `anthropic/claude-haiku-4.5` |
| Ollama (local) | none — <https://ollama.com/download> | Runs on your machine. The browser is only allowed to call it if `OLLAMA_ORIGINS` includes `chrome-extension://*` and `moz-extension://*` (e.g. `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve`) |
| OpenAI-compatible (custom URL) | depends on the server | Anything that speaks the OpenAI chat-completions API: LM Studio, vLLM, LiteLLM, a proxy. Enter its base URL (usually ending in `/v1`) |

Your key is stored in the browser's extension sync storage and is only ever sent to the provider you picked. Note that sync storage replicates it to other browser profiles signed into the same browser account.

## Limitations

- **It uses YouTube's unofficial InnerTube API**, the one the page itself calls. Google does not endorse this, and YouTube can change it and break the extension at any time.
- **Reordering writes to the real playlist.** There is no undo other than sorting again.
- **Group headings exist only in your browser.** The extension draws them; YouTube stores nothing but the new order, so other devices see the order without the headings.
- **Playlists over ~2,000 videos are silently truncated.** Reading stops after 20 pages and the result looks complete.
- **The sort chip is matched by its English label.** Switching the playlist to Manual before applying looks for a menu entry called "Manual"; in another YouTube language, pick Manual yourself before applying.
- **"Treat as unwatched" only affects sorting.** It cannot clear YouTube's red progress bar (see [ARCHITECTURE.md](ARCHITECTURE.md) for why).
- **Titles and channel names are sent to the AI provider you configure**, on your key, at your cost.
- **Several Google accounts in one browser profile:** the extension reads the account index from the page (`SESSION_INDEX`) and addresses that account. Brand/channel accounts go through `DELEGATED_SESSION_ID`. If a playlist ever shows another account's videos, open an issue with the account setup.
- **Self-distributed Firefox builds do not auto-update.**

## Privacy

The extension has no server and collects nothing. Settings (including your API key) stay in the browser's extension storage; video titles go to the provider you chose; YouTube calls use your existing session. Details in [PRIVACY.md](PRIVACY.md).

## Development

```sh
npm test        # node --test tests/*.test.js
./build.sh      # writes dist/ and the .xpi
```

No test framework and no test dependencies — plain `node:test` and `node:assert`, deliberately. See [CONTRIBUTING.md](CONTRIBUTING.md) for the manual test checklist and conventions.

### Layout

```
content/     globals, NOT ES modules, load-ordered by the manifest
  announce.js    (no global)  tells the background this tab is YouTube
  selectors.js   SELECTORS   the only YouTube selectors in the project
  viewsort.js    WLViewSort  switches the playlist's own sort chip to Manual
  innertube.js   WLInnerTube config scrape, SAPISIDHASH, call(), paging
  playlist.js    WLPlaylist  read() -> Video[], applyOrder()
  enrich.js      WLEnrich    player calls, concurrency 6, best-effort
  storage.js     WLStorage   overrides + group map, serialized writes
  modal.js       WLModal     Organize trigger (chip row or floating) and modal, all UI
  headings.js    WLHeadings  group heading injection
  panel.js       WLPanel     orchestration, SPA lifecycle
lib/         ES modules, shared by the background and the popup
  taxonomy.js    default categories
  providers.js   PROVIDERS table, model recommendation
  settings.js    defaults, normalization, storage, legacy-key migration
  sort.js        ordering
  classify.js    prompt, response parsing, provider requests
background/
  service-worker.js
popup/
  popup.html  popup.js (module)  popup.css
```

### Constraints worth knowing before editing

These break the extension at runtime while the tests still pass:

1. **`content/` files are not ES modules.** One global each, load-ordered by the manifest. Adding `import`/`export` breaks them in the browser.
2. **`lib/` files are ES modules.** The Firefox background script is built by concatenating them and stripping module syntax with `sed`. `build.sh` handles `export function`, `export async function`, `export const`, and `import` — any other export form silently produces a broken background script. A new `lib/` file must be added to the `LIB` list in `build.sh`, in dependency order.
3. **Nothing may become a child of the playlist's `DIV#contents` except playlist items.** YouTube's drag-to-reorder indexes a rect cache by child position, so a single foreign sibling breaks dragging for the whole list. Group headings mount *inside* their anchor item for exactly this reason.
4. **No DOM fallback.** The reorder API needs `setVideoId`, which only ever appears in API responses and never in the DOM, so there is nothing to fall back to. InnerTube failures surface as errors.

[ARCHITECTURE.md](ARCHITECTURE.md) carries the full context: measured InnerTube behaviour, decisions and their reasoning, and the failure modes that cost real time.

## How it works

The extension talks to **InnerTube**, YouTube's own internal API, from a content script. The `SAPISID` cookie is readable there, so requests are authenticated with a `SAPISIDHASH` header and no extra permissions are required.

Reordering sends every move in a single `browse/edit_playlist` call. Reads are cached server-side and lag a successful write by around a second, so `applyOrder` polls until the new order appears.

Classification is one prompt per playlist: titles, channel names and YouTube's own category label, plus your category list and instructions. The background sends it to the configured provider (Anthropic's Messages API or any OpenAI-compatible chat endpoint), parses the JSON clusters, and orders the result: in-progress videos first, then your categories top to bottom, then anything the model invented, then **Other** and **Unavailable**.

**Marking a video unwatched cannot clear YouTube's red progress bar.** That needs a `feedbackToken` from the watch-history feed, and neither paging nor searching that feed can reach an arbitrary video. The toggle only affects how this extension sorts.

## Licence

[MIT](LICENSE).
