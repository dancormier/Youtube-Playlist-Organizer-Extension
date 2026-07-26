# Panel Usability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `2026-07-25-innertube-foundation.md` complete.

**Goal:** Fix three usability problems found during manual verification: the panel doesn't appear until something disturbs the page, the sort mode is invisible so an instant duration sort looks like a failed AI sort, and the new order isn't visible without a manual refresh.

**Architecture:** All three changes live in `content/panel.js` plus its stylesheet. No API-layer changes.

**Tech Stack:** Vanilla JS, no bundler. Node's built-in `node:test`.

## Global Constraints

- **Firefox is the primary target.** Chrome is secondary.
- **`content/` files are NOT ES modules.** One global each, load-ordered by the manifest. Never add `import`/`export` to a `content/` file.
- **Test runner:** `node --test tests/*.test.js`. The glob is required.
- **Do NOT modify `tests/helpers/load-global.js`.** Normalise vm-realm arrays at the assertion site by spreading.
- **Commits:** Conventional Commits. Never add AI attribution to any git artifact.
- **No DOM fallback.** API failures surface as errors.
- 99 tests currently pass. All must keep passing.

## Background: why these three

1. **`findAnchor()` treats a 0×0 rect as "no anchor".** On Watch Later the header element exists before it is laid out, so the check fails, falls through to a sidebar selector that doesn't match, and returns `null`. Injection only retries on the next DOM mutation — so once YouTube settles, the panel never appears. Clicking the toolbar button appears to fix it only because the focus change makes YouTube re-render.
2. **`isWatchLater` silently picks the sort mode.** On a non-WL playlist the extension does a local duration sort and never calls Claude, but the button still says "Analyze & sort". The result is instant and identical whether or not an API key is configured, which reads as a broken AI sort rather than a working duration sort.
3. **YouTube's DOM doesn't reflect the reordered playlist**, so a successful sort looks like nothing happened until a manual refresh.

---

### Task 1: Make panel injection reliable

**Files:**
- Modify: `content/panel.js`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `findAnchor()` returning an anchor whenever the element exists, regardless of layout state; a bounded retry loop; a `yt-navigate-finish` listener

- [ ] **Step 1: Write the failing test**

Append to `tests/panel.test.js`. The existing file shows the `loadGlobal` + `document` stub pattern — follow it.

```js
describe('findAnchor', () => {
  function withDom(elements) {
    // Minimal document stub: querySelector returns the first matching key.
    return {
      querySelector: (sel) => elements[sel] || null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { appendChild: () => {} },
      documentElement: { innerHTML: '' },
    };
  }

  it('returns the Watch Later anchor even when it has no layout yet', () => {
    const wlAnchor = {
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      parentNode: {},
    };
    const doc = withDom({
      '.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer': wlAnchor,
    });
    const panel = loadPanel({ document: doc });
    const anchor = panel.findAnchor();
    assert.ok(anchor, 'a zero-size element is still a valid anchor');
    assert.equal(anchor.position, 'after');
  });

  it('falls back to the sidebar anchor when no playlist header exists', () => {
    const sidebar = { getBoundingClientRect: () => ({ width: 100, height: 40 }) };
    const doc = withDom({ '.page-header-sidebar yt-flexible-actions-view-model': sidebar });
    const panel = loadPanel({ document: doc });
    assert.equal(panel.findAnchor().position, 'inside');
  });

  it('returns null when neither anchor is present', () => {
    const panel = loadPanel({ document: withDom({}) });
    assert.equal(panel.findAnchor(), null);
  });
});
```

`loadPanel` is a helper you add alongside the existing tests: it calls `loadGlobal('content/panel.js', 'WLPanel', sandbox)` with `document`, `chrome`, `location`, `MutationObserver`, and `setTimeout` stubbed. `findAnchor` is currently a module-level function, not a method on `WLPanel` — **move it onto the `WLPanel` object** so it is reachable from tests, and update its call sites.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/panel.test.js`
Expected: FAIL — `panel.findAnchor is not a function`

- [ ] **Step 3: Move `findAnchor` onto WLPanel and drop the layout gate**

Delete the module-level `function findAnchor() {...}` and add this method to the `WLPanel` object:

```js
  /**
   * Locate where the panel should mount.
   * Deliberately does NOT check layout: on Watch Later the header exists before
   * it is laid out, and treating a 0x0 rect as "absent" meant the panel never
   * appeared until some unrelated mutation retriggered injection.
   */
  findAnchor() {
    const wlAnchor = document.querySelector(
      '.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer'
    );
    if (wlAnchor) return { el: wlAnchor, position: 'after' };

    const sidebarFlexActions = document.querySelector(
      '.page-header-sidebar yt-flexible-actions-view-model'
    );
    if (sidebarFlexActions) return { el: sidebarFlexActions, position: 'inside' };

    return null;
  },
```

Update `inject()` to call `this.findAnchor()`, and update `checkAndInject()` to call `WLPanel.findAnchor()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/panel.test.js`
Expected: PASS

- [ ] **Step 5: Add a bounded retry and a navigation listener**

Replace the `checkAndInject` function and the observer setup at the bottom of `content/panel.js` with:

```js
function checkAndInject() {
  if (!location.pathname.startsWith('/playlist')) return false;
  if (document.querySelector('#wl-organizer-panel')) return true;

  if (WLPanel.findAnchor()) {
    WLPanel.inject();
    return true;
  }
  return false;
}

/**
 * Poll briefly for the anchor. Mutation events alone are not enough: YouTube can
 * finish rendering in a batch we already processed, and once the page settles no
 * further mutations arrive, so a missed injection is never retried.
 */
function injectWithRetry({ intervalMs = 300, timeoutMs = 15000 } = {}) {
  if (checkAndInject()) return;

  const started = Date.now();
  const timer = setInterval(() => {
    if (checkAndInject() || Date.now() - started > timeoutMs) {
      clearInterval(timer);
    }
  }, intervalMs);
}

function resetForNavigation() {
  const oldPanel = document.querySelector('#wl-organizer-panel');
  if (oldPanel) oldPanel.remove();
  WLPanel.panel = null;
  WLPanel.currentSortOrder = [];
  WLPanel.lastVideoHash = null;
  WLInnerTube.resetConfig();
}

let lastUrl = location.href;

const pageObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
    injectWithRetry();
    return;
  }
  checkAndInject();
});

pageObserver.observe(document.body, { childList: true, subtree: true });

// YouTube fires this after SPA navigation completes — more reliable than
// inferring navigation from mutations alone.
window.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  injectWithRetry();
});

injectWithRetry();
```

Remove the now-duplicated `let lastUrl = location.href;` declaration further up the file if one remains.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, `fail 0`

- [ ] **Step 7: Commit**

```bash
git add content/panel.js tests/panel.test.js
git commit -m "fix(panel): inject reliably without waiting for an unrelated mutation"
```

---

### Task 2: Two explicit sort modes

Both buttons appear on every playlist. "Sort by duration" is local and instant; "Analyze & sort" calls Claude and needs an API key.

**Files:**
- Modify: `content/panel.js`
- Modify: `styles/panel.css`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `WLPlaylist.read`, `WLEnrich.enrich`, background `ANALYZE` / `SORT_BY_DURATION`
- Produces: `WLPanel.runSort(mode)` where `mode` is `'ai'` or `'duration'`

- [ ] **Step 1: Replace the idle-state markup**

In `inject()`, replace the idle state block with:

```html
      <!-- Idle state -->
      <div id="wl-state-idle">
        <div class="wl-btn-row wl-idle-actions">
          <button class="wl-yt-btn wl-btn-filled" id="wl-analyze-btn"><svg class="wl-btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>Analyze &amp; sort</button>
          <button class="wl-yt-btn" id="wl-duration-btn">Sort by duration</button>
        </div>
        <p id="wl-idle-message" class="wl-text-secondary wl-hidden"></p>
      </div>
```

- [ ] **Step 2: Replace the analyze handler with a shared runner**

In `bindEvents()`, replace the entire `#wl-analyze-btn` click listener with:

```js
    this.$('#wl-analyze-btn').addEventListener('click', () => this.runSort('ai'));
    this.$('#wl-duration-btn').addEventListener('click', () => this.runSort('duration'));
```

Then add this method to `WLPanel`. It is the previous handler's logic with the mode made explicit rather than inferred from the URL:

```js
  /**
   * @param {'ai'|'duration'} mode
   * 'duration' sorts locally and never calls Claude — no API key needed, and it
   * skips enrichment entirely since nothing consumes the metadata.
   */
  async runSort(mode) {
    this._analyseCancelled = false;
    this.showState('analyzing');
    this.$('#wl-analyze-status').textContent = 'Scanning videos...';

    try {
      const playlistId = new URL(location.href).searchParams.get('list');
      if (!playlistId) {
        this.showError('No playlist found in the URL.');
        return;
      }

      const videos = await WLPlaylist.read(playlistId);
      if (this._analyseCancelled) return;

      if (!videos || videos.length === 0) {
        this.showError('No videos found on this playlist.');
        return;
      }

      let result;
      if (mode === 'ai') {
        this.$('#wl-analyze-status').textContent = 'Fetching video details...';
        await WLEnrich.enrich(videos);
        if (this._analyseCancelled) return;

        this.$('#wl-analyze-status').textContent = 'Categorizing with AI...';
        result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos, playlistId });
      } else {
        this.$('#wl-analyze-status').textContent = 'Sorting by duration...';
        result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos });
      }
      if (this._analyseCancelled) return;

      if (!result.success) {
        this.showError(result.error);
        return;
      }

      this.lastVideoHash = this.hashVideoIds(videos);
      this.renderPreview(result.sortOrder);
      this.showState('preview');
    } catch (err) {
      if (!this._analyseCancelled) this.showError(err.message);
    }
  },
```

Note this drops the previous cached-result shortcut. It compared a hash and reused `currentSortOrder`, but with two modes the cache would return the wrong mode's ordering. Correctness beats saving one API call.

- [ ] **Step 3: Style the idle action row**

In `styles/panel.css`, replace the `#wl-state-idle .wl-yt-btn { width: 100%; }` rule with:

```css
/* Idle actions — two modes, side by side, sharing the width */
.wl-idle-actions {
  display: flex;
  gap: 8px;
  margin-top: 0;
}
.wl-idle-actions .wl-yt-btn {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 4: Write the mode test**

Append to `tests/panel.test.js`:

```js
describe('runSort mode selection', () => {
  it('sends SORT_BY_DURATION and never enriches in duration mode', async () => {
    const sent = [];
    let enriched = false;
    const panel = loadPanelWithStubs({
      sendMessage: async (msg) => { sent.push(msg); return { success: true, sortOrder: [] }; },
      enrich: async () => { enriched = true; },
      videos: [{ id: 'a', setVideoId: 'A', duration: 60, percentWatched: 0 }],
    });

    await panel.runSort('duration');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'SORT_BY_DURATION');
    assert.equal(enriched, false, 'duration mode must not pay for enrichment');
  });

  it('enriches and sends ANALYZE with a playlistId in ai mode', async () => {
    const sent = [];
    let enriched = false;
    const panel = loadPanelWithStubs({
      sendMessage: async (msg) => { sent.push(msg); return { success: true, sortOrder: [] }; },
      enrich: async () => { enriched = true; },
      videos: [{ id: 'a', setVideoId: 'A', duration: 60, percentWatched: 0 }],
    });

    await panel.runSort('ai');

    assert.equal(enriched, true);
    assert.equal(sent[0].type, 'ANALYZE');
    assert.ok(sent[0].playlistId, 'ANALYZE must carry the playlistId');
  });
});
```

`loadPanelWithStubs` is a helper you write: it wires `chrome.runtime.sendMessage`, `WLPlaylist.read`, and `WLEnrich.enrich` stubs into the sandbox, plus enough `document` stub for `showState`/`$` to work. If some part of the panel proves untestable without a fuller DOM, cover what you can and say plainly in your report what you could not.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add content/panel.js styles/panel.css tests/panel.test.js
git commit -m "feat(panel): offer duration and AI sort as explicit modes"
```

---

### Task 3: Reload after a successful sort

**Files:**
- Modify: `content/panel.js`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `WLPlaylist.applyOrder`
- Produces: a reload roughly 1.2s after a confirmed sort

- [ ] **Step 1: Write the failing test**

Append to `tests/panel.test.js`:

```js
describe('post-sort reload', () => {
  it('reloads after a confirmed sort', async () => {
    let reloaded = false;
    const panel = loadPanelWithStubs({
      applyOrder: async () => ({ applied: true, waitedMs: 1200 }),
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
    });

    await panel.applySort();
    assert.equal(reloaded, true);
  });

  it('does NOT reload when the order never converged', async () => {
    let reloaded = false;
    const panel = loadPanelWithStubs({
      applyOrder: async () => ({ applied: false, waitedMs: 10000 }),
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
    });

    await panel.applySort();
    assert.equal(reloaded, false, 'a failed sort must leave the error on screen');
  });
});
```

Have your `loadPanelWithStubs` helper stub `location.reload` and run `setTimeout` callbacks synchronously when `runTimers` is set, so the test doesn't wait 1.2 real seconds.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/panel.test.js`
Expected: FAIL — no reload occurs

- [ ] **Step 3: Reload on success**

In the `#wl-apply-btn` handler (or `applySort` if you extracted one in Task 2), replace the success branch:

```js
      if (result.applied) {
        this.showIdleWithMessage(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
        // YouTube's DOM does not reflect the reordered playlist, so a successful
        // sort otherwise looks like nothing happened. Pause briefly so the
        // confirmation is readable, then reload.
        setTimeout(() => location.reload(), 1200);
      } else {
        this.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
      }
```

Leave the failure branch alone — it must NOT reload, or the error vanishes before it can be read.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/panel.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && ./build.sh`
Expected: `fail 0`, build exits 0

- [ ] **Step 6: Commit**

```bash
git add content/panel.js tests/panel.test.js
git commit -m "feat(panel): reload after a confirmed sort so the new order is visible"
```

---

### Task 4: Manual verification

Not automatable — requires a real account.

- [ ] **Step 1: Rebuild and reload**

```bash
./build.sh
```

Then reload the temporary add-on at `about:debugging#/runtime/this-firefox`.

- [ ] **Step 2: Verify on the throwaway playlist**

1. Load the playlist fresh (`Cmd+Shift+R`). **The panel appears without touching the toolbar button.**
2. Navigate away to another playlist and back — the panel appears both times.
3. Click **Sort by duration** — instant, no API key needed, preview is a flat list ordered by length.
4. Apply → confirmation shows, page reloads on its own, order matches the preview.

- [ ] **Step 3: Verify on Watch Later — this is the untested path**

1. Click **Analyze & sort**. It should take a few seconds (enrichment plus Claude), unlike duration mode.
2. Preview shows taxonomy group headings.
3. Apply → reloads, order matches.
4. **Now break the API key** in the extension popup and click **Analyze & sort** again. An error naming the failure must appear. This is the check that was inadvertently skipped before, because the earlier attempt ran on a non-Watch-Later playlist and never called Claude at all.

- [ ] **Step 4: Verify ghost handling**

On a playlist containing a deleted or private video, confirm those entries land in an `Unavailable` group at the end rather than inside a topic group. If they don't, `content/playlist.js` infers `unavailable` from a falsy title and should instead read `isPlayable` from the renderer.

## Done when

- The panel appears on load without any toolbar interaction
- Both sort modes are visible and behave distinguishably
- A successful sort reloads by itself; a failed one does not
- The API-key error path is confirmed on Watch Later
