# Trigger Mount Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out why the Organize trigger does not appear on page load in Firefox, and make it appear regardless while we learn why.

**Architecture:** Instrumentation plus a bounded backstop in `content/panel.js`. No behaviour changes beyond mounting more reliably.

**Tech Stack:** Vanilla JS, no bundler. Node's built-in `node:test`.

## Global Constraints

- **Firefox is the primary target.** This bug is observed in Firefox.
- **`content/` files are NOT ES modules.** One global each, load-ordered by the manifest. Never add `import`/`export`.
- **Test runner:** `node --test tests/*.test.js`. The glob is required.
- **Do NOT modify `tests/helpers/load-global.js`.**
- **Commits:** Conventional Commits. Never add AI attribution to any git artifact.
- 171 tests currently pass. All must keep passing.
- The run token, reload-only-on-`applied` gating, and global override semantics are settled — do not touch them.

## What we know

- A fresh tab, opened after the extension was loaded, navigated directly to a playlist URL: **the trigger does not appear.**
- Clicking the browser toolbar button makes it appear. `popup.js` is settings-only and never messages the page, so it cannot mount anything directly. What it does is shift focus, which makes YouTube re-render, which fires the `MutationObserver`, which calls `syncTrigger()`.
- Therefore the content script **is** injected and the observer **is** attached. The load-time `syncTrigger()` call is either not reached, or mounts something that is subsequently removed.
- All eight scripts and four stylesheets are correctly registered in both manifests and present in `dist/`.

## Candidate causes, and how the instrumentation separates them

| # | Hypothesis | Distinguishing signal |
|---|---|---|
| H1 | `document.body` is null when the script runs, so `pageObserver.observe(...)` throws and the `syncTrigger()` on the next line never executes | A logged throw at load, and no `source: 'load'` entry |
| H2 | The trigger mounts, then YouTube's hydration replaces body children and removes it | A `source: 'load'` mount followed by a later "trigger disappeared" log |
| H3 | `onPlaylistPage()` is false at load because the URL isn't yet what we expect | `source: 'load'` logs `onPlaylistPage: false` with the URL it saw |
| H4 | The observer fires but `syncTrigger` throws before mounting | A logged throw with `source: 'observer'` |
| H5 | The button mounts and stays, but is invisible because `styles/modal.css` did not apply | A `source: 'load'` mount, no disappearance, and a logged computed `position` that is not `fixed` |

---

### Task 1: Instrument the mount path and add a bounded backstop

**Files:**
- Modify: `content/panel.js`
- Modify: `content/modal.js`
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `WLModal.mountTrigger`
- Produces:
  - `syncTrigger(source)` — logs one structured line per call
  - `WLModal.mountTrigger({onOpen})` returns `boolean` — true when it created the element, false when one already existed
  - a bounded backstop interval that stops once mounted or after 20s

- [ ] **Step 1: Make `mountTrigger` report whether it created anything**

In `content/modal.js`, change `mountTrigger` to return a boolean. It currently returns early when `#wl-trigger` exists; make that `return false`, and `return true` after appending. Do not change any other behaviour — it must stay idempotent.

Also add a `verify()` helper to `WLModal` that reports the trigger's current state, for diagnosing H5:

```js
  /** Diagnostic: is the trigger present, and did our stylesheet actually apply? */
  verifyTrigger() {
    const el = document.querySelector('#wl-trigger');
    if (!el) return { present: false };

    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    return {
      present: true,
      connected: el.isConnected,
      position: style ? style.position : 'unknown',
      zIndex: style ? style.zIndex : 'unknown',
      visible: style ? style.display !== 'none' && style.visibility !== 'hidden' : 'unknown',
    };
  },
```

`position` reading `fixed` proves `styles/modal.css` applied; anything else points at H5.

- [ ] **Step 2: Write the failing test**

Append to `tests/panel.test.js`:

```js
describe('mountTrigger return value', () => {
  it('reports true when it creates the trigger and false when one exists', () => {
    const created = [];
    const doc = makePanelStub().document;
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document: doc,
      getComputedStyle: () => ({ position: 'fixed', zIndex: '1', display: 'block', visibility: 'visible' }),
    });

    assert.equal(modal.mountTrigger({ onOpen: () => created.push(1) }), true);
    assert.equal(modal.mountTrigger({ onOpen: () => created.push(1) }), false, 'second call must not create a duplicate');
  });
});
```

Adapt the stub construction to whatever helper `tests/panel.test.js` already provides — reuse it rather than writing a third harness. The assertion that matters is true-then-false.

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/panel.test.js`
Expected: FAIL — `mountTrigger` currently returns `undefined`

- [ ] **Step 4: Instrument `syncTrigger`**

In `content/panel.js`, replace `syncTrigger` with a version that takes a source label and logs one structured line per call:

```js
const WL_LOG = '[WL]';

function syncTrigger(source) {
  let onPage;
  try {
    onPage = onPlaylistPage();
  } catch (err) {
    console.warn(WL_LOG, 'onPlaylistPage threw', { source, href: location.href }, err);
    return;
  }

  if (!onPage) {
    console.info(WL_LOG, 'syncTrigger: not a playlist page', { source, href: location.href });
    WLModal.removeTrigger();
    WLModal.close();
    WLHeadings.stop();
    WLHeadings.clear();
    return;
  }

  try {
    const created = WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
    console.info(WL_LOG, 'syncTrigger: playlist page', {
      source,
      href: location.href,
      created,
      state: WLModal.verifyTrigger(),
    });
  } catch (err) {
    console.warn(WL_LOG, 'mountTrigger threw', { source }, err);
    return;
  }

  WLPanel.restoreHeadings();
}
```

- [ ] **Step 5: Log at load, guard the observer, and add the backstop**

Replace the module-level block at the bottom of `content/panel.js` (from `let lastUrl` to the final `syncTrigger();`) with:

```js
let lastUrl = location.href;

console.info(WL_LOG, 'content script loaded', {
  href: location.href,
  readyState: document.readyState,
  hasBody: Boolean(document.body),
});

function onPageChange(source) {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger(source);
}

const pageObserver = new MutationObserver(() => onPageChange('observer'));

try {
  pageObserver.observe(document.body, { childList: true, subtree: true });
} catch (err) {
  // H1: no body yet. Retry once the document is ready rather than dying here.
  console.warn(WL_LOG, 'observer attach failed; will retry on DOMContentLoaded', err);
  document.addEventListener('DOMContentLoaded', () => {
    try {
      pageObserver.observe(document.body, { childList: true, subtree: true });
      console.info(WL_LOG, 'observer attached on DOMContentLoaded');
    } catch (retryErr) {
      console.warn(WL_LOG, 'observer attach failed again', retryErr);
    }
  });
}

window.addEventListener('yt-navigate-finish', () => onPageChange('yt-navigate-finish'));
document.addEventListener('DOMContentLoaded', () => onPageChange('DOMContentLoaded'));
window.addEventListener('load', () => onPageChange('load'));

onPageChange('load-time');

/**
 * Backstop: poll briefly in case none of the event paths fire, or something
 * removes the trigger just after we mount it. mountTrigger is idempotent, so a
 * redundant pass costs a querySelector. Logs loudly if this is what saved us —
 * that would mean an event path is not working and is worth knowing about.
 */
let backstopTicks = 0;
const backstopTimer = setInterval(() => {
  backstopTicks++;

  if (!onPlaylistPage()) {
    if (backstopTicks > 40) clearInterval(backstopTimer);
    return;
  }

  if (!document.querySelector('#wl-trigger')) {
    console.warn(WL_LOG, 'backstop mounting trigger — an event path did not fire', {
      tick: backstopTicks,
      href: location.href,
    });
    syncTrigger('backstop');
  }

  if (backstopTicks > 40) clearInterval(backstopTimer);
}, 500);
```

The backstop runs every 500ms for 20 seconds. It only acts when the trigger is genuinely absent, and it warns when it acts — so a clean console means the normal paths worked and a warning tells us which case we are in.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, `fail 0`

- [ ] **Step 7: Verify the build**

Run: `./build.sh && node --check dist/firefox/content/panel.js`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add content/panel.js content/modal.js tests/panel.test.js
git commit -m "fix(panel): instrument trigger mounting and add a bounded backstop"
```

## Done when

- The console shows one `[WL]` line per `syncTrigger` call, tagged with its source
- The trigger appears on load without any toolbar interaction
- If the backstop is what mounted it, the console says so explicitly
