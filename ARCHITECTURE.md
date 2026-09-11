# Architecture

What the extension is built on, what was measured rather than assumed, and which decisions are settled. Read this before changing anything under `content/` or `lib/`.

## The finding that made it possible

**InnerTube** is YouTube's own internal API, the one the page itself calls. It is reachable from an MV3 content script. Everything below was **measured against the live service on 2026-07-25**, not assumed. Do not "correct" these.

| Fact | Detail |
|---|---|
| Auth | `SAPISID` cookie IS readable from a content script. Header is `SAPISIDHASH <unix_seconds>_<sha1("<unix_seconds> <SAPISID> <origin>")>`. **No extra permissions needed** |
| Unauthenticated | 404 on private playlists — the auth header is mandatory |
| Reorder | `browse/edit_playlist` accepts **every move in one call**: 205ms regardless of playlist size. Sequential was 8 calls / 4355ms |
| **Unanchored moves are a silent no-op** | An action with no `movedSetVideoIdPredecessor`/`movedSetVideoIdSuccessor` returns `STATUS_SUCCEEDED` and changes nothing. This cost a full debugging cycle |
| Read-after-write | Reads are cached. A read 99ms after a successful write returns the OLD order. Convergence ~1.2s. This is why `applyOrder` polls |
| `setVideoId` | The playlist-entry id, required for reorder. **Exists only in API responses, never in the DOM.** This is why the DOM path was deleted |
| Watch state | `percentDurationWatched`, an integer 0–100 |
| Descriptions / category | Absent from `browse`; present in `player`. Both arrive in the same response |
| Continuations | Prefer the token under `continuationItemRenderer`. Taking the last `continuationCommand` in the tree makes paging stall |
| **History deletion** | **Not feasible.** See below |

### Why "mark as unwatched" can't clear YouTube's red bar

It needs a `feedbackToken` from the watch-history feed. Both routes failed:
- **Paging:** history returns tiny day-sliced chunks — measured `[4, 0, 5, 3, 0, 1, 0, 3, 0, 6, 5, 3, 4, 3, 3]` across 15 pages for 40 entries. Target videos sit hundreds deep.
- **Search:** `query` on `browseId: FEhistory` returned 0 hits across three variants. Not a supported shape.

History is enabled on the account, so a sparse feed isn't the explanation. **Don't retry this** — it was investigated thoroughly and abandoned deliberately.

## Module map

```
content/     (globals, NOT ES modules, load-ordered by manifest)
  announce.js    —           — one YT_PAGE message so the background can colour this tab's icon
  selectors.js   SELECTORS   — the ONLY YouTube selectors in the project
  viewsort.js    WLViewSort  — switches the playlist's sort chip to Manual before an apply
  innertube.js   WLInnerTube — config scrape, SAPISIDHASH, call(), paging
  playlist.js    WLPlaylist  — read() → Video[], applyOrder(playlistId, setVideoIds)
  enrich.js      WLEnrich    — player calls, concurrency 6, best-effort
  storage.js     WLStorage   — overrides + group map, serialized writes
  modal.js       WLModal     — Organize trigger (chip row, floating fallback) + modal, all UI
  headings.js    WLHeadings  — heading injection into the real playlist
  panel.js       WLPanel     — orchestration, SPA lifecycle
lib/         (ES modules; imported by the background and the popup)
  taxonomy.js    — default category list and group names
  providers.js   — PROVIDERS table, MODEL_GUIDANCE, pickRecommended()
  settings.js    — DEFAULT_SETTINGS, normalizeSettings(), load/save over storage.sync
  sort.js        — buildSortOrder(videos, clusters, overrides, taxonomy, options), SORT_CHOICES, normalizeSortOptions()
  classify.js    — buildPrompt(), parseClusters(), categorizeVideos(), listModels()
background/
  service-worker.js — message handlers: ANALYZE, RESORT, SORT_BY_DURATION, GET_SORT_STATE, LIST_MODELS, YT_PAGE
popup/
  popup.html popup.js popup.css — settings form (module script) and the Firefox host-permission banner
```

### Message flow

1. `WLPanel.runSort('ai')` reads the playlist through InnerTube, enriches it via `player` calls, and sends `ANALYZE` to the background.
2. The background loads settings, refuses if the provider needs a key and none is set, builds one prompt from titles/channels/categories plus the user's category list and instructions, and calls the provider: Anthropic's Messages API for `kind: 'anthropic'`, `POST {baseUrl}/chat/completions` for `kind: 'openai'` (OpenAI, Gemini's compatibility endpoint, OpenRouter, Ollama, custom).
3. `buildSortOrder` orders the result — by default in-progress first, then the user's categories in their order, then model-invented names, then Other and Unavailable; `settings.sort` (or the message's `sortOptions`) changes the in-group order, where in-progress videos go, and the group order — and caches the clusters so `RESORT` (toggling "treat as unwatched", or changing a sort option in the preview) never calls the model again.
4. Apply first switches the playlist's sort chip to **Manual** through the DOM (`WLViewSort`) — with any other view sort selected the write succeeds but every read keeps the view's order, so the poll below never converges — then sends every move in one `browse/edit_playlist` call, polls until the read converges, stores the group map, and reloads; `WLHeadings` re-injects headings from the stored map on every page load until **Hide group headings** clears it. The **Hide/Show headings** chip beside Organize sets a `hidden` flag on the stored map instead, so the headings can come back.

### Hard constraints

Violating these breaks the extension at runtime, not at test time:

1. **`content/` files are NOT ES modules.** One global each (`const WLThing = {...}`), load-ordered by the manifest. Adding `import`/`export` breaks them in the browser while tests still pass.
2. **`lib/` files ARE ES modules.** Firefox's background is built by **concatenating** them and `sed`-ing out module syntax. `build.sh` strips `export function`, `export async function`, `export const`, and `import`. **Any other export form silently produces a broken Firefox background script.** This already happened once — `export const` wasn't stripped when `lib/taxonomy.js` was added. A new `lib/` file must also be added to the `LIB` list in `build.sh`, in dependency order; `node --check` on the bundle catches syntax but not a missing file.
3. **No DOM fallback.** InnerTube failures surface as errors. Deliberate: one path to maintain.
4. **Only our own UI avoids YouTube selectors.** The trigger and modal are elements we create. Heading injection must attach to YouTube's list, and the Manual-sort switch must click YouTube's sort chip — both dependencies are confined to `content/selectors.js`. No InnerTube endpoint for the view-sort preference has been identified; if one is, `WLViewSort` is the only thing to replace.
5. **Nothing may become a child of `DIV#contents` except playlist items.** YouTube's `handleDragMove_` indexes a rect cache by child position, so one foreign sibling breaks drag-to-reorder for the whole list. Headings therefore mount *inside* their anchor item (see "Headings and drag-to-reorder" below).

## Decisions already made

| Decision | Why |
|---|---|
| No DOM fallback | `setVideoId` is API-only, so reorder needs the API anyway |
| Enrich via `player` | Category and description come in the same response; "category only" costs the same for less |
| `percentWatched < 10` = unwatched | YouTube marks a video partially watched after ~2 seconds. 11 of 31 real videos were being promoted to the top |
| Overrides are **global**, not per-playlist | An override asserts "YouTube's watch data for this video is wrong" — a property of the video, not the list |
| Fixed taxonomy + a small number of new categories | Stable headings week to week without forcing odd content into `Other`. The list and the limit are user settings; the defaults live in `lib/taxonomy.js` |
| One settings key in `storage.sync` | The popup and background share `lib/settings.js`; a legacy top-level `apiKey` is migrated on first read |
| Non-streaming provider calls | The whole response is parsed as JSON at the end, so streaming bought nothing but code |
| No `tabs` permission | The per-tab icon is set when the content script sends `YT_PAGE`; watching every navigation was the only thing `tabs` did |
| Version in `package.json` only | Injected into both manifests at build. Source manifests read `0.0.0` deliberately |

### Headings and drag-to-reorder

Injected headings once broke YouTube's drag-to-reorder. The headings were `<h2>` **siblings** of `ytd-playlist-video-renderer` inside `DIV#contents`. YouTube's `handleDragMove_` caches one rect per child of that container and indexes it by child position, so a foreign sibling made an index resolve to `undefined` (`can't access property "top", q is undefined`) on every mousemove. Polymer also wiped the foreign siblings during its own re-render mid-drag.

Each heading is now a **child of the item that starts its group**. `ytd-playlist-video-renderer` has **no shadow root** (probed 2026-07-27; light children are `DIV#index-container`, `DIV#content`, `DIV#menu`; `position: static`), so a light-DOM child renders normally. The anchor item gets a `wl-group-anchor` class supplying `position: relative` and `margin-top`, and the heading is absolutely positioned into that gap with `top: 0; transform: translateY(-100%)`. Being out of flow, it cannot disturb the item's internal flex row. Two tests guard this (`assertChildListIsPureItems` in the inject suite, and the stray-sibling case in drift repair).

### Unavailable videos

`content/playlist.js` treats an entry as unavailable when `renderer.isPlayable === false` **or** the title is falsy. Both signals are kept on purpose — `isPlayable` is YouTube's explicit marker but is omitted from many normal entries, so the check must be strict `=== false` and cannot stand alone; the falsy-title check remains the fallback. Unavailable entries are never sent to the model and always sort last.

## Testing notes

- `npm test` → `node --test tests/*.test.js`. **The glob is required** — bare `node --test tests/` fails. No test framework, zero test dependencies, deliberately.
- **Content-script globals** are evaluated in a `node:vm` sandbox by `tests/helpers/load-global.js`. That helper is shared by every test; keep it small.
- **vm-realm gotcha:** arrays and objects created inside the sandbox carry the sandbox's constructors, so `assert.deepEqual` rejects them against outer-realm literals. **Normalise at the assertion** by spreading: `assert.deepEqual([...result], [...])` or `{ ...obj }`. This will bite you; it is not the implementation's fault.
- **Background handlers** are not exported (the file is concatenated for Firefox). `tests/resort-handler.test.js` and `tests/analyze-handler.test.js` capture the `onMessage` listener through a mocked `chrome` global and stub `globalThis.fetch`.

## Known rough edges

- `pageAll` caps at 20 pages and returns a truncated result indistinguishable from a complete one (~2,000-video ceiling).
- Each `applyOrder` poll re-pages the whole playlist — up to ~12 re-reads in the 10s window on a multi-page playlist.
- A storage write queued behind a failing one inherits that rejection rather than retrying.

## Guidance from past defects

Patterns that produced real bugs here, worth checking for in any change:

- **A guard present in one method and absent in its neighbour.** The run token existed in `runSort` but not in `toggleUnwatched` or `applySort`; a reload `setTimeout` checked before scheduling but not inside the callback; `toGroups` handled three cluster states while `boundariesFrom` handled two, producing `data-wl-heading="undefined"` and duplicated headings. When adding a guard, look for every sibling that needs the same one.
- **Green tests over untested files.** `content/panel.js` had no tests and hosted two serious defects, one of which rendered `NaN:NaN left` to the user by reading a field a migration had deleted. Coverage-looking code is not covered code; the orchestration layer needs tests as much as the pure functions.
- **`Array.prototype.every` on an empty array is `true`.** The heading observer's loop guard used it on `addedNodes`, so removal-only batches were classified as the extension's own mutations and skipped.
- **Fixtures that don't exercise the failure they name.** A `nextToken` test passed against both the correct implementation and the exact bug it existed to catch, because traversal order made the decoy unreachable. Verify a new regression test fails against the old code.
- **Whole-file review after several changes to one file** found what per-change review structurally could not.
