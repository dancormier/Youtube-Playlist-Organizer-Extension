# InnerTube Rewrite — Design

**Date:** 2026-07-25
**Status:** Approved, pending implementation plan
**Supersedes:** parts of `2026-03-20-youtube-wl-organizer-design.md` and `2026-03-21-inline-panel-design.md`

## Problem

v0.5.0 works but is annoying in six specific ways:

1. Categorization reads only video titles
2. The preview panel's Apply/Cancel buttons scroll out of reach
3. Applying a sort takes minutes
4. No way to mark a barely-watched video as unwatched
5. No group headings in the playlist after sorting
6. Categories drift between runs

Firefox is the primary target. Chrome is secondary.

## Spike findings

Verified 2026-07-25 against the real account from inside a Firefox MV3 content script. These are measurements, not assumptions.

| Question | Result |
|---|---|
| Auth from a content script | `SAPISID` cookie is readable; SHA-1 `SAPISIDHASH` header works. **No extra permissions** |
| Unauthenticated access | 404 on private playlists — the auth header is mandatory |
| Reorder | `browse/edit_playlist` accepts every move in **one call**: 205ms regardless of size |
| Sequential reorder | 8 calls, 4355ms (~544ms each) — works, but batching is 20× faster |
| Watch state | `percentDurationWatched`, a real integer |
| Descriptions | Absent from `browse`; present in `player` |
| Category | Absent from `browse`; present in `player` |
| History deletion | **Not feasible.** See below |

Two false negatives in the first spike round, both errors in the probe rather than the API: omitting `movedSetVideoIdPredecessor` is a silent no-op that still returns `STATUS_SUCCEEDED`, and verifying 99ms after a write reads stale data.

### Why history deletion was abandoned

Marking a video genuinely unwatched requires deleting its watch-history entry, which requires a `feedbackToken` from the history feed. Both routes to that token failed:

- **Paging:** the history feed returns tiny day-sliced chunks — measured `[4, 0, 5, 3, 0, 1, 0, 3, 0, 6, 5, 3, 4, 3, 3]` across 15 pages for 40 entries. The target video sits hundreds of entries deep. Paging there is impractical.
- **Search:** `query` on `browseId: FEhistory` returned 0 hits across three progressively simpler query variants. Not a supported shape.

Watch history is enabled on the account, so a sparse feed is not the explanation.

**Consequence:** YouTube's red progress bar cannot be cleared by this extension. Item 4 is solved for sorting purposes only.

## Decisions

| Decision | Rationale |
|---|---|
| **No DOM fallback** | `setVideoId` exists only in the API response, so reorder needs the API read regardless. Maintaining a second path doubles surface area for a single-user tool |
| **Enrich with `player` calls** | Category and description arrive in the same response, so paying for one gets both. "Category only" is strictly worse at identical request cost |
| **Under 10% watched = unwatched** | Fixes the sliver-of-progress case with no API at all |
| **Local override for the rest** | Handles videos YouTube marked 100% after two seconds. Reversible, destroys nothing |
| **Modal overlay** | The sidebar cannot show 31 grouped videos with reachable actions |
| **Fixed taxonomy + room to add** | Stable headings week to week, without forcing odd content into `Other` |
| **Version in `package.json`** | Two hand-maintained manifests can silently disagree |

**Accepted risk:** InnerTube is undocumented and unversioned. YouTube can break it without notice. Not mitigated — failures surface as clear errors.

## Architecture

InnerTube needs page cookies, so it runs in the content script. Claude calls stay in the background, where the page's CSP can't interfere. MV3 content scripts cannot be ES modules, so content-side code keeps the existing global-object pattern; `lib/` remains ES modules for the background.

```
content/     (globals, load-ordered by manifest)
  innertube.js  WLInnerTube — config scrape, SAPISIDHASH, call(), paging
  playlist.js   WLPlaylist  — read() → Video[], applyOrder(ids)
  enrich.js     WLEnrich    — player calls, concurrency-capped
  storage.js    WLStorage   — overrides, group map
  modal.js      WLModal     — preview overlay
  headings.js   WLHeadings  — divider injection
  panel.js      WLPanel     — trigger button, orchestration, SPA lifecycle
lib/         (ES modules, background only)
  classify.js   prompt + parse
  sort.js       order builder
background/
  service-worker.js  Claude call only

deleted: content/scraper.js, content/reorder.js, content/probe.js
trimmed: content/selectors.js — only what heading injection needs
```

### Module contracts

**`WLInnerTube`** — the only module that knows about InnerTube.
- `getConfig()` → `{apiKey, clientName, clientVersion, delegatedSessionId}`, scraped from inline `<script>` text (not full `innerHTML`, which is multiple MB)
- `buildAuth()` → `SAPISIDHASH <ts>_<sha1(ts + " " + SAPISID + " " + origin)>`
- `call(endpoint, body)` → parsed JSON, or throws `InnerTubeError {endpoint, status, snippet}`
- `pageAll(browseId)` → follows continuation tokens, preferring the one under `continuationItemRenderer`; stops on a repeated token
- Depends on: nothing

**`WLPlaylist`** — playlist reads and writes.
- `read(playlistId)` → `Video[]`
- `applyOrder(playlistId, orderedIds)` → one batched `edit_playlist` call, then polls until the order matches (writes are not read-your-own-write consistent)
- Depends on: `WLInnerTube`

**`WLEnrich`** — per-video metadata.
- `enrich(videos, {concurrency: 6})` → same array with `category` and `description` (truncated to 300 chars) populated; failures leave the fields null rather than rejecting
- Depends on: `WLInnerTube`

**`WLStorage`** — typed wrapper over `chrome.storage`.
- `getOverrides() / toggleOverride(videoId)`
- `getGroupMap() / setGroupMap(map)`
- Depends on: nothing

**`WLModal`** — preview UI. Pure rendering plus callbacks; owns no sorting logic.
- `show(sortOrder, {onApply, onCancel, onToggleUnwatched})`
- `setProgress(current, total)` / `showError(message)`
- Depends on: nothing

**`WLHeadings`** — divider injection into the real playlist DOM.
- `inject(groupMap)` — idempotent, keyed by a `data-wl-heading` attribute
- `clear()`
- Depends on: `selectors.js`

**`WLPanel`** — the existing `content/panel.js`, retained rather than renamed. Owns the trigger button, the orchestration sequence, and SPA lifecycle. The only module that knows the order of operations.

### Data model

```js
Video = {
  id: string,            // videoId
  setVideoId: string,    // playlist-entry id; required for reorder, API-only
  title: string,
  channel: string,
  duration: number,      // seconds
  percentWatched: number,// 0-100 integer
  category: string|null, // from player
  description: string|null,
  unavailable: boolean,  // deleted/private ghost entry
}
```

### Storage schema

```js
chrome.storage.sync  = { apiKey }
chrome.storage.local = {
  unwatchedOverrides: string[],        // videoIds the user marked unwatched
  groupMap: { [videoId]: string },     // cluster name, for heading injection
  lastSort: { playlistId, timestamp, videoIdsHash },
  cachedClusters: { playlistId, videoIdsHash, clusters },  // enables RESORT without re-calling Claude
}
```

Overrides are read by the background when building the sort order, and by the modal to render toggle state. `WLStorage` is the content-side accessor; the background reads `chrome.storage.local` directly.

**Overrides are deliberately global, not scoped per playlist.** An override asserts "YouTube's watch data for this video is wrong" — a property of the video itself, not of the list you happen to be viewing it in. A video appearing in two playlists should carry the correction in both.

**`cachedClusters` is scoped by playlist and must be validated.** `RESORT` carries the current `playlistId`; if it does not match the cached one, the handler errors rather than recomputing. Without that check, analyzing one playlist and toggling in another silently returns the first playlist's ordering — wrong data with no error.

## Flow

1. User clicks the inline trigger
2. `WLPlaylist.read()` pages InnerTube into `Video[]`
3. `WLEnrich.enrich()` fetches `player` per video, concurrency 6
4. Background classifies via Claude and builds the sort order
5. `WLModal` shows the grouped preview. Per-video **treat as unwatched** toggles send a `RESORT` message to the background, which re-runs `buildSortOrder` against the **cached** cluster assignments. No second Claude call — cluster membership doesn't change when watch state does. Sorting logic stays in one place rather than being duplicated content-side
6. Apply → one `edit_playlist` call → poll until confirmed
7. `WLHeadings.inject()` and persist the group map

## Sort algorithm

```
effectiveProgress(v) = isOverridden(v) ? 0
                     : v.percentWatched < 10 ? 0
                     : v.percentWatched
```

1. **In progress** (`effectiveProgress > 0`), ascending by remaining watch time
2. **Topic groups** in fixed taxonomy order, ascending by duration within each group
3. **Unavailable** ghost entries, own group, last

Ghost entries are never sent to Claude — they have no title to classify.

## Taxonomy

Ordered casual → serious. The model assigns into this list and may add at most 2 categories when nothing fits.

`Music` · `Comedy & Entertainment` · `Food & Cooking` · `Home & DIY` · `Health & Fitness` · `Tech & AI` · `Geography & Nature` · `Science & Space` · `True Crime & History` · `Philosophy & Self-Help` · `Politics & News`

## Heading injection

YouTube lazily appends playlist items on scroll. Injection must therefore be idempotent and self-healing:

- Each divider carries `data-wl-heading="<cluster>"`, so re-running is a no-op where one already exists
- A `MutationObserver` on the playlist container re-runs injection, debounced ~200ms
- Headings clear when the URL changes or the video-ID set stops matching `lastSort.videoIdsHash`

**This is the least de-risked piece of the design.** DOM recycling behaviour was not verified during the spike, and the implementation plan should treat it as the step most likely to need iteration.

## Error handling

`WLInnerTube.call` throws `InnerTubeError` carrying endpoint, HTTP status, and a response snippet. The modal renders it verbatim — e.g. *"InnerTube browse failed (404): Requested entity was not found"*. No fallback, no silent degradation, no retry loop that hides a persistent failure.

Enrichment is the one exception: a failed `player` call leaves `category`/`description` null and classification proceeds on title and channel.

## Versioning

`package.json` gains a `version` field and becomes the single source of truth. `build.sh` injects it into both dist manifests; the source manifests carry a placeholder. Bump to **0.6.0** on release.

Semver's core (`MAJOR.MINOR.PATCH`) is used. Pre-release and build-metadata suffixes are **not** — Chrome requires 1–4 dot-separated integers (0–65535) and Firefox uses Mozilla's toolkit format, where `1.0.0-beta.1` is invalid.

## Testing

**Runner: Node's built-in `node:test`**, matching the existing suite. No Vitest — the repo currently has zero test dependencies and every test here is over pure functions, so a runner dependency would buy nothing.

Run with `node --test tests/*.test.js` (note the glob; bare `node --test tests/` fails).

Content-side modules are globals, not ES modules, so they can't be imported. Existing tests work around this by string-matching source text, which doesn't test behaviour. This plan introduces `tests/helpers/load-global.js`, which evaluates a content script in a `node:vm` sandbox and returns the global it defines — giving real behavioural tests without a bundler.

- `sort.js` — threshold boundary at exactly 10%, overrides, ghost placement, group ordering, empty input
- `classify.js` — prompt shape, parsing bare JSON and fenced JSON, malformed-response errors, taxonomy adherence
- `innertube.js` — `SAPISIDHASH` against fixed inputs, continuation-token selection from a captured fixture, config extraction

**Not automated:** anything requiring live authentication. E2E against YouTube needs real cookies and mutates a real playlist.

**Manual checklist** (run in Firefox against the throwaway playlist before Watch Later):
1. Read returns every video, including past the first continuation page
2. Enrichment populates category on the majority of videos
3. Preview groups match the taxonomy; ghosts appear last
4. Toggling "treat as unwatched" moves the video out of the in-progress group without re-calling Claude (verify no network request to `api.anthropic.com` fires)
5. Apply completes in under ~2s and the resulting order matches the preview
6. Headings appear and survive scrolling to the bottom and back
7. Reload the page — headings restore from the persisted group map
8. Break the API key deliberately; confirm the error names the endpoint and status

## Out of scope

- Clearing YouTube's red progress bar (established as not feasible)
- Drag-to-reorder in the preview
- Multiple playlists in one pass
- Sync of overrides across machines (`storage.local` is intentionally per-device)

## Open

- The taxonomy list is inferred from current Watch Later contents and is the part most likely to need revision after real use

## Shipped

**0.6.0 (2026-07-25)** — InnerTube data path (replacing DOM scraping), modal preview overlay (replacing sidebar), unwatched overrides with toggle UI, playlist group headings with auto-inject and persistence, floating trigger button (replacing header-injected panel), explicit sort modes (ascending and descending), auto-reload after confirmed sort. Watch-history deletion abandoned; YouTube's red progress bar cannot be cleared.

**Manual browser verification is outstanding and should be completed by the project owner.**
