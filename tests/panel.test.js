// tests/panel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

// content/panel.js runs side-effecting code at load time: it sets up a
// MutationObserver, a yt-navigate-finish listener, and calls syncTrigger() once.
// syncTrigger() reads location.pathname/href and, on a playlist page, calls
// WLModal.mountTrigger — so the sandbox must stub `document`, `location`,
// `MutationObserver`, `window`, and `WLModal` even for tests that only want to
// drive WLPanel's methods directly.

const locationStub = {
  href: 'https://www.youtube.com/playlist?list=WL',
  pathname: '/not-playlist', // keeps load-time syncTrigger() from mounting the trigger
  search: '?list=WL',
};

const documentStub = {
  body: {},
  querySelector: () => null,
  createElement: () => ({}),
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
    window: { addEventListener: () => {} },
    WLModal: {
      mountTrigger() {},
      removeTrigger() {},
      close() {},
      open() {},
      showBusy() {},
      showPreview() {},
      showError() {},
      setStatus() {},
    },
    WLInnerTube: { resetConfig() {} },
    WLPlaylist: {},
    WLEnrich: {},
    WLStorage: {},
    chrome: { runtime: { sendMessage: async () => ({ success: true, sortOrder: [] }) } },
    ...sandbox,
  });
}

/**
 * Loads WLPanel wired with stubs for chrome.runtime.sendMessage,
 * WLPlaylist.read/applyOrder, WLEnrich.enrich, WLStorage.toggleOverride, and a
 * spyable WLModal — everything runSort()/applySort()/toggleUnwatched() touch.
 *
 * `reload` stubs `location.reload` (needed by applySort's post-sort reload).
 * `runTimers`, when set, makes the sandboxed `setTimeout` invoke its callback
 * synchronously instead of scheduling a real 1.2s wait.
 * `sortOrder`/`playlistId`, when set, seed WLPanel state so applySort()/
 * toggleUnwatched() can be called directly without going through runSort() first.
 */
function loadPanelWithStubs({ sendMessage, enrich, videos, applyOrder, toggleOverride, reload, runTimers, sortOrder, playlistId }) {
  const modalCalls = { showBusy: [], showPreview: [], showError: [], setStatus: [] };
  const sandbox = {
    chrome: { runtime: { sendMessage } },
    WLPlaylist: { read: async () => videos, applyOrder },
    WLEnrich: { enrich },
    WLStorage: { toggleOverride },
    WLModal: {
      mountTrigger() {},
      removeTrigger() {},
      close() {},
      open() {},
      showBusy(text) { modalCalls.showBusy.push(text); },
      showPreview(order) { modalCalls.showPreview.push(order); },
      showError(msg) { modalCalls.showError.push(msg); },
      setStatus(text) { modalCalls.setStatus.push(text); },
    },
  };
  if (reload) {
    sandbox.location = { ...locationStub, reload };
  }
  if (runTimers) {
    sandbox.setTimeout = (fn) => { fn(); return 0; };
  }
  const WLPanel = loadPanel(sandbox);
  if (sortOrder) WLPanel.currentSortOrder = sortOrder;
  if (playlistId) WLPanel.currentPlaylistId = playlistId;
  return { WLPanel, modalCalls, WLModal: sandbox.WLModal };
}

describe('runSort mode selection', () => {
  it('sends SORT_BY_DURATION and never enriches in duration mode', async () => {
    const sent = [];
    let enriched = false;
    const { WLPanel } = loadPanelWithStubs({
      sendMessage: async (msg) => { sent.push(msg); return { success: true, sortOrder: [] }; },
      enrich: async () => { enriched = true; },
      videos: [{ id: 'a', setVideoId: 'A', duration: 60, percentWatched: 0 }],
    });

    await WLPanel.runSort('duration');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'SORT_BY_DURATION');
    assert.equal(enriched, false, 'duration mode must not pay for enrichment');
  });

  it('enriches and sends ANALYZE with a playlistId in ai mode', async () => {
    const sent = [];
    let enriched = false;
    const { WLPanel } = loadPanelWithStubs({
      sendMessage: async (msg) => { sent.push(msg); return { success: true, sortOrder: [] }; },
      enrich: async () => { enriched = true; },
      videos: [{ id: 'a', setVideoId: 'A', duration: 60, percentWatched: 0 }],
    });

    await WLPanel.runSort('ai');

    assert.equal(enriched, true);
    assert.equal(sent[0].type, 'ANALYZE');
    assert.ok(sent[0].playlistId, 'ANALYZE must carry the playlistId');
  });
});

describe('runSort — stale run supersession (run token)', () => {
  // Both scenarios below drive the SAME WLPanel instance through two overlapping
  // runSort() calls, the way a real Cancel-then-switch-modes or navigate-mid-sort
  // sequence would. Run A is parked on a controllable deferred promise so run B can
  // start, finish, and render before A is allowed to resume — proving A's late
  // arrival is a no-op rather than a race that sometimes passes.

  it('a superseded run does not call WLModal.showPreview — the newer run\'s order wins', async () => {
    let resolveA;
    let signalReachedA;
    const deferredA = new Promise((resolve) => { resolveA = resolve; });
    const reachedA = new Promise((resolve) => { signalReachedA = resolve; });

    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async (msg) => {
        if (msg.type === 'ANALYZE') {
          // Run A (ai mode) blocks here until the test lets it through.
          signalReachedA();
          await deferredA;
          return { success: true, sortOrder: [{ id: 'a', setVideoId: 'A', cluster: 'Topic', duration: 60 }] };
        }
        // Run B (duration mode) resolves immediately.
        return { success: true, sortOrder: [{ id: 'b', setVideoId: 'B', cluster: null, duration: 30, percentWatched: 0 }] };
      },
      enrich: async () => {},
      videos: [{ id: 'x', setVideoId: 'X', duration: 60, percentWatched: 0 }],
    });

    const runA = WLPanel.runSort('ai'); // starts; will park inside the ANALYZE sendMessage call
    await reachedA; // wait until A is actually parked, not just "started"
    await WLPanel.runSort('duration'); // supersedes A (bumps _runId) and completes fully

    assert.deepEqual(
      modalCalls.showPreview.map(order => order.map(v => v.setVideoId)),
      [['B']],
      'only run B\'s order should have been shown'
    );

    resolveA(); // let A resume — its runId no longer matches WLPanel._runId
    await runA;

    assert.deepEqual(
      modalCalls.showPreview.map(order => order.map(v => v.setVideoId)),
      [['B']],
      'a superseded run must not call showPreview once it resolves'
    );
  });

  it('a superseded run does not call WLModal.showError when it fails after being superseded', async () => {
    let rejectA;
    let signalReachedA;
    const deferredA = new Promise((_resolve, reject) => { rejectA = reject; });
    const reachedA = new Promise((resolve) => { signalReachedA = resolve; });

    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async (msg) => {
        if (msg.type === 'ANALYZE') {
          signalReachedA();
          await deferredA; // will reject once the test triggers it
        }
        return { success: true, sortOrder: [{ id: 'b', setVideoId: 'B', cluster: null, duration: 30, percentWatched: 0 }] };
      },
      enrich: async () => {},
      videos: [{ id: 'x', setVideoId: 'X', duration: 60, percentWatched: 0 }],
    });

    const runA = WLPanel.runSort('ai'); // starts; will park inside the ANALYZE sendMessage call
    await reachedA; // wait until A is actually parked, not just "started"
    await WLPanel.runSort('duration'); // supersedes A (bumps _runId) and completes fully

    rejectA(new Error('boom')); // A's sendMessage now throws, caught by runSort's catch block
    await runA;

    assert.equal(
      modalCalls.showError.length,
      0,
      'a superseded run must not paint an error over a newer run\'s preview'
    );
  });
});

describe('applySort — post-sort reload', () => {
  it('reloads after a confirmed sort', async () => {
    let reloaded = false;
    const { WLPanel } = loadPanelWithStubs({
      applyOrder: async () => ({ applied: true, waitedMs: 1200 }),
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
      playlistId: 'WL',
    });

    await WLPanel.applySort();
    assert.equal(reloaded, true);
  });

  it('does NOT reload when the order never converged', async () => {
    let reloaded = false;
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      applyOrder: async () => ({ applied: false, waitedMs: 10000 }),
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
      playlistId: 'WL',
    });

    await WLPanel.applySort();
    assert.equal(reloaded, false, 'a failed sort must leave the error on screen');
    assert.equal(modalCalls.showError.length, 1);
  });

  it('does NOT reload when applyOrder throws', async () => {
    let reloaded = false;
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      applyOrder: async () => { throw new Error('network blew up'); },
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
      playlistId: 'WL',
    });

    await WLPanel.applySort();
    assert.equal(reloaded, false, 'a thrown apply error must leave the error on screen');
    assert.deepEqual(modalCalls.showError, ['network blew up']);
  });
});

describe('toggleUnwatched', () => {
  it('sends RESORT with the current playlistId and never triggers a Claude call', async () => {
    const sent = [];
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async (msg) => { sent.push(msg); return { success: true, sortOrder: [{ id: 'b', setVideoId: 'B', cluster: null, duration: 10, percentWatched: 0 }] }; },
      toggleOverride: async () => ['v1'],
      playlistId: 'PL123',
    });

    await WLPanel.toggleUnwatched('v1');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'RESORT');
    assert.equal(sent[0].playlistId, 'PL123');
    assert.deepEqual(sent[0].overrides, ['v1']);
    assert.deepEqual(
      modalCalls.showPreview[0].map(v => v.setVideoId),
      ['B']
    );
  });

  it('surfaces an error via WLModal.showError when RESORT fails', async () => {
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async () => ({ success: false, error: 'stale clusters' }),
      toggleOverride: async () => ['v1'],
      playlistId: 'PL123',
    });

    await WLPanel.toggleUnwatched('v1');

    assert.deepEqual(modalCalls.showError, ['stale clusters']);
  });
});
