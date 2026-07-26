# Playlist Group Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `2026-07-25-innertube-foundation.md` and `2026-07-25-modal-and-overrides.md` must be complete. This plan consumes `WLStorage` and the applied sort order.

**Goal:** After a sort is applied, inject group headings into the real Watch Later list so the grouping is visible while browsing, not only in the preview.

**Architecture:** Headings are divider elements inserted before the first playlist item of each group. YouTube appends items lazily as you scroll, so injection is idempotent and re-runs from a debounced `MutationObserver`. The group map persists in `chrome.storage.local`, so headings restore after a page reload without re-analyzing.

**Tech Stack:** Vanilla JS, no framework. `MutationObserver`. Node's built-in `node:test`.

## Global Constraints

- **Firefox is the primary target.** Chrome is secondary.
- **Content scripts cannot be ES modules.** Files under `content/` define one global and are load-ordered by the manifest.
- **Test runner:** `node --test tests/*.test.js`. The glob is required.
- **Commits:** Conventional Commits. Never add AI attribution to any git artifact.
- **Accessibility baseline: WCAG 2.1 AA.** Injected headings are real heading elements, not styled divs.
- **DOM injection is not unit-tested.** The repo has no jsdom and adds no dependencies — boundary logic is unit-tested, injection is verified manually.
- **This is the least de-risked work in the project.** DOM recycling behaviour was never verified during the spike. If injection proves unreliable, say so rather than layering retries on top.

---

### Task 1: Heading boundary computation

Given a sort order, decide which videos get a heading before them. Pure, so it gets real tests.

**Files:**
- Create: `content/headings.js`
- Test: `tests/headings.test.js`

**Interfaces:**
- Consumes: sort order from the foundation plan
- Produces:
  - `WLHeadings.boundariesFrom(sortOrder) → [{videoId, name}]` — one entry per group, naming the video that starts it
  - `WLHeadings.hashIds(videos) → string`
  - `WLHeadings.IN_PROGRESS_LABEL = '▶ In Progress'`

- [ ] **Step 1: Write the failing test**

Create `tests/headings.test.js`:

```js
// tests/headings.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

const load = () => loadGlobal('content/headings.js', 'WLHeadings', {
  document: undefined,
  MutationObserver: class { observe() {} disconnect() {} },
});

function video(overrides = {}) {
  return { id: 'v', title: 'T', cluster: 'Music', ...overrides };
}

describe('WLHeadings.boundariesFrom', () => {
  it('returns nothing for an empty order', () => {
    assert.deepEqual(load().boundariesFrom([]), []);
  });

  it('marks the first video of each group', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    assert.deepEqual(boundaries, [
      { videoId: 'a', name: 'Music' },
      { videoId: 'c', name: 'Tech & AI' },
    ]);
  });

  it('labels the null cluster as in progress', () => {
    const headings = load();
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: null })]);
    assert.equal(boundaries[0].name, headings.IN_PROGRESS_LABEL);
  });

  it('emits a fresh boundary when a group name recurs non-consecutively', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(boundaries.length, 3);
    assert.equal(boundaries[2].videoId, 'c');
  });

  it('emits one boundary per video when every cluster differs', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
    ]);
    assert.equal(boundaries.length, 2);
  });
});

describe('WLHeadings.hashIds', () => {
  it('is stable for the same set of videos', () => {
    const headings = load();
    const videos = [video({ id: 'a' }), video({ id: 'b' })];
    assert.equal(headings.hashIds(videos), headings.hashIds(videos));
  });

  it('ignores ordering, so re-sorting does not invalidate headings', () => {
    const headings = load();
    const forward = [video({ id: 'a' }), video({ id: 'b' })];
    const reverse = [video({ id: 'b' }), video({ id: 'a' })];
    assert.equal(headings.hashIds(forward), headings.hashIds(reverse));
  });

  it('changes when a video is added', () => {
    const headings = load();
    const before = headings.hashIds([video({ id: 'a' })]);
    const after = headings.hashIds([video({ id: 'a' }), video({ id: 'b' })]);
    assert.notEqual(before, after);
  });

  it('changes when a video is removed', () => {
    const headings = load();
    const before = headings.hashIds([video({ id: 'a' }), video({ id: 'b' })]);
    const after = headings.hashIds([video({ id: 'a' })]);
    assert.notEqual(before, after);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/headings.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/headings.js'`

- [ ] **Step 3: Write the implementation**

Create `content/headings.js`:

```js
// content/headings.js
// Depends on: content/selectors.js, content/storage.js

const WLHeadings = {
  IN_PROGRESS_LABEL: '▶ In Progress',
  ATTRIBUTE: 'data-wl-heading',

  _observer: null,
  _boundaries: [],
  _debounce: null,

  /** One entry per group, naming the video that starts it. */
  boundariesFrom(sortOrder) {
    const boundaries = [];
    let currentName = undefined;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (name !== currentName) {
        boundaries.push({ videoId: video.id, name });
        currentName = name;
      }
    }
    return boundaries;
  },

  /** Order-independent fingerprint of the video set. */
  hashIds(videos) {
    return videos.map(v => v.id).sort().join(',');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/headings.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add content/headings.js tests/headings.test.js
git commit -m "feat(headings): compute group boundaries from a sort order"
```

---

### Task 2: DOM injection and lazy-load resilience

**Files:**
- Modify: `content/headings.js`
- Create: `styles/headings.css`
- Modify: `manifest.chrome.json`, `manifest.firefox.json`
- Modify: `build.sh`

**Interfaces:**
- Consumes: `WLHeadings.boundariesFrom`, `SELECTORS.PLAYLIST_ITEMS`, `SELECTORS.VIDEO_LINK`
- Produces:
  - `WLHeadings.inject(boundaries) → number` — count of headings placed
  - `WLHeadings.clear() → void`
  - `WLHeadings.watch(boundaries) → void` — inject and keep re-injecting as items load
  - `WLHeadings.stop() → void`

- [ ] **Step 1: Write the stylesheet**

Create `styles/headings.css`:

```css
/* styles/headings.css — group dividers injected into the playlist */

.wl-playlist-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 8px;
  padding: 0 0 6px;
  border-bottom: 1px solid #3f3f3f;
  font-family: 'Roboto', 'Arial', sans-serif;
  font-size: 1.4rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #69b3ff;
}

.wl-playlist-heading.wl-in-progress { color: #ff8a80; }

.wl-playlist-heading .wl-heading-count {
  color: #909090;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
```

- [ ] **Step 2: Write the injection logic**

Append these methods to the `WLHeadings` object in `content/headings.js`:

```js
  _itemFor(videoId) {
    for (const item of document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS)) {
      const link = item.querySelector(SELECTORS.VIDEO_LINK);
      if (link && (link.getAttribute('href') || '').includes(videoId)) return item;
    }
    return null;
  },

  _build(name, count) {
    const heading = document.createElement('h2');
    heading.className = name === this.IN_PROGRESS_LABEL
      ? 'wl-playlist-heading wl-in-progress'
      : 'wl-playlist-heading';
    heading.setAttribute(this.ATTRIBUTE, name);

    const label = document.createElement('span');
    label.textContent = name;
    heading.appendChild(label);

    if (count > 0) {
      const counter = document.createElement('span');
      counter.className = 'wl-heading-count';
      counter.textContent = `${count} video${count === 1 ? '' : 's'}`;
      heading.appendChild(counter);
    }
    return heading;
  },

  /**
   * Insert a heading before the first item of each group.
   * Idempotent — an existing heading for a group is left alone, so this can be
   * re-run freely as YouTube appends more items.
   */
  inject(boundaries) {
    let placed = 0;

    for (const { videoId, name, count } of boundaries) {
      const item = this._itemFor(videoId);
      if (!item) continue;

      const previous = item.previousElementSibling;
      if (previous && previous.getAttribute?.(this.ATTRIBUTE) === name) {
        placed++;
        continue;
      }

      item.parentNode.insertBefore(this._build(name, count || 0), item);
      placed++;
    }
    return placed;
  },

  clear() {
    for (const heading of document.querySelectorAll(`[${this.ATTRIBUTE}]`)) {
      heading.remove();
    }
  },

  /**
   * Inject now, then keep injecting as YouTube lazily appends items.
   * Debounced because a playlist render fires many mutations in a burst.
   */
  watch(boundaries) {
    this._boundaries = boundaries;
    this.stop();
    this.inject(boundaries);

    const container = document.querySelector(SELECTORS.PLAYLIST_ITEMS)?.parentNode;
    if (!container) return;

    this._observer = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves, or the observer re-triggers forever.
      const ours = mutations.every(m =>
        [...m.addedNodes].every(n => n.nodeType === 1 && n.hasAttribute?.(this.ATTRIBUTE))
      );
      if (ours) return;

      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.inject(this._boundaries), 200);
    });

    this._observer.observe(container, { childList: true });
  },

  stop() {
    this._observer?.disconnect();
    this._observer = null;
    clearTimeout(this._debounce);
    this._debounce = null;
  },
```

- [ ] **Step 3: Add counts to the boundaries**

Replace `boundariesFrom` in `content/headings.js` so headings can show group sizes:

```js
  /** One entry per group, naming the video that starts it and how many it holds. */
  boundariesFrom(sortOrder) {
    const boundaries = [];
    let current = null;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (!current || current.name !== name) {
        current = { videoId: video.id, name, count: 0 };
        boundaries.push(current);
      }
      current.count++;
    }
    return boundaries;
  },
```

- [ ] **Step 4: Update the boundary tests for counts**

In `tests/headings.test.js`, replace the `marks the first video of each group` test:

```js
  it('marks the first video of each group', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    assert.deepEqual(boundaries, [
      { videoId: 'a', name: 'Music', count: 2 },
      { videoId: 'c', name: 'Tech & AI', count: 1 },
    ]);
  });

  it('counts the videos in each group', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(boundaries[0].count, 3);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/headings.test.js`
Expected: PASS, 10 tests

- [ ] **Step 6: Register the files**

In both `manifest.chrome.json` and `manifest.firefox.json`:

```json
      "js": ["content/selectors.js", "content/innertube.js", "content/playlist.js", "content/enrich.js", "content/storage.js", "content/modal.js", "content/headings.js", "content/panel.js"],
      "css": ["styles/content.css", "styles/panel.css", "styles/modal.css", "styles/headings.css"]
```

In `build.sh`, add to `SHARED` after `content/modal.js`:

```bash
  content/headings.js
```

And after `styles/modal.css`:

```bash
  styles/headings.css
```

- [ ] **Step 7: Verify the build**

Run: `./build.sh && ls dist/firefox/content/ dist/firefox/styles/`
Expected: `content/` lists `headings.js`; `styles/` lists `headings.css`

- [ ] **Step 8: Commit**

```bash
git add content/headings.js styles/headings.css tests/headings.test.js manifest.chrome.json manifest.firefox.json build.sh
git commit -m "feat(headings): inject group dividers that survive lazy loading"
```

---

### Task 3: Inject after sorting, and restore on reload

**Files:**
- Modify: `content/panel.js`

**Interfaces:**
- Consumes: `WLHeadings.watch/clear/hashIds`, `WLStorage.getGroupMap/setGroupMap`
- Produces: headings that appear after a sort and survive a page reload

- [ ] **Step 1: Persist boundaries after a successful apply**

`content/panel.js` was rewritten for the floating trigger and modal, so the
success branch of `applySort` now reads:

```js
    if (result.applied) {
      WLModal.showBusy(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened.
      setTimeout(() => location.reload(), 1200);
```

Replace it with:

```js
    if (result.applied) {
      // Persist BEFORE the reload — the reload is what makes headings necessary,
      // and it destroys any in-memory state that isn't written first.
      await WLStorage.setGroupMap({
        playlistId,
        boundaries: WLHeadings.boundariesFrom(this.currentSortOrder),
        videoIdsHash: WLHeadings.hashIds(this.currentSortOrder),
      });

      WLModal.showBusy(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened.
      setTimeout(() => location.reload(), 1200);
```

Note `playlistId` is already a local in `applySort` (captured from
`this.currentPlaylistId` at the top), so no extra lookup is needed. There is no
`WLHeadings.watch()` call here — the reload discards the DOM immediately, and
Step 2 re-injects on the fresh page.

- [ ] **Step 2: Restore headings on page load**

Add this method to the `WLPanel` object in `content/panel.js`:

```js
  _headingsRestoredFor: null,

  /**
   * Re-apply stored headings after a reload. Discards them when the playlist's
   * contents have changed, since stale groupings are worse than none.
   *
   * Called from syncTrigger(), which fires on every DOM mutation batch, so it
   * must do its work at most once per playlist — hence the guard. Without it
   * this would issue an InnerTube read per mutation.
   */
  async restoreHeadings() {
    const playlistId = new URL(location.href).searchParams.get('list');
    if (!playlistId || this._headingsRestoredFor === playlistId) return;
    this._headingsRestoredFor = playlistId;

    const stored = await WLStorage.getGroupMap();
    if (!stored.boundaries || stored.playlistId !== playlistId) return;

    let videos;
    try {
      videos = await WLPlaylist.read(playlistId);
    } catch {
      return; // Offline or API broken — headings simply don't restore.
    }

    if (WLHeadings.hashIds(videos) !== stored.videoIdsHash) {
      await WLStorage.setGroupMap({});
      return;
    }
    WLHeadings.watch(stored.boundaries);
  },
```

- [ ] **Step 3: Restore whenever we land on a playlist page**

There is no longer an `inject()` method — the panel was replaced by a floating
trigger. `syncTrigger()` is now the single place that knows we are on a playlist
page, so restoration hangs off it. In `content/panel.js`, change:

```js
function syncTrigger() {
  if (onPlaylistPage()) {
    WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
  } else {
    WLModal.removeTrigger();
    WLModal.close();
  }
}
```

to:

```js
function syncTrigger() {
  if (onPlaylistPage()) {
    WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
    WLPanel.restoreHeadings();
  } else {
    WLModal.removeTrigger();
    WLModal.close();
    WLHeadings.stop();
    WLHeadings.clear();
  }
}
```

`syncTrigger()` runs on every mutation batch, so `restoreHeadings()` must be
cheap and idempotent when there is nothing to do. Guard it with a flag so it
performs at most one `WLPlaylist.read()` per page — without that you would fire
an API call per mutation, which on YouTube is continuous.

- [ ] **Step 4: Clear headings on SPA navigation**

In `content/panel.js`, inside `resetForNavigation()`, after
`WLInnerTube.resetConfig();` add:

```js
  WLHeadings.stop();
  WLHeadings.clear();
  WLPanel._headingsRestoredFor = null;
```

That last line resets the guard from Step 3 so the next playlist gets its own
restoration attempt.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Verify the build**

Run: `./build.sh && node --check dist/firefox/background/background.bundle.js`
Expected: exit 0

- [ ] **Step 7: Manual verification in Firefox**

Load `dist/firefox/` via `about:debugging#/runtime/this-firefox`, then on Watch Later:

1. Analyze and **Apply Sort**
2. Headings appear in the playlist between groups, with correct counts
3. Scroll to the bottom — headings appear for groups whose videos loaded lazily, and **no duplicates** appear
4. Scroll back up — still exactly one heading per group
5. Reload the page — headings restore without re-analyzing
6. Remove a video from Watch Later, then reload — headings clear rather than showing stale groups
7. Navigate to another playlist and back — no headings leak between playlists
8. Confirm headings render as `<h2>` in the inspector, not styled divs

- [ ] **Step 8: Commit**

```bash
git add content/panel.js
git commit -m "feat(headings): inject after sorting and restore across reloads"
```

---

### Task 4: Release 0.6.0

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-07-25-innertube-rewrite-design.md`

- [ ] **Step 1: Bump the version**

Run: `npm version minor --no-git-tag-version`
Expected: prints `v0.6.0`

- [ ] **Step 2: Verify both manifests pick it up**

Run:

```bash
./build.sh >/dev/null && \
  node -p "require('./dist/chrome/manifest.json').version" && \
  node -p "require('./dist/firefox/manifest.json').version"
```

Expected: `0.6.0` printed twice

- [ ] **Step 3: Record what shipped**

Append to the spec's `## Open` section:

```markdown
## Shipped

**0.6.0 (2026-07-25)** — InnerTube data path, modal preview, unwatched overrides, playlist group headings. Watch-history deletion abandoned; YouTube's red progress bar cannot be cleared.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json docs/superpowers/specs/2026-07-25-innertube-rewrite-design.md
git commit -m "chore: release 0.6.0"
```

---

## Done when

- `npm test` passes
- Headings appear between groups and survive scrolling with no duplicates
- Headings restore after a reload and clear when the playlist changes
- Both manifests report `0.6.0`
