// tests/panel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

// content/panel.js runs side-effecting code at load time (sets up a MutationObserver,
// reads location.href, calls checkAndInject once). We give it a pathname that doesn't
// start with '/playlist' so checkAndInject's early return keeps that top-level code
// from touching `document` at all — the tests below drive WLPanel's methods directly
// instead of going through inject()/DOM discovery.

function createStubElement() {
  return {
    children: [],
    listeners: {},
    style: {},
    _text: '',
    _html: '',
    _className: '',
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
      toggle() {},
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = []; },
    get className() { return this._className; },
    set className(v) { this._className = v; },
  };
}

/** A fake `panel` element whose querySelector(sel) hands out one stub element per selector. */
function makePanelStub() {
  const registry = new Map();
  const panel = {
    querySelector(sel) {
      if (!registry.has(sel)) registry.set(sel, createStubElement());
      return registry.get(sel);
    },
  };
  return panel;
}

const documentStub = {
  body: {},
  querySelector: () => null,
  createElement: () => createStubElement(),
};

const locationStub = {
  href: 'https://www.youtube.com/playlist?list=WL',
  pathname: '/not-playlist', // keeps load-time checkAndInject() from touching `document`
  search: '?list=WL',
};

class MutationObserverStub {
  observe() {}
  disconnect() {}
}

function loadPanel(sandbox = {}) {
  return loadGlobal('content/panel.js', 'WLPanel', {
    document: documentStub,
    location: locationStub,
    MutationObserver: MutationObserverStub,
    WLInnerTube: { resetConfig() {} },
    WLPlaylist: {},
    WLEnrich: {},
    chrome: { runtime: { sendMessage: async () => ({ success: true, sortOrder: [] }) } },
    // injectWithRetry() runs at load time and reaches for these even when
    // checkAndInject() bails out early (non-/playlist pathname) — it still
    // schedules the retry interval. Stub them so load-time execution doesn't
    // throw or start a real timer.
    setInterval: () => 0,
    clearInterval: () => {},
    window: { addEventListener: () => {} },
    ...sandbox,
  });
}

describe('WLPanel.renderPreview — in-progress remaining time (CRITICAL 1 regression)', () => {
  it('renders a sane remaining-time string from percentWatched, not NaN:NaN', () => {
    const WLPanel = loadPanel();
    const panel = makePanelStub();
    WLPanel.panel = panel;

    // 600s video, 25% watched -> 450s (7:30) remaining. The old code read the
    // never-set `video.progress` field and produced NaN:NaN here.
    const sortOrder = [
      { id: 'v1', setVideoId: 'S1', title: 'Some Video', cluster: null, duration: 600, percentWatched: 25 },
    ];
    WLPanel.renderPreview(sortOrder);

    const list = panel.querySelector('#wl-preview-list');
    // children[0] is the "In Progress" cluster label, children[1] is the video row.
    const item = list.children[1];
    const meta = item.children[1];

    assert.equal(meta.textContent, '7:30 left');
    assert.doesNotMatch(meta.textContent, /NaN/);
  });

  it('never produces a negative remaining time at the top of the percentage range', () => {
    const WLPanel = loadPanel();
    const panel = makePanelStub();
    WLPanel.panel = panel;

    const sortOrder = [
      { id: 'v1', setVideoId: 'S1', title: 'Almost Done', cluster: null, duration: 600, percentWatched: 95 },
    ];
    WLPanel.renderPreview(sortOrder);

    const item = panel.querySelector('#wl-preview-list').children[1];
    const meta = item.children[1];

    // 600 * (1 - 95/100) = 30s remaining, not a huge negative number (which is what
    // `1 - percentWatched` without the /100 division would have produced).
    assert.equal(meta.textContent, '0:30 left');
  });
});

describe('WLPanel analyze — cancellation during enrichment (CRITICAL 2 regression)', () => {
  it('does not call chrome.runtime.sendMessage once cancelled mid-enrichment', async () => {
    const sendMessageCalls = [];
    const videos = [{ id: 'v1', setVideoId: 'S1', title: 'T', duration: 100, percentWatched: 0 }];

    const WLPanel = loadPanel({
      chrome: { runtime: { sendMessage: async (msg) => { sendMessageCalls.push(msg); return { success: true, sortOrder: [] }; } } },
      WLPlaylist: { read: async () => videos },
      WLEnrich: {
        // Enrichment is the longest phase (one `player` call per video), so it's the
        // realistic window for a user's Cancel click to land. Simulate that here.
        enrich: async () => { WLPanel._analyseCancelled = true; },
      },
    });

    const panel = makePanelStub();
    WLPanel.panel = panel;
    WLPanel.bindEvents();

    await panel.querySelector('#wl-analyze-btn').listeners['click']();

    assert.equal(sendMessageCalls.length, 0, 'a cancelled analyze must not fire the paid ANALYZE call');
  });

  it('still calls chrome.runtime.sendMessage when analysis is not cancelled', async () => {
    const sendMessageCalls = [];
    const videos = [{ id: 'v1', setVideoId: 'S1', title: 'T', duration: 100, percentWatched: 0 }];

    const WLPanel = loadPanel({
      chrome: { runtime: { sendMessage: async (msg) => { sendMessageCalls.push(msg); return { success: true, sortOrder: [] }; } } },
      WLPlaylist: { read: async () => videos },
      WLEnrich: { enrich: async () => {} },
    });

    const panel = makePanelStub();
    WLPanel.panel = panel;
    WLPanel.bindEvents();

    await panel.querySelector('#wl-analyze-btn').listeners['click']();

    assert.equal(sendMessageCalls.length, 1, 'a normal (non-cancelled) analyze should still reach ANALYZE');
  });
});

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

describe('checkAndInject — stale panel self-heal (navigation event-ordering)', () => {
  // yt-navigate-finish can fire before location.href actually updates. When that
  // happens, both the MutationObserver branch and the yt-navigate-finish handler skip
  // resetForNavigation() because `location.href !== lastUrl` is still false at the
  // moment they run. Without a second line of defense, checkAndInject() would then see
  // the old #wl-organizer-panel, short-circuit, and leave the panel bound to the
  // previous playlist — with WLInnerTube.resetConfig() never called, so a stale
  // DELEGATED_SESSION_ID could survive an account switch. This test drives the real
  // entry point (checkAndInject) rather than lastUrl bookkeeping, to prove the healing
  // is self-contained and doesn't depend on event ordering.
  it('removes a panel tagged for a different playlist and resets InnerTube config', () => {
    let panelEl = null;
    const removeCalls = [];
    const resetConfigCalls = [];

    const anchorEl = {
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      parentNode: { insertBefore: () => {} },
    };

    // A mutable location stub: real navigation mutates `location.href` in place,
    // which is exactly the case that skips lastUrl-based resets when event ordering
    // is unlucky.
    const loc = {
      href: 'https://www.youtube.com/playlist?list=A',
      pathname: '/playlist',
      search: '?list=A',
    };

    const doc = {
      querySelector: (sel) => {
        if (sel === '#wl-organizer-panel') return panelEl;
        if (sel === '.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer') return anchorEl;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { appendChild: () => {} },
      documentElement: { innerHTML: '' },
      createElement: () => {
        const registry = new Map();
        const el = {
          id: '',
          innerHTML: '',
          dataset: {},
          remove: () => { removeCalls.push(el.dataset.wlPlaylist); panelEl = null; },
          querySelector(sel) {
            if (!registry.has(sel)) registry.set(sel, { addEventListener: () => {} });
            return registry.get(sel);
          },
        };
        panelEl = el;
        return el;
      },
    };

    // Loading with pathname '/playlist' means injectWithRetry() actually injects at
    // load time (through the real inject() path), tagging the panel for playlist A —
    // this exercises the tagging added to inject(), not just a hand-built fixture.
    const checkAndInject = loadGlobal('content/panel.js', 'checkAndInject', {
      document: doc,
      location: loc,
      MutationObserver: MutationObserverStub,
      WLInnerTube: { resetConfig: () => resetConfigCalls.push(true) },
      WLPlaylist: {},
      WLEnrich: {},
      chrome: { runtime: { sendMessage: async () => ({ success: true, sortOrder: [] }) } },
      setInterval: () => 0,
      clearInterval: () => {},
      window: { addEventListener: () => {} },
    });

    assert.ok(panelEl, 'panel should have been injected for playlist A at load time');
    assert.equal(panelEl.dataset.wlPlaylist, 'A');
    assert.equal(resetConfigCalls.length, 0, 'a fresh injection is not a navigation reset');

    // Simulate the URL moving to playlist B without any reset having run yet.
    loc.href = 'https://www.youtube.com/playlist?list=B';
    loc.search = '?list=B';

    const result = checkAndInject();

    assert.equal(result, true);
    assert.deepEqual(removeCalls, ['A'], 'the panel tagged for playlist A should be removed exactly once');
    assert.equal(resetConfigCalls.length, 1, 'WLInnerTube.resetConfig() must run so a stale session id cannot survive the navigation');
    assert.equal(panelEl.dataset.wlPlaylist, 'B', 're-injection should tag the new panel for the current playlist');
  });
});
