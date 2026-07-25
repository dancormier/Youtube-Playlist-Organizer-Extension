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
