# Floating Trigger and Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** `2026-07-25-modal-and-overrides.md`. That plan assumed the trigger stayed injected into YouTube's header; it does not.

**Prerequisite:** `2026-07-25-innertube-foundation.md` and `2026-07-26-panel-usability-fixes.md` complete.

**Goal:** Stop anchoring into YouTube's markup. Replace the header-injected panel with a floating trigger button and a modal that owns every state — mode choice, progress, preview, and actions — plus per-video "treat as unwatched" overrides.

**Architecture:** The extension's entire UI becomes two elements it owns outright: a fixed-position trigger and a modal overlay. Neither depends on a YouTube selector, which eliminates the recurring class of bug where a layout change makes the panel vanish. The modal is a self-contained content-script global that renders state and emits callbacks; it owns no sorting logic.

**Tech Stack:** Vanilla JS, no framework. CSS grid for the modal shell. Node's built-in `node:test`.

## Global Constraints

- **Firefox is the primary target.** Chrome is secondary.
- **`content/` files are NOT ES modules.** One global each, load-ordered by the manifest. Never add `import`/`export` to a `content/` file.
- **Test runner:** `node --test tests/*.test.js`. The glob is required.
- **Do NOT modify `tests/helpers/load-global.js`.** Normalise vm-realm arrays at the assertion site by spreading.
- **Commits:** Conventional Commits. Never add AI attribution to any git artifact.
- **Accessibility baseline: WCAG 2.1 AA.** The modal needs a focus trap, Escape to close, focus restoration, and `aria-modal`. These are requirements, not enhancements.
- **No YouTube selectors for our own UI.** `SELECTORS` remains only for the heading injection that a later plan adds.
- **Only a confirmed sort reloads.** `applied: false` and thrown errors must leave the error readable.
- 109 tests currently pass. All must keep passing.

## Why this replaces the header panel

The panel anchored to `.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer` and `.page-header-sidebar yt-flexible-actions-view-model`. Both are YouTube's internal element names. Manual testing showed the same build injecting on Watch Later but not on a regular playlist. The previous fix removed a layout gate and added retries, which addressed a symptom; the cause is that we are reading someone else's markup at all. A fixed-position element we create has nothing to break.

---

### Task 1: WLStorage — override persistence

**Files:**
- Create: `content/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `chrome.storage.local`
- Produces:
  - `WLStorage.getOverrides() → Promise<string[]>`
  - `WLStorage.toggleOverride(videoId) → Promise<string[]>` — returns the new list
  - `WLStorage.setGroupMap(map) → Promise<void>`
  - `WLStorage.getGroupMap() → Promise<object>`

**Note:** overrides are deliberately GLOBAL, not scoped per playlist. An override asserts "YouTube's watch data for this video is wrong" — a property of the video, not the list. This was ruled on explicitly; do not add playlist scoping.

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
        async get(key) { return key in store ? { [key]: store[key] } : {}; },
        async set(values) { Object.assign(store, values); },
      },
    },
  };
  return { api: loadGlobal('content/storage.js', 'WLStorage', { chrome }), store };
}

describe('WLStorage.getOverrides', () => {
  it('returns an empty array when nothing is stored', async () => {
    const { api } = load();
    assert.deepEqual([...(await api.getOverrides())], []);
  });

  it('returns stored overrides', async () => {
    const { api } = load({ unwatchedOverrides: ['a', 'b'] });
    assert.deepEqual([...(await api.getOverrides())], ['a', 'b']);
  });
});

describe('WLStorage.toggleOverride', () => {
  it('adds a video that was not overridden', async () => {
    const { api } = load();
    assert.deepEqual([...(await api.toggleOverride('a'))], ['a']);
  });

  it('removes a video that was already overridden', async () => {
    const { api } = load({ unwatchedOverrides: ['a', 'b'] });
    assert.deepEqual([...(await api.toggleOverride('a'))], ['b']);
  });

  it('persists the change', async () => {
    const { api, store } = load();
    await api.toggleOverride('a');
    assert.deepEqual([...store.unwatchedOverrides], ['a']);
  });

  it('does not duplicate on repeated adds', async () => {
    const { api } = load({ unwatchedOverrides: ['a'] });
    await api.toggleOverride('b');
    assert.deepEqual([...(await api.toggleOverride('b'))], ['a']);
  });
});

describe('WLStorage group map', () => {
  it('round-trips a group map', async () => {
    const { api } = load();
    await api.setGroupMap({ v1: 'Music' });
    assert.deepEqual({ ...(await api.getGroupMap()) }, { v1: 'Music' });
  });

  it('returns an empty object when nothing is stored', async () => {
    const { api } = load();
    assert.deepEqual({ ...(await api.getGroupMap()) }, {});
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
// Typed wrapper over chrome.storage.local.
//
// Overrides are intentionally global rather than per-playlist: an override says
// "YouTube's watch data for this video is wrong", which is true regardless of
// which list you are viewing it from.

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

### Task 2: Display helpers for the modal

Pure functions, so they get real tests.

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
    assert.deepEqual([...load().toGroups([])], []);
  });

  it('groups consecutive videos sharing a cluster', () => {
    const groups = load().toGroups([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual([...groups[0].videos.map(v => v.id)], ['a', 'b']);
    assert.equal(groups[1].name, 'Tech & AI');
  });

  it('labels the null cluster as in progress', () => {
    const modal = load();
    assert.equal(modal.toGroups([video({ cluster: null })])[0].name, modal.IN_PROGRESS_LABEL);
  });

  it('treats a video with no cluster property as its own unlabelled group', () => {
    // buildDurationSortOrder returns videos with no cluster key at all.
    const groups = load().toGroups([{ id: 'a', title: 'T', duration: 60 }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, null, 'duration mode must not render a heading');
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
  it('formats under an hour as m:ss', () => { assert.equal(load().formatDuration(125), '2:05'); });
  it('formats an hour or more as h:mm:ss', () => { assert.equal(load().formatDuration(3725), '1:02:05'); });
  it('formats zero', () => { assert.equal(load().formatDuration(0), '0:00'); });
  it('pads seconds below ten', () => { assert.equal(load().formatDuration(65), '1:05'); });
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

  it('never produces NaN when percentWatched is missing', () => {
    // Regression: the old panel read a deleted `progress` field and rendered NaN:NaN.
    assert.ok(!load().metaFor({ cluster: null, duration: 600 }).includes('NaN'));
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
// The extension's entire preview UI. Owns no sorting logic — renders state and
// emits callbacks. Deliberately not anchored to any YouTube element.

const WLModal = {
  IN_PROGRESS_LABEL: '▶ In Progress',

  _root: null,
  _lastFocused: null,
  _handlers: {},
  _keyHandler: null,

  /**
   * Collapse a flat sort order into consecutive runs sharing a cluster.
   * A video with no `cluster` property at all (duration mode) yields a group
   * named null, which renders without a heading.
   */
  toGroups(sortOrder) {
    const groups = [];
    let current = null;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL
        : video.cluster === undefined ? null
        : video.cluster;

      if (!current || current.name !== name) {
        current = { name, videos: [] };
        groups.push(current);
      }
      current.videos.push(video);
    }
    return groups;
  },

  formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
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
      const pct = Number(video.percentWatched) || 0;
      return `${this.formatDuration(video.duration * (1 - pct / 100))} left`;
    }
    return this.formatDuration(video.duration);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/modal.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add content/modal.js tests/modal.test.js
git commit -m "feat(modal): add display grouping and duration formatting helpers"
```

---

### Task 3: Floating trigger and modal shell

**Files:**
- Modify: `content/modal.js`
- Create: `styles/modal.css`
- Modify: `manifest.chrome.json`, `manifest.firefox.json`
- Modify: `build.sh`

**Interfaces:**
- Consumes: `WLModal.toGroups`, `WLModal.metaFor`
- Produces:
  - `WLModal.mountTrigger({onOpen}) → void` — idempotent
  - `WLModal.removeTrigger() → void`
  - `WLModal.open({onSort, onApply, onCancel, onToggleUnwatched}) → void`
  - `WLModal.close() → void`
  - `WLModal.showModes() / showBusy(text) / showPreview(sortOrder) / showError(message)`

- [ ] **Step 1: Write the stylesheet**

Create `styles/modal.css`:

```css
/* styles/modal.css — floating trigger and preview modal.
   Both elements are owned entirely by the extension: no YouTube selectors,
   nothing to break when YouTube changes its markup. */

.wl-trigger {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147482000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border: none;
  border-radius: 22px;
  background: #f1f1f1;
  color: #0f0f0f;
  font-family: 'Roboto', 'Arial', sans-serif;
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}
.wl-trigger:hover { background: #fff; }
.wl-trigger svg { width: 20px; height: 20px; }

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
     Only the body scrolls — the actions are always reachable. */
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
.wl-modal-title { flex: 1; margin: 0; font-size: 1.8rem; font-weight: 500; }
.wl-modal-status { color: #aaa; font-size: 1.3rem; }

.wl-modal-body { overflow-y: auto; padding: 8px 24px; }
.wl-modal-footer {
  display: flex;
  gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid #3f3f3f;
}

.wl-modal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 20px;
  border: none;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.1);
  color: #f1f1f1;
  font-family: inherit;
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
}
.wl-modal-btn:hover { background: rgba(255, 255, 255, 0.2); }
.wl-modal-btn.wl-primary { background: #f1f1f1; color: #0f0f0f; }
.wl-modal-btn.wl-primary:hover { background: #d9d9d9; }

.wl-mode-choice { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
.wl-mode-btn {
  display: block;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid #3f3f3f;
  border-radius: 8px;
  background: transparent;
  color: #f1f1f1;
  font-family: inherit;
  font-size: 1.5rem;
  text-align: left;
  cursor: pointer;
}
.wl-mode-btn:hover { background: rgba(255, 255, 255, 0.08); }
.wl-mode-btn small { display: block; margin-top: 4px; color: #aaa; font-size: 1.2rem; }

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
.wl-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-modal-item.wl-unavailable .wl-item-title { color: #909090; font-style: italic; }
.wl-item-meta { color: #aaa; font-size: 1.3rem; white-space: nowrap; }

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
  background: #f1f1f1; color: #0f0f0f; border-color: #f1f1f1;
}

/* Visible focus for keyboard users — required for WCAG 2.1 AA. */
.wl-modal :focus-visible, .wl-trigger:focus-visible {
  outline: 2px solid #69b3ff;
  outline-offset: 2px;
}

.wl-modal-error { margin: 8px 0; color: #ff8a80; font-size: 1.4rem; }

.wl-progress-bar {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  height: 4px;
  overflow: hidden;
  margin: 16px 0;
}
.wl-progress-fill {
  background: #f1f1f1;
  height: 100%;
  width: 30%;
  border-radius: 4px;
  animation: wl-indeterminate 1.5s ease-in-out infinite;
}
@keyframes wl-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

- [ ] **Step 2: Write the trigger and modal shell**

Append these methods to the `WLModal` object in `content/modal.js`:

```js
  // ── Trigger ────────────────────────────────────────────────────────────

  /** Idempotent: safe to call on every navigation. */
  mountTrigger({ onOpen }) {
    if (document.querySelector('#wl-trigger')) return;

    const button = document.createElement('button');
    button.id = 'wl-trigger';
    button.className = 'wl-trigger';
    button.type = 'button';
    button.setAttribute('aria-label', 'Organize this playlist');
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>Organize`;
    button.addEventListener('click', () => onOpen());

    document.body.appendChild(button);
  },

  removeTrigger() {
    document.querySelector('#wl-trigger')?.remove();
  },

  // ── Modal shell ────────────────────────────────────────────────────────

  open(handlers = {}) {
    this.close();
    this._handlers = handlers;
    this._lastFocused = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'wl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-modal-title">
        <div class="wl-modal-header">
          <h2 class="wl-modal-title" id="wl-modal-title">Organize playlist</h2>
          <span class="wl-modal-status" id="wl-modal-status"></span>
        </div>
        <div class="wl-modal-body" id="wl-modal-body"></div>
        <div class="wl-modal-footer" id="wl-modal-footer"></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this._root = backdrop;

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this._cancel();
    });

    this._keyHandler = (event) => {
      if (event.key === 'Escape') { this._cancel(); return; }
      if (event.key === 'Tab') this._trapFocus(event);
    };
    document.addEventListener('keydown', this._keyHandler, true);

    this.showModes();
  },

  _cancel() {
    this.close();
    this._handlers.onCancel?.();
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

  _body() { return this._root?.querySelector('#wl-modal-body'); },
  _footer() { return this._root?.querySelector('#wl-modal-footer'); },

  setStatus(text) {
    const status = this._root?.querySelector('#wl-modal-status');
    if (status) status.textContent = text;
  },

  // ── States ─────────────────────────────────────────────────────────────

  showModes() {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    this.setStatus('');
    body.textContent = '';
    footer.textContent = '';

    const wrap = document.createElement('div');
    wrap.className = 'wl-mode-choice';

    const ai = document.createElement('button');
    ai.className = 'wl-mode-btn';
    ai.type = 'button';
    ai.innerHTML = `Analyze &amp; sort<small>Groups videos by topic using Claude. Needs an API key. Takes a few seconds.</small>`;
    ai.addEventListener('click', () => this._handlers.onSort?.('ai'));

    const duration = document.createElement('button');
    duration.className = 'wl-mode-btn';
    duration.type = 'button';
    duration.innerHTML = `Sort by duration<small>Shortest first. Instant, no API key needed.</small>`;
    duration.addEventListener('click', () => this._handlers.onSort?.('duration'));

    wrap.append(ai, duration);
    body.appendChild(wrap);

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => this._cancel());
    footer.appendChild(cancel);

    ai.focus();
  },

  showBusy(text) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    body.textContent = '';
    footer.textContent = '';

    const label = document.createElement('p');
    label.textContent = text;

    const bar = document.createElement('div');
    bar.className = 'wl-progress-bar';
    bar.innerHTML = `<div class="wl-progress-fill"></div>`;

    body.append(label, bar);

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._cancel());
    footer.appendChild(cancel);
    cancel.focus();
  },

  showPreview(sortOrder) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    this.setStatus('');
    body.textContent = '';
    footer.textContent = '';

    for (const group of this.toGroups(sortOrder)) {
      if (group.name !== null) {
        const heading = document.createElement('h3');
        heading.className = group.name === this.IN_PROGRESS_LABEL
          ? 'wl-group-heading wl-in-progress'
          : 'wl-group-heading';
        heading.textContent = group.name;
        body.appendChild(heading);
      }
      for (const video of group.videos) body.appendChild(this._renderItem(video));
    }

    const apply = document.createElement('button');
    apply.className = 'wl-modal-btn wl-primary';
    apply.type = 'button';
    apply.textContent = 'Apply Sort';
    apply.addEventListener('click', () => this._handlers.onApply?.());

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._cancel());

    footer.append(apply, cancel);
    apply.focus();
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

  showError(message) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    body.textContent = '';
    footer.textContent = '';

    const error = document.createElement('p');
    error.className = 'wl-modal-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    body.appendChild(error);

    const back = document.createElement('button');
    back.className = 'wl-modal-btn';
    back.type = 'button';
    back.textContent = 'Try Again';
    back.addEventListener('click', () => this.showModes());

    const close = document.createElement('button');
    close.className = 'wl-modal-btn';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this._cancel());

    footer.append(back, close);
    back.focus();
  },

  close() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this._root?.remove();
    this._root = null;

    this._lastFocused?.focus?.();
    this._lastFocused = null;
  },
```

- [ ] **Step 3: Register the files**

In both `manifest.chrome.json` and `manifest.firefox.json`:

```json
      "js": ["content/selectors.js", "content/innertube.js", "content/playlist.js", "content/enrich.js", "content/storage.js", "content/modal.js", "content/panel.js"],
      "css": ["styles/content.css", "styles/panel.css", "styles/modal.css"]
```

In `build.sh`, add to the `SHARED` array after `content/enrich.js`:

```bash
  content/storage.js
  content/modal.js
```

and after `styles/panel.css`:

```bash
  styles/modal.css
```

- [ ] **Step 4: Verify tests and build**

Run: `npm test && ./build.sh`
Expected: `fail 0`, build exits 0

- [ ] **Step 5: Commit**

```bash
git add content/modal.js styles/modal.css manifest.chrome.json manifest.firefox.json build.sh
git commit -m "feat(modal): add floating trigger and accessible modal shell"
```

---

### Task 4: Rewire the controller to trigger and modal

Deletes the header-injected panel entirely.

**Files:**
- Modify: `content/panel.js`
- Modify: `styles/panel.css`
- Modify: `tests/panel.test.js`

**Interfaces:**
- Consumes: `WLModal.mountTrigger/open/showBusy/showPreview/showError/close`, `WLStorage.toggleOverride`, `WLPlaylist.read/applyOrder`, `WLEnrich.enrich`, background `ANALYZE`/`SORT_BY_DURATION`/`RESORT`
- Produces: a controller with no YouTube selectors

- [ ] **Step 1: Replace panel injection with trigger mounting**

In `content/panel.js`, delete `inject()`, `findAnchor()`, `$()`, `showState()`, `renderPreview()`, `formatDuration()`, `showIdleWithMessage()`, `scrollToPanel()`, and the whole `bindEvents()` method — the modal owns all of that now.

Replace the module-level `checkAndInject`, `injectWithRetry`, and `resetForNavigation` with:

```js
function onPlaylistPage() {
  return location.pathname.startsWith('/playlist') &&
         Boolean(new URL(location.href).searchParams.get('list'));
}

/**
 * The trigger is a fixed-position element we own, so there is no YouTube
 * selector to wait for and nothing to retry — mount it whenever we are on a
 * playlist page, remove it when we are not.
 */
function syncTrigger() {
  if (onPlaylistPage()) {
    WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
  } else {
    WLModal.removeTrigger();
    WLModal.close();
  }
}

function resetForNavigation() {
  WLPanel._runId++;
  WLPanel.currentSortOrder = [];
  WLModal.close();
  WLInnerTube.resetConfig();
}

let lastUrl = location.href;

const pageObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger();
});

pageObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger();
});

syncTrigger();
```

- [ ] **Step 2: Rewrite the controller methods**

Replace the `WLPanel` object's remaining methods with:

```js
const WLPanel = {
  _runId: 0,
  currentSortOrder: [],
  currentPlaylistId: null,

  openModal() {
    WLModal.open({
      onSort: (mode) => this.runSort(mode),
      onApply: () => this.applySort(),
      onCancel: () => { this._runId++; this.currentSortOrder = []; },
      onToggleUnwatched: (videoId) => this.toggleUnwatched(videoId),
    });
  },

  /**
   * @param {'ai'|'duration'} mode
   * 'duration' sorts locally and never calls Claude — no API key needed, and it
   * skips enrichment since nothing consumes the metadata.
   */
  async runSort(mode) {
    const runId = ++this._runId;

    try {
      const playlistId = new URL(location.href).searchParams.get('list');
      if (!playlistId) { WLModal.showError('No playlist found in the URL.'); return; }
      this.currentPlaylistId = playlistId;

      WLModal.showBusy('Reading playlist...');
      const videos = await WLPlaylist.read(playlistId);
      if (runId !== this._runId) return;

      if (!videos || videos.length === 0) {
        WLModal.showError('No videos found on this playlist.');
        return;
      }

      let result;
      if (mode === 'ai') {
        WLModal.showBusy('Fetching video details...');
        await WLEnrich.enrich(videos);
        if (runId !== this._runId) return;

        WLModal.showBusy('Categorizing with AI...');
        result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos, playlistId });
      } else {
        WLModal.showBusy('Sorting by duration...');
        result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos });
      }
      if (runId !== this._runId) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      WLModal.showPreview(result.sortOrder);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
    }
  },

  /** Recompute against cached clusters. Never re-calls Claude. */
  async toggleUnwatched(videoId) {
    WLModal.setStatus('Re-sorting...');

    const overrides = await WLStorage.toggleOverride(videoId);
    const result = await chrome.runtime.sendMessage({
      type: 'RESORT', overrides, playlistId: this.currentPlaylistId,
    });

    if (!result.success) { WLModal.showError(result.error); return; }

    this.currentSortOrder = result.sortOrder;
    WLModal.showPreview(result.sortOrder);
  },

  async applySort() {
    const playlistId = this.currentPlaylistId;
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    WLModal.showBusy(`Applying ${orderedSetVideoIds.length} moves...`);

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
    } catch (err) {
      WLModal.showError(err.message);
      return;
    }

    if (result.applied) {
      WLModal.showBusy(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened.
      setTimeout(() => location.reload(), 1200);
    } else {
      WLModal.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
    }
  },
};
```

- [ ] **Step 3: Empty the old panel stylesheet**

`styles/panel.css` styled the header-injected panel, which no longer exists. Replace its entire contents with:

```css
/* styles/panel.css — intentionally empty.
   The header-injected panel was replaced by the floating trigger and modal in
   styles/modal.css. Kept as a registered stylesheet to avoid a manifest churn. */
```

- [ ] **Step 4: Rewrite the panel tests**

`tests/panel.test.js` tests methods that no longer exist. Replace the whole file with tests for the new controller. Cover at minimum:

- `runSort('duration')` sends `SORT_BY_DURATION` and never calls `WLEnrich.enrich`
- `runSort('ai')` enriches and sends `ANALYZE` carrying a `playlistId`
- a superseded run does not call `WLModal.showPreview` — start run A, start run B, resolve A last, assert the preview shown is B's
- a superseded run does not call `WLModal.showError`
- `applySort` reloads when `applied: true`
- `applySort` does NOT reload when `applied: false`
- `applySort` does NOT reload when `applyOrder` throws
- `toggleUnwatched` sends `RESORT` with the current `playlistId` and never triggers a Claude call

Stub `WLModal`, `WLPlaylist`, `WLEnrich`, `WLStorage`, `chrome`, `location`, `document`, `MutationObserver`, and `window` through `loadGlobal`'s sandbox. Note the module now calls `syncTrigger()` at load, which touches `WLModal.mountTrigger` and `location` — stub both or loading throws.

- [ ] **Step 5: Run tests and build**

Run: `npm test && ./build.sh`
Expected: `fail 0`, build exits 0

- [ ] **Step 6: Commit**

```bash
git add content/panel.js styles/panel.css tests/panel.test.js
git commit -m "feat: replace header panel with floating trigger and modal"
```

---

### Task 5: Manual verification

Not automatable.

- [ ] **Step 1: Rebuild and reload the add-on**

```bash
./build.sh
```

Then reload at `about:debugging#/runtime/this-firefox`.

- [ ] **Step 2: Trigger reliability — the thing that kept breaking**

1. Open Watch Later. An **Organize** button appears bottom-right.
2. Open a regular playlist. Same button, same place. **This is the case that failed before.**
3. Navigate between several playlists — the button persists and never duplicates.
4. Navigate to a non-playlist page (a video, the home page) — the button disappears.

- [ ] **Step 3: Modal**

1. Click **Organize** → modal opens with two clearly-described modes.
2. **Sort by duration** → instant preview, flat list, no headings.
3. `Escape` closes. Clicking the dimmed backdrop closes. `Tab` cycles within the modal and never escapes to the page.
4. **Analyze & sort** on Watch Later → progress states, then a grouped preview with headings and all actions reachable without scrolling the page.
5. **Break the API key** and run Analyze & sort → an error naming the failure, with Try Again returning to the mode choice.

- [ ] **Step 4: Overrides**

1. On an in-progress video, click **Unwatched** → it moves into its topic group. Confirm in the Network tab that **no request to `api.anthropic.com`** fires.
2. Click it again → returns to In Progress.
3. Apply, let the page reload, re-open and re-analyze → the override persisted.

## Done when

- The Organize button appears on every playlist page without exception
- No extension UI depends on a YouTube selector
- The modal is keyboard-navigable and Escape-closable
- Overrides persist and never trigger a Claude call
