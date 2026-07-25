# Modal Preview and Unwatched Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `2026-07-25-innertube-foundation.md` must be complete. This plan consumes `WLPlaylist`, `WLEnrich`, and the background `RESORT` handler.

**Goal:** Replace the cramped inline preview with a modal overlay whose action buttons are always reachable, and add per-video "treat as unwatched" toggles that correct videos YouTube wrongly marked as watched.

**Architecture:** The modal is a self-contained content-script global that renders a sort order and emits callbacks. It owns no sorting logic — toggles round-trip through the background's `RESORT` handler so ordering rules live in exactly one place.

**Tech Stack:** Vanilla JS, no framework. CSS grid for the modal shell. Node's built-in `node:test`.

## Global Constraints

- **Firefox is the primary target.** Chrome is secondary.
- **Content scripts cannot be ES modules.** Files under `content/` define one global and are load-ordered by the manifest.
- **Test runner:** `node --test tests/*.test.js`. The glob is required.
- **Commits:** Conventional Commits. Never add AI attribution to any git artifact.
- **Accessibility baseline: WCAG 2.1 AA.** The modal needs a focus trap, Escape to close, focus restoration, and `aria-modal`. These are requirements, not enhancements.
- **No DOM tests.** The repo has no jsdom and adds no dependencies — pure helpers are unit-tested, DOM rendering is verified manually.
- **Watched threshold:** `percentWatched < 10` is unwatched. Exactly 10 is watched.

---

### Task 1: WLStorage — override persistence

**Files:**
- Create: `content/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local`
- Produces:
  - `WLStorage.getOverrides() → Promise<string[]>`
  - `WLStorage.toggleOverride(videoId: string) → Promise<string[]>` — returns the new list
  - `WLStorage.setGroupMap(map: object) → Promise<void>`
  - `WLStorage.getGroupMap() → Promise<object>`

- [ ] **Step 1: Write the failing test**

Create `tests/storage.test.js`:

```js
// tests/storage.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

function load(initial = {}) {
  const store = { ...initial };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        async set(values) {
          Object.assign(store, values);
        },
      },
    },
  };
  return { api: loadGlobal('content/storage.js', 'WLStorage', { chrome }), store };
}

describe('WLStorage.getOverrides', () => {
  it('returns an empty array when nothing is stored', async () => {
    const { api } = load();
    assert.deepEqual(await api.getOverrides(), []);
  });

  it('returns stored overrides', async () => {
    const { api } = load({ unwatchedOverrides: ['a', 'b'] });
    assert.deepEqual(await api.getOverrides(), ['a', 'b']);
  });
});

describe('WLStorage.toggleOverride', () => {
  it('adds a video that was not overridden', async () => {
    const { api } = load();
    assert.deepEqual(await api.toggleOverride('a'), ['a']);
  });

  it('removes a video that was already overridden', async () => {
    const { api } = load({ unwatchedOverrides: ['a', 'b'] });
    assert.deepEqual(await api.toggleOverride('a'), ['b']);
  });

  it('persists the change', async () => {
    const { api, store } = load();
    await api.toggleOverride('a');
    assert.deepEqual(store.unwatchedOverrides, ['a']);
  });

  it('does not duplicate on repeated adds', async () => {
    const { api } = load({ unwatchedOverrides: ['a'] });
    await api.toggleOverride('b');
    const result = await api.toggleOverride('b');
    assert.deepEqual(result, ['a']);
  });
});

describe('WLStorage group map', () => {
  it('round-trips a group map', async () => {
    const { api } = load();
    await api.setGroupMap({ v1: 'Music' });
    assert.deepEqual(await api.getGroupMap(), { v1: 'Music' });
  });

  it('returns an empty object when nothing is stored', async () => {
    const { api } = load();
    assert.deepEqual(await api.getGroupMap(), {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/storage.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/storage.js'`

- [ ] **Step 3: Write the implementation**

Create `content/storage.js`:

```js
// content/storage.js
// Typed wrapper over chrome.storage.local. Overrides are intentionally
// per-device — they describe how this machine's user reads the list.

const WLStorage = {
  async getOverrides() {
    const data = await chrome.storage.local.get('unwatchedOverrides');
    return data.unwatchedOverrides || [];
  },

  async toggleOverride(videoId) {
    const current = await this.getOverrides();
    const next = current.includes(videoId)
      ? current.filter(id => id !== videoId)
      : [...current, videoId];

    await chrome.storage.local.set({ unwatchedOverrides: next });
    return next;
  },

  async getGroupMap() {
    const data = await chrome.storage.local.get('groupMap');
    return data.groupMap || {};
  },

  async setGroupMap(map) {
    await chrome.storage.local.set({ groupMap: map });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/storage.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add content/storage.js tests/storage.test.js
git commit -m "feat(storage): persist unwatched overrides and group map"
```

---

### Task 2: Display grouping helpers

The modal needs a sort order turned into renderable groups. Pure functions, so they get real tests.

**Files:**
- Create: `content/modal.js`
- Test: `tests/modal.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `WLModal.IN_PROGRESS_LABEL = '▶ In Progress'`
  - `WLModal.toGroups(sortOrder) → [{name, videos}]`
  - `WLModal.formatDuration(seconds) → string`
  - `WLModal.metaFor(video) → string`

- [ ] **Step 1: Write the failing test**

Create `tests/modal.test.js`:

```js
// tests/modal.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

const load = () => loadGlobal('content/modal.js', 'WLModal', { document: undefined });

function video(overrides = {}) {
  return {
    id: 'v', title: 'T', duration: 600, percentWatched: 0,
    cluster: 'Music', unavailable: false, ...overrides,
  };
}

describe('WLModal.toGroups', () => {
  it('returns an empty array for an empty order', () => {
    assert.deepEqual(load().toGroups([]), []);
  });

  it('groups consecutive videos sharing a cluster', () => {
    const groups = load().toGroups([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].videos.map(v => v.id), ['a', 'b']);
    assert.equal(groups[1].name, 'Tech & AI');
  });

  it('labels the null cluster as in progress', () => {
    const modal = load();
    const groups = modal.toGroups([video({ cluster: null })]);
    assert.equal(groups[0].name, modal.IN_PROGRESS_LABEL);
  });

  it('starts a new group when a cluster name repeats non-consecutively', () => {
    const groups = load().toGroups([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(groups.length, 3);
  });
});

describe('WLModal.formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    assert.equal(load().formatDuration(125), '2:05');
  });

  it('formats an hour or more as h:mm:ss', () => {
    assert.equal(load().formatDuration(3725), '1:02:05');
  });

  it('formats zero', () => {
    assert.equal(load().formatDuration(0), '0:00');
  });

  it('pads seconds below ten', () => {
    assert.equal(load().formatDuration(65), '1:05');
  });
});

describe('WLModal.metaFor', () => {
  it('shows remaining time for in-progress videos', () => {
    assert.equal(load().metaFor(video({ cluster: null, duration: 600, percentWatched: 50 })), '5:00 left');
  });

  it('shows total duration for unwatched videos', () => {
    assert.equal(load().metaFor(video({ duration: 600 })), '10:00');
  });

  it('shows a marker for unavailable videos', () => {
    assert.equal(load().metaFor(video({ unavailable: true })), 'unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/modal.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/modal.js'`

- [ ] **Step 3: Write the helpers**

Create `content/modal.js`:

```js
// content/modal.js
// Preview overlay. Pure rendering plus callbacks — owns no sorting logic.

const WLModal = {
  IN_PROGRESS_LABEL: '▶ In Progress',

  _root: null,
  _lastFocused: null,
  _handlers: {},

  /** Collapse a flat sort order into consecutive runs sharing a cluster. */
  toGroups(sortOrder) {
    const groups = [];
    let current = null;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (!current || current.name !== name) {
        current = { name, videos: [] };
        groups.push(current);
      }
      current.videos.push(video);
    }
    return groups;
  },

  formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  },

  metaFor(video) {
    if (video.unavailable) return 'unavailable';
    if (video.cluster === null) {
      return `${this.formatDuration(video.duration * (1 - video.percentWatched / 100))} left`;
    }
    return this.formatDuration(video.duration);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/modal.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add content/modal.js tests/modal.test.js
git commit -m "feat(modal): add display grouping and duration formatting helpers"
```

---

### Task 3: Modal shell, styles, and accessibility

The layout bug being fixed: the old panel lived inside the sidebar's scroll container, so Apply/Cancel scrolled out of reach. The modal uses a three-row grid — header, scrolling body, pinned footer — so only the list ever scrolls.

**Files:**
- Modify: `content/modal.js`
- Create: `styles/modal.css`
- Modify: `build.sh`
- Modify: `manifest.chrome.json`, `manifest.firefox.json`

**Interfaces:**
- Consumes: `WLModal.toGroups`, `WLModal.metaFor` from Task 2
- Produces:
  - `WLModal.show(sortOrder, {onApply, onCancel, onToggleUnwatched}) → void`
  - `WLModal.close() → void`
  - `WLModal.update(sortOrder) → void`
  - `WLModal.setStatus(text) → void`
  - `WLModal.showError(message) → void`

- [ ] **Step 1: Write the stylesheet**

Create `styles/modal.css`:

```css
/* styles/modal.css — preview overlay */

.wl-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.wl-modal {
  /* Three rows: header, scrolling body, pinned footer.
     Only the body scrolls — this is the fix for the old layout. */
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(680px, 100%);
  max-height: min(85vh, 900px);
  background: #212121;
  color: #f1f1f1;
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  font-family: 'Roboto', 'Arial', sans-serif;
  overflow: hidden;
}

.wl-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 12px;
  border-bottom: 1px solid #3f3f3f;
}

.wl-modal-title {
  flex: 1;
  margin: 0;
  font-size: 1.8rem;
  font-weight: 500;
}

.wl-modal-status {
  color: #aaa;
  font-size: 1.3rem;
}

.wl-modal-body {
  overflow-y: auto;
  padding: 8px 24px;
}

.wl-modal-footer {
  display: flex;
  gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid #3f3f3f;
}

.wl-group-heading {
  position: sticky;
  top: 0;
  background: #212121;
  padding: 14px 0 6px;
  margin: 0;
  font-size: 1.3rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #69b3ff;
}
.wl-group-heading.wl-in-progress { color: #ff8a80; }

.wl-modal-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0 6px 12px;
  font-size: 1.4rem;
  line-height: 2rem;
}

.wl-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-modal-item.wl-unavailable .wl-item-title {
  color: #909090;
  font-style: italic;
}

.wl-item-meta {
  color: #aaa;
  font-size: 1.3rem;
  white-space: nowrap;
}

.wl-unwatch-btn {
  flex-shrink: 0;
  padding: 2px 10px;
  border: 1px solid #5f5f5f;
  border-radius: 12px;
  background: transparent;
  color: #f1f1f1;
  font-size: 1.2rem;
  cursor: pointer;
}
.wl-unwatch-btn:hover { background: rgba(255, 255, 255, 0.12); }
.wl-unwatch-btn[aria-pressed="true"] {
  background: #f1f1f1;
  color: #0f0f0f;
  border-color: #f1f1f1;
}

/* Visible focus for keyboard users — required for WCAG 2.1 AA. */
.wl-modal :focus-visible {
  outline: 2px solid #69b3ff;
  outline-offset: 2px;
}

.wl-modal-error {
  margin: 8px 0;
  color: #ff8a80;
  font-size: 1.4rem;
}

@media (prefers-reduced-motion: no-preference) {
  .wl-modal { animation: wl-modal-in 0.15s ease-out; }
  @keyframes wl-modal-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }
}
```

- [ ] **Step 2: Write the modal shell**

Append these methods to the `WLModal` object in `content/modal.js`:

```js
  show(sortOrder, handlers = {}) {
    this.close();
    this._handlers = handlers;
    this._lastFocused = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'wl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-modal-title">
        <div class="wl-modal-header">
          <h2 class="wl-modal-title" id="wl-modal-title">Proposed Sort Order</h2>
          <span class="wl-modal-status" id="wl-modal-status"></span>
        </div>
        <div class="wl-modal-body" id="wl-modal-body"></div>
        <div class="wl-modal-footer">
          <button class="wl-yt-btn wl-btn-filled" id="wl-modal-apply">Apply Sort</button>
          <button class="wl-yt-btn" id="wl-modal-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this._root = backdrop;

    this.update(sortOrder);
    this._bindEvents();

    // Move focus into the dialog so keyboard users land in the right place.
    this._root.querySelector('#wl-modal-apply').focus();
  },

  _bindEvents() {
    const apply = this._root.querySelector('#wl-modal-apply');
    const cancel = this._root.querySelector('#wl-modal-cancel');

    apply.addEventListener('click', () => this._handlers.onApply?.());
    cancel.addEventListener('click', () => {
      this.close();
      this._handlers.onCancel?.();
    });

    // Clicking the backdrop cancels; clicking inside the dialog does not.
    this._root.addEventListener('mousedown', (event) => {
      if (event.target === this._root) {
        this.close();
        this._handlers.onCancel?.();
      }
    });

    this._keyHandler = (event) => {
      if (event.key === 'Escape') {
        this.close();
        this._handlers.onCancel?.();
        return;
      }
      if (event.key === 'Tab') this._trapFocus(event);
    };
    document.addEventListener('keydown', this._keyHandler, true);
  },

  /** Keep Tab inside the dialog — required for WCAG 2.1 AA. */
  _trapFocus(event) {
    const focusable = this._root.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  update(sortOrder) {
    if (!this._root) return;

    const body = this._root.querySelector('#wl-modal-body');
    body.textContent = '';

    for (const group of this.toGroups(sortOrder)) {
      const heading = document.createElement('h3');
      heading.className = group.name === this.IN_PROGRESS_LABEL
        ? 'wl-group-heading wl-in-progress'
        : 'wl-group-heading';
      heading.textContent = group.name;
      body.appendChild(heading);

      for (const video of group.videos) {
        body.appendChild(this._renderItem(video));
      }
    }
  },

  _renderItem(video) {
    const row = document.createElement('div');
    row.className = video.unavailable ? 'wl-modal-item wl-unavailable' : 'wl-modal-item';

    const title = document.createElement('span');
    title.className = 'wl-item-title';
    title.textContent = video.title;

    const meta = document.createElement('span');
    meta.className = 'wl-item-meta';
    meta.textContent = this.metaFor(video);

    row.append(title, meta);

    // Offer the toggle only where it can help: videos YouTube considers watched.
    if (!video.unavailable && video.percentWatched > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'wl-unwatch-btn';
      toggle.type = 'button';
      toggle.textContent = 'Unwatched';
      toggle.setAttribute('aria-pressed', String(video.cluster !== null));
      toggle.setAttribute('aria-label', `Treat "${video.title}" as unwatched`);
      toggle.addEventListener('click', () => this._handlers.onToggleUnwatched?.(video.id));
      row.appendChild(toggle);
    }
    return row;
  },

  setStatus(text) {
    const status = this._root?.querySelector('#wl-modal-status');
    if (status) status.textContent = text;
  },

  showError(message) {
    const body = this._root?.querySelector('#wl-modal-body');
    if (!body) return;

    const error = document.createElement('p');
    error.className = 'wl-modal-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    body.prepend(error);
  },

  close() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this._root?.remove();
    this._root = null;

    // Return focus where the user left it.
    this._lastFocused?.focus?.();
    this._lastFocused = null;
  },
```

- [ ] **Step 3: Verify the helper tests still pass**

The added methods touch `document`, but the Task 2 tests only call pure helpers.

Run: `node --test tests/modal.test.js`
Expected: PASS, 11 tests

- [ ] **Step 4: Register the stylesheet and script**

In both `manifest.chrome.json` and `manifest.firefox.json`, update the content script entry:

```json
      "js": ["content/selectors.js", "content/innertube.js", "content/playlist.js", "content/enrich.js", "content/storage.js", "content/modal.js", "content/panel.js"],
      "css": ["styles/content.css", "styles/panel.css", "styles/modal.css"]
```

- [ ] **Step 5: Add the new files to build.sh**

In `build.sh`, add to the `SHARED` array after `content/enrich.js`:

```bash
  content/storage.js
  content/modal.js
```

And after `styles/panel.css`:

```bash
  styles/modal.css
```

- [ ] **Step 6: Verify the build**

Run: `./build.sh && ls dist/firefox/content/ dist/firefox/styles/`
Expected: `content/` lists `modal.js` and `storage.js`; `styles/` lists `modal.css`

- [ ] **Step 7: Commit**

```bash
git add content/modal.js styles/modal.css manifest.chrome.json manifest.firefox.json build.sh
git commit -m "feat(modal): add accessible overlay with pinned actions and scrolling body"
```

---

### Task 4: Wire the modal into the flow

**Files:**
- Modify: `content/panel.js`
- Modify: `styles/panel.css`

**Interfaces:**
- Consumes: `WLModal.show/update/close`, `WLStorage.toggleOverride`, background `RESORT`
- Produces: end-to-end flow where toggling recomputes order without calling Claude

- [ ] **Step 1: Remove the inline preview markup**

In `content/panel.js`, delete the entire preview state block from `panel.innerHTML`:

```html
      <!-- Preview state -->
      <div id="wl-state-preview" class="wl-hidden">
        ...
      </div>
```

- [ ] **Step 2: Drop preview from the state list**

In `showState`, change:

```js
    const states = ['idle', 'analyzing', 'preview', 'sorting', 'error'];
```

to:

```js
    const states = ['idle', 'analyzing', 'sorting', 'error'];
```

- [ ] **Step 3: Show the modal instead of the inline preview**

In the `#wl-analyze-btn` handler, replace both occurrences of:

```js
        this.renderPreview(result.sortOrder);
        this.showState('preview');
```

and:

```js
          this.renderPreview(this.currentSortOrder);
          this.showState('preview');
```

with a call to a new method:

```js
        this.openPreview(result.sortOrder);
```

and:

```js
          this.openPreview(this.currentSortOrder);
```

respectively.

- [ ] **Step 4: Add the preview controller**

Replace the whole `renderPreview` method in `content/panel.js` with:

```js
  openPreview(sortOrder) {
    this.currentSortOrder = sortOrder;
    this.showState('idle');

    WLModal.show(sortOrder, {
      onApply: () => this.applySort(),
      onCancel: () => {
        this.currentSortOrder = [];
        this.lastVideoHash = null;
      },
      onToggleUnwatched: (videoId) => this.toggleUnwatched(videoId),
    });
  },

  /** Recompute against cached clusters. Never re-calls Claude. */
  async toggleUnwatched(videoId) {
    WLModal.setStatus('Re-sorting...');

    const overrides = await WLStorage.toggleOverride(videoId);
    const playlistId = new URL(location.href).searchParams.get('list');

    // playlistId is required: the background validates it against its cached
    // clusters, so a stale cache from another playlist errors instead of
    // silently returning that playlist's ordering.
    const result = await chrome.runtime.sendMessage({ type: 'RESORT', overrides, playlistId });

    if (!result.success) {
      WLModal.setStatus('');
      WLModal.showError(result.error);
      return;
    }

    this.currentSortOrder = result.sortOrder;
    WLModal.update(result.sortOrder);
    WLModal.setStatus('');
  },

  async applySort() {
    const playlistId = new URL(location.href).searchParams.get('list');
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    WLModal.setStatus(`Applying ${orderedSetVideoIds.length} moves...`);

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
    } catch (err) {
      WLModal.setStatus('');
      WLModal.showError(err.message);
      return;
    }

    WLModal.close();

    if (result.applied) {
      this.showIdleWithMessage(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s.`);
    } else {
      this.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
    }
  },
```

- [ ] **Step 5: Remove the superseded apply handler**

In `bindEvents`, delete the entire `#wl-apply-btn` and `#wl-cancel-btn` listeners — those elements no longer exist. The modal's own buttons replace them.

- [ ] **Step 6: Remove dead preview styles**

In `styles/panel.css`, delete these now-unused rules:

```css
#wl-state-preview .wl-expanded { ... }
#wl-preview-list { ... }
.wl-cluster-label { ... }
.wl-cluster-label.wl-in-progress { ... }
.wl-cluster-label.wl-topic { ... }
.wl-preview-item { ... }
.wl-preview-title { ... }
.wl-preview-meta { ... }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Verify the build**

Run: `./build.sh && node --check dist/firefox/background/background.bundle.js`
Expected: exit 0

- [ ] **Step 9: Manual verification in Firefox**

Load `dist/firefox/` via `about:debugging#/runtime/this-firefox`, then on Watch Later:

1. Click **Analyze & sort** — the modal opens centred over a dimmed page
2. **Apply Sort** and **Cancel** are visible without scrolling, with 31 videos listed
3. Scroll the list — only the body scrolls; the footer stays put and headings stick
4. Press `Tab` repeatedly — focus cycles inside the modal and never escapes to the page
5. Press `Escape` — the modal closes and focus returns to the trigger button
6. Click **Unwatched** on an in-progress video — it moves into its topic group. Open the Network tab and confirm **no request to `api.anthropic.com`** fires
7. Click it again — the video returns to the in-progress group
8. Reload the page and re-analyze — the override persists
9. **Apply Sort** — completes in seconds and the playlist matches the preview

- [ ] **Step 10: Commit**

```bash
git add content/panel.js styles/panel.css
git commit -m "feat: replace inline preview with modal and unwatched overrides"
```

---

## Done when

- `npm test` passes
- Apply/Cancel are reachable without scrolling at any list length
- Tab stays inside the modal; Escape closes it and restores focus
- Toggling "Unwatched" reorders with no Claude request
- Overrides survive a page reload
