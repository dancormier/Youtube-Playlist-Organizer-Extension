# Handoff — YouTube Playlist Organizer

**Written:** 2026-07-27 · **Last updated:** 2026-07-27
**Remote:** [github.com/dancormier/youtube-playlist-organizer](https://github.com/dancormier/youtube-playlist-organizer) — private, default branch `main`
**Version:** 0.6.0 · **Tests:** 185 passing · **Working tree:** clean

**All four original issues are closed and verified in Firefox by Dan**, along with one found afterwards (stale headings after re-sorting). Read this before touching anything: it covers what the extension does, what was measured rather than assumed, and what is decided and why.

---

## What this is

A Firefox-first (Chrome secondary) browser extension that sorts a YouTube playlist — primarily Watch Later — into topic groups using Claude, or by duration.

**Dan's setup:** Firefox is the primary browser. Chrome is a secondary target and is not tested regularly. Firefox's devtools *Inspector* panel crashes on YouTube (`can't access dead object`); the *Console* tab works fine. That crash is a Firefox bug, unrelated to this extension, and is why diagnostics were once rendered into the page rather than logged.

---

## Current state

Working end to end, verified manually by Dan except where noted:

- Floating **Organize** button on playlist pages → modal with two sort modes
- **Analyze & sort** — Claude groups into a fixed taxonomy (needs an API key, takes seconds)
- **Sort by duration** — local, instant, no API key
- Preview with group headings, per-video "treat as unwatched" toggles
- Apply → one batched API call → page reloads → group headings injected into the real playlist

---

## The finding that made all of this possible

**InnerTube** is YouTube's own internal API, the one the page itself calls. It is reachable from a Firefox MV3 content script. Everything below was **measured against the live service on 2026-07-25**, not assumed. Do not "correct" these.

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

---

## Architecture, and why

```
content/     (globals, NOT ES modules, load-ordered by manifest)
  selectors.js   SELECTORS   — the ONLY YouTube selectors in the project
  innertube.js   WLInnerTube — config scrape, SAPISIDHASH, call(), paging
  playlist.js    WLPlaylist  — read() → Video[], applyOrder(playlistId, setVideoIds)
  enrich.js      WLEnrich    — player calls, concurrency 6, best-effort
  storage.js     WLStorage   — overrides + group map, serialized writes
  modal.js       WLModal     — floating trigger + modal, all UI
  headings.js    WLHeadings  — divider injection into the real playlist
  panel.js       WLPanel     — orchestration, SPA lifecycle
lib/         (ES modules, background only)
  taxonomy.js  sort.js  classify.js
background/
  service-worker.js
```

**Hard constraints — violating these breaks the extension at runtime, not at test time:**

1. **`content/` files are NOT ES modules.** One global each (`const WLThing = {...}`), load-ordered by the manifest. Adding `import`/`export` breaks them in the browser while tests still pass.
2. **`lib/` files ARE ES modules**, background only. Firefox's background is built by **concatenating** them and `sed`-ing out module syntax. `build.sh` strips `export function`, `export async function`, `export const`, and `import`. **Any other export form silently produces a broken Firefox background script.** This already happened once — `export const` wasn't stripped when `lib/taxonomy.js` was added.
3. **No DOM fallback.** InnerTube failures surface as errors. Deliberate: one path to maintain for a single-user tool.
4. **Only our own UI avoids YouTube selectors.** The trigger and modal are elements we create. Heading injection genuinely must attach to YouTube's list — that dependency is confined to `content/selectors.js`.
5. **Nothing may become a child of `DIV#contents` except playlist items.** YouTube's `handleDragMove_` indexes a rect cache by child position, so one foreign sibling breaks drag-to-reorder for the whole list. Headings therefore mount *inside* their anchor item. See resolved Issue 2.

### Decisions already made — don't re-litigate

| Decision | Why |
|---|---|
| No DOM fallback | `setVideoId` is API-only, so reorder needs the API anyway |
| Enrich via `player` | Category and description come in the same response; "category only" costs the same for less |
| `percentWatched < 10` = unwatched | YouTube marks a video partially watched after ~2 seconds. 11 of 31 real videos were being promoted to the top |
| Overrides are **global**, not per-playlist | An override asserts "YouTube's watch data for this video is wrong" — a property of the video, not the list. Ruled on explicitly |
| Fixed taxonomy + up to 2 new categories | Stable headings week to week without forcing odd content into `Other` |
| Version in `package.json` only | Injected into both manifests at build. Source manifests read `0.0.0` deliberately |

---

## Conventions

- **Tests:** `npm test` → `node --test tests/*.test.js`. **The glob is required** — bare `node --test tests/` fails. No Vitest, zero test dependencies, deliberately.
- **Testing content-script globals:** `tests/helpers/load-global.js` evaluates them in a `node:vm` sandbox. **Do not modify that file** — it is shared by every test. One task added 65 lines of Proxy machinery to it, which didn't work and was reverted.
- **vm-realm gotcha:** arrays/objects created inside the sandbox carry the sandbox's constructors, so `assert.deepEqual` rejects them against outer-realm literals. **Normalise at the assertion** by spreading: `assert.deepEqual([...result], [...])`. This will bite you; it is not the implementation's fault.
- **Commits:** Conventional Commits. **Never add AI attribution** to any git artifact.
- **Branches:** `main` is the default branch on the private remote. Feature work goes on `dcormier/*` branches.
- **Naming:** the project was renamed from "YouTube Watch Later Organizer" on 2026-07-27, since it handles any playlist. The `WL*` prefix on the content-script globals (`WLPanel`, `WLModal`, …) was deliberately left alone — renaming them is pure churn with no user-visible effect. Older docs under `docs/superpowers/` keep the old name as historical record.

---

## ~~OPEN ISSUE 1~~ — RESOLVED 2026-07-27

**Confirmed by Dan:** granting **Always Allow on www.youtube.com** in Firefox's extensions menu makes the trigger mount normally on a fresh tab. The permissions theory below was correct. This was never an extension bug.

**What was done:**

- `popup/popup.{html,js,css}` — on open, the popup calls `permissions.contains({origins:['https://www.youtube.com/*']})`. If not granted, it shows a banner with a **Grant access to YouTube** button that calls `permissions.request()`. On success the banner becomes "Granted. Reload any open YouTube tabs." — the grant does *not* retro-inject into already-open tabs. Chrome grants `host_permissions` at install, so `contains()` returns true there and the banner never renders.
- `content/panel.js` — the 20s polling backstop was **removed**. It was diagnostic scaffolding for a cause that turned out to be elsewhere, and its secondary job (remount if the trigger is removed) is already covered by `pageObserver`.

**The popup rewrite is off the table.** Dan's fallback plan — moving all functionality into the toolbar popup — is no longer needed and should not be started.

**Not done, deliberately:** `scripting.registerContentScripts()` after the grant, which would inject into already-open tabs without a reload. More moving parts for a one-time-ever event. Revisit only if the reload step proves annoying.

<details>
<summary>Original diagnosis, kept for the record</summary>

**Symptom:** on a fresh Firefox tab opened after loading the extension, navigating straight to a playlist URL, the Organize button does not appear. Clicking the browser toolbar button makes it appear.

**Diagnosed 2026-07-27. The console is decisive:**

```
(nothing at all until the toolbar click)
[WL] content script loaded { readyState: "complete", hasBody: true }
[WL] syncTrigger: playlist page { source: "load-time", created: true, state: {...} }
```

Nothing logs until the click. Then the script loads and mounts correctly **on its first call**. So this is **not a bug in the extension's code** — the content script is not being injected until the toolbar is clicked.

**Leading explanation: Firefox MV3 host permissions are opt-in.** `host_permissions` are not granted at install; the declared content script doesn't inject until the user grants access for the site. Clicking the toolbar grants temporary access via `activeTab`, which matches the observed behaviour exactly.

**Untested at handoff — try this first:** in Firefox, open the extensions (puzzle-piece) menu → this add-on → **Always Allow on www.youtube.com**. Then load a playlist in a fresh tab.

- **If the trigger appears** → confirmed. The fix is either documenting the one-time grant, or calling `permissions.request()` from the popup on first run. No redesign needed.
- **If it still doesn't** → the permissions theory is wrong and this needs fresh investigation. The instrumentation is already in place and quiet.

**Dan's proposed fallback, if it can't be fixed:** move all functionality into the toolbar popup — the popup becomes the whole UI (mode choice, preview, apply), so clicking the button is what starts everything. He has explicitly said he's fine with this, including headings only appearing after a click. **Do not start this without confirming the permissions test failed** — it's a large rewrite to work around what may be one toggle.

**Note:** the current build has a **bounded 20s backstop** that mounts the trigger if the normal event paths don't fire, and `console.warn`s when it acts. It is diagnostic scaffolding. Once the root cause is settled, decide whether to keep or remove it.

</details>

---

## ~~OPEN ISSUE 2~~ — RESOLVED 2026-07-27, verified by Dan

Injected headings broke YouTube's drag-to-reorder. **Cause measured, not guessed.**

The headings were `<h2>` **siblings** of `ytd-playlist-video-renderer` inside `DIV#contents`. YouTube's `handleDragMove_` caches one rect per child of that container and indexes it by child position, so a foreign sibling made an index resolve to `undefined`:

```
Uncaught TypeError: can't access property "top", q is undefined
    OJl ... handleDragMove_ ...
```

That fired on every mousemove. Polymer also wiped the foreign siblings during its own re-render mid-drag — which is why drag started working partway through a drag, once the headings had been destroyed.

**Ruled out:** the observer re-injecting mid-drag was a plausible second mechanism and turned out not to be the cause. With the observer stopped and the heading nodes left in place, drag was still broken; with the nodes removed, it worked. Both tested in Firefox.

**Fix:** each heading is now a **child of the item that starts its group**. `ytd-playlist-video-renderer` has **no shadow root** (probed 2026-07-27; light children are `DIV#index-container`, `DIV#content`, `DIV#menu`; `position: static`), so a light-DOM child renders normally. The anchor item gets a `wl-group-anchor` class supplying `position: relative` and `margin-top`, and the heading is absolutely positioned into that gap with `top: 0; transform: translateY(-100%)`. Being out of flow, it cannot disturb the item's internal flex row. `DIV#contents` holds only playlist items again.

**Do not move headings back into the container's child list.** Two tests guard this (`assertChildListIsPureItems` in the inject suite, and the stray-sibling case in drift repair); both were verified to fail against the old sibling insertion.

**Also shipped:** a permanent **"Hide group headings"** control in the modal (option 3 from the original list). It stops the observer, removes the nodes, and clears the stored group map so they do not return on reload. Only rendered when `WLHeadings.present()` is true.

---

## ~~OPEN ISSUE 3~~ — RESOLVED 2026-07-27

Headings now align with the video thumbnails via `left: 36px` on `.wl-playlist-heading` in `styles/headings.css`. This waited on Issue 2, since the mount point determined the correct property and value — it landed as `left` on an absolutely-positioned element, not the `padding-left` originally proposed.

---

## ~~OPEN ISSUE 4~~ — RESOLVED 2026-07-27

`content/playlist.js` inferred `unavailable` from a **falsy title** alone, assuming YouTube returns `{simpleText}` rather than `{runs:[]}` for deleted/private entries. Unverified assumption; if wrong, ghosts get sent to Claude, 404 on their `player` call, and land in a topic group instead of the trailing `Unavailable` group.

**Fixed:** `normalize()` now treats an entry as unavailable when `renderer.isPlayable === false` **or** the title is falsy. Both signals are kept on purpose — `isPlayable` is YouTube's explicit marker but is omitted from many normal entries, so the check must be strict `=== false` and cannot stand alone; the falsy-title check remains the fallback.

Four tests in `tests/playlist.test.js` cover the matrix (`isPlayable:false` + real title, falsy title + field absent, `isPlayable:true` + normal title, field absent + normal title). The last two assert the field really is absent from the fixture first, so a later edit to the shared fixture can't silently gut the case they exist to catch.

**Verified 2026-07-27** by Dan against a playlist containing a real unavailable video.

---

## Deferred minors (triaged as ship, all recorded with rationale)

Ledgers live in `.superpowers/sdd/<plan-name>/progress.md` (gitignored). Notable ones:

- `pageAll` caps at 20 pages and returns a truncated result indistinguishable from a complete one (~2000-video ceiling)
- Each `applyOrder` poll re-pages the whole playlist — up to ~12 re-reads in the 10s window on a multi-page playlist
- `_trapFocus` dereferences `_root` without optional chaining; currently safe because `close()` removes the keydown listener first
- A storage write queued behind a failing one inherits that rejection rather than retrying
- Cluster names match the taxonomy by exact string, so `"tech & ai"` would fragment from `"Tech & AI"`
- Cancelling during "Applying N moves..." closes the modal, but the write was already sent — the playlist reorders, no reload happens, and the group map isn't persisted. Consider relabelling that button or disabling it once the write is in flight

---

## Lessons that cost real time

Recurring failure mode across this work: **a guard correct in one method and absent in its neighbour.** Fixed four separate times.

- `runSort` had the run token; `toggleUnwatched` and `applySort` didn't
- Adding an `await` for heading persistence reopened that same window *inside* `applySort`
- The reload `setTimeout` had a check before scheduling but not inside the callback
- `toGroups` handled three cluster states; `boundariesFrom` handled two — duration mode produced `data-wl-heading="undefined"`, whose identity check never matches, so headings duplicated on every observer pass

Other repeat offenders:

- **Green tests with real defects in covered-looking code**, several times. `content/panel.js` had zero tests and hosted two Criticals, including one that rendered `NaN:NaN left` to the user because it read a field the migration had deleted. That one was found only by a whole-branch review — no single task's diff touched the line.
- **`Array.prototype.every` on an empty array is `true`.** The heading observer's loop guard used it on `addedNodes`, so removal-only batches were classified as our own mutations and skipped.
- **Test fixtures that don't exercise the failure mode they name.** A `nextToken` test passed against both the correct implementation and the exact bug it existed to catch, because DFS order made the decoy unreachable.

**Whole-branch reviews found what per-task reviews structurally could not.** Worth keeping when several tasks edit the same file.

---

## Where things live

- **Spec:** `docs/superpowers/specs/2026-07-25-innertube-rewrite-design.md`
- **Plans:** `docs/superpowers/plans/` — foundation, usability fixes, floating trigger + modal, group headings, trigger diagnosis. `2026-07-25-modal-and-overrides.md` is superseded; the note at its end says so
- **SDD ledgers and per-task reports:** `.superpowers/sdd/<plan>/progress.md` (gitignored, on disk only)
- **Project note:** `~/Obsidian/personal/Projects/YouTube Playlist Organizer.md`
- **Build:** `./build.sh` → `dist/chrome/`, `dist/firefox/`, and an unsigned `.xpi`. Load `dist/firefox/` via `about:debugging#/runtime/this-firefox`
