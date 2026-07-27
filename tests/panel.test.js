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
  readyState: 'loading',
  querySelector: () => null,
  createElement: () => ({}),
  addEventListener: () => {},
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
    setInterval: () => 0,
    clearInterval: () => {},
    WLModal: {
      mountTrigger() {},
      removeTrigger() {},
      verifyTrigger() { return { present: false }; },
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
    WLStorage: {
      getGroupMap: async () => ({}),
      setGroupMap: async () => {},
    },
    WLHeadings: {
      boundariesFrom: () => [],
      hashIds: () => '',
      watch() {},
      stop() {},
      clear() {},
    },
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
 * `setGroupMap`, when set, replaces the default no-op WLStorage.setGroupMap —
 * used by the post-sort persistence tests to observe ordering/timing.
 */
function loadPanelWithStubs({ sendMessage, enrich, videos, applyOrder, toggleOverride, reload, runTimers, sortOrder, playlistId, setGroupMap }) {
  const modalCalls = { showBusy: [], showPreview: [], showError: [], setStatus: [] };
  const sandbox = {
    chrome: { runtime: { sendMessage } },
    WLPlaylist: { read: async () => videos, applyOrder },
    WLEnrich: { enrich },
    WLStorage: {
      toggleOverride,
      setGroupMap: setGroupMap || (async () => {}),
      getGroupMap: async () => ({}),
    },
    WLHeadings: {
      boundariesFrom: (order) => order,
      hashIds: () => 'hash',
      watch() {},
      stop() {},
      clear() {},
    },
    WLModal: {
      mountTrigger() {},
      removeTrigger() {},
      verifyTrigger() { return { present: false }; },
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

  it('a superseded apply does not reload and does not announce success', async () => {
    let resolveApply;
    let signalReachedApply;
    const deferredApply = new Promise((resolve) => { resolveApply = resolve; });
    const reachedApply = new Promise((resolve) => { signalReachedApply = resolve; });

    let reloaded = false;
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      applyOrder: async () => {
        signalReachedApply();
        await deferredApply;
        return { applied: true, waitedMs: 1200 };
      },
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A' }],
      playlistId: 'WL',
    });

    const apply = WLPanel.applySort(); // parks inside applyOrder
    await reachedApply;

    // Simulate navigating away mid-apply, exactly what resetForNavigation() does
    // to the run token.
    WLPanel._runId++;

    resolveApply(); // let the stale apply resolve now that a newer session owns the token
    await apply;

    assert.equal(reloaded, false, 'a superseded apply must not reload the page out from under a newer session');
    assert.ok(
      !modalCalls.showBusy.some(text => text.startsWith('Sort complete')),
      'a superseded apply must not announce success into a newer session'
    );
  });

  it('does not reload when the run token changes before the reload timer fires', async () => {
    // The ownership check that gates scheduling the timer is not enough: if
    // the user clicks into a video within the 1.2s window (bumping _runId the
    // same way resetForNavigation() does), the timer must not fire a reload
    // for the page the user already left.
    let reloaded = false;
    let scheduledFn;

    const WLPanel = loadPanel({
      WLPlaylist: { applyOrder: async () => ({ applied: true, waitedMs: 1200 }) },
      WLHeadings: {
        boundariesFrom: () => [],
        hashIds: () => 'hash',
        watch() {}, stop() {}, clear() {},
      },
      WLStorage: { setGroupMap: async () => {}, getGroupMap: async () => ({}) },
      location: { ...locationStub, reload: () => { reloaded = true; } },
      setTimeout: (fn) => { scheduledFn = fn; return 1; },
    });
    WLPanel.currentSortOrder = [{ id: 'a', setVideoId: 'A' }];
    WLPanel.currentPlaylistId = 'WL';

    await WLPanel.applySort();
    assert.ok(scheduledFn, 'setup: applySort must schedule a reload timer');

    WLPanel._runId++; // simulate navigating within the 1.2s window
    scheduledFn(); // the timer fires now that a newer session owns the token

    assert.equal(reloaded, false, 'the reload callback must re-check ownership when it fires, not just when scheduled');
  });
});

describe('applySort — group map persistence', () => {
  it('persists the group map before scheduling the reload, and awaits the write', async () => {
    const events = [];
    let persistedMap;

    const { WLPanel } = loadPanelWithStubs({
      applyOrder: async () => ({ applied: true, waitedMs: 1200 }),
      reload: () => { events.push('reload'); },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A', cluster: 'Music' }],
      playlistId: 'WL',
      setGroupMap: async (map) => {
        persistedMap = map;
        events.push('setGroupMap-called');
        // A real (unstubbed) delay: setTimeout here is the test file's own
        // Node global, not the sandbox's overridden one, so this genuinely
        // yields. If applySort scheduled the reload without awaiting this
        // promise, 'reload' would land before 'setGroupMap-resolved'.
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push('setGroupMap-resolved');
      },
    });

    await WLPanel.applySort();

    assert.deepEqual(events, ['setGroupMap-called', 'setGroupMap-resolved', 'reload']);
    assert.equal(persistedMap.playlistId, 'WL');
  });

  it('clears the stored group map in duration mode, where boundariesFrom returns an empty array', async () => {
    // Regression: this used to SKIP the write when boundaries were empty, which
    // is not neutral — a previous AI sort's grouping survived it, and
    // restoreHeadings() re-injected those headings after the reload, scattered
    // through the new duration order. Its staleness check does not catch that,
    // because hashIds is order-independent: re-sorting the same set of videos
    // leaves the hash identical. The write must therefore clear the map.
    //
    // buildDurationSortOrder videos carry no `cluster` key at all, so the real
    // WLHeadings.boundariesFrom(...) returns []. Uses loadPanel() directly (not
    // loadPanelWithStubs, whose default WLHeadings.boundariesFrom stub just
    // echoes the order back) so the empty-boundaries case is actually exercised.
    const stored = [];
    const headingCalls = [];

    const WLPanel = loadPanel({
      WLPlaylist: { applyOrder: async () => ({ applied: true, waitedMs: 1200 }) },
      WLHeadings: {
        boundariesFrom: () => [],
        hashIds: () => 'hash',
        watch() {},
        stop() { headingCalls.push('stop'); },
        clear() { headingCalls.push('clear'); },
      },
      WLStorage: {
        setGroupMap: async (map) => { stored.push(map); },
        getGroupMap: async () => ({}),
      },
      location: { ...locationStub, reload: () => {} },
      setTimeout: (fn) => { fn(); return 0; },
    });
    WLPanel.currentSortOrder = [{ id: 'a', setVideoId: 'A', duration: 60 }];
    WLPanel.currentPlaylistId = 'WL';

    // Loading the module runs onPageChange('load-time'), and locationStub is
    // not a playlist URL, so syncTrigger's not-a-playlist-page branch already
    // called stop()/clear() once. Drop those so the assertion below is about
    // applySort and nothing else.
    headingCalls.length = 0;

    await WLPanel.applySort();

    assert.equal(stored.length, 1, 'a duration-mode apply must write, not skip');
    assert.deepEqual({ ...stored[0] }, {}, 'the write must clear the stored grouping');
    // The reload normally destroys these anyway; they matter when it is
    // cancelled or fails, which would otherwise leave stale headings on screen.
    assert.deepEqual([...headingCalls], ['stop', 'clear'], 'live headings must be torn down too');
  });

  it('persists nothing when the apply did not converge', async () => {
    let setGroupMapCalled = false;

    const { WLPanel } = loadPanelWithStubs({
      applyOrder: async () => ({ applied: false, waitedMs: 10000 }),
      reload: () => {},
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A', cluster: 'Music' }],
      playlistId: 'WL',
      setGroupMap: async () => { setGroupMapCalled = true; },
    });

    await WLPanel.applySort();

    assert.equal(setGroupMapCalled, false, 'a failed apply must not persist a group map');
  });

  it('a superseded apply does not announce success or reload when navigation happens during the persistence write', async () => {
    // Regression test: the ownership check right after applyOrder() resolves
    // does NOT cover the later `await WLStorage.setGroupMap(...)` — that is a
    // second await, and resetForNavigation()'s synchronous _runId bump can land
    // inside it just as easily as inside applyOrder(). Without a re-check after
    // the persistence await, a navigate-away here would still announce "Sort
    // complete" and reload the page out from under the session the user left.
    let resolveSetGroupMap;
    let signalReachedSetGroupMap;
    const deferred = new Promise((resolve) => { resolveSetGroupMap = resolve; });
    const reached = new Promise((resolve) => { signalReachedSetGroupMap = resolve; });

    let reloaded = false;
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      applyOrder: async () => ({ applied: true, waitedMs: 1200 }),
      reload: () => { reloaded = true; },
      runTimers: true,
      sortOrder: [{ id: 'a', setVideoId: 'A', cluster: 'Music' }],
      playlistId: 'WL',
      setGroupMap: async () => {
        signalReachedSetGroupMap();
        await deferred;
      },
    });

    const apply = WLPanel.applySort(); // parks inside setGroupMap
    await reached;

    // Simulate navigating away mid-persist, exactly what resetForNavigation()
    // does to the run token.
    WLPanel._runId++;

    resolveSetGroupMap(); // let the stale apply's persistence write resolve
    await apply;

    assert.equal(reloaded, false, 'a superseded apply must not reload after navigating away mid-persist');
    assert.ok(
      !modalCalls.showBusy.some(text => text.startsWith('Sort complete')),
      'a superseded apply must not announce success after navigating away mid-persist'
    );
  });

  it('still reloads when persisting the group map fails', async () => {
    // A storage failure must not turn into a stuck modal: applySort() is
    // invoked fire-and-forget from the modal's onApply, so an uncaught
    // rejection here would be an unhandled rejection with no visible error and
    // no reload. The sort itself already succeeded — headings are a
    // convenience on top of it.
    const originalWarn = console.warn;
    console.warn = () => {}; // expected warning; silence it for this assertion
    let reloaded = false;
    try {
      const { WLPanel, modalCalls } = loadPanelWithStubs({
        applyOrder: async () => ({ applied: true, waitedMs: 1200 }),
        reload: () => { reloaded = true; },
        runTimers: true,
        sortOrder: [{ id: 'a', setVideoId: 'A', cluster: 'Music' }],
        playlistId: 'WL',
        setGroupMap: async () => { throw new Error('storage quota exceeded'); },
      });

      await assert.doesNotReject(() => WLPanel.applySort());

      assert.equal(reloaded, true, 'a persistence failure must not block the reload');
      assert.ok(
        modalCalls.showBusy.some(text => text.startsWith('Sort complete')),
        'success should still be announced even when headings fail to persist'
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('restoreHeadings', () => {
  it('performs at most one playlist read even when called repeatedly', async () => {
    let readCalls = 0;
    let watchCalls = 0;

    const WLPanel = loadPanel({
      WLStorage: {
        getGroupMap: async () => ({
          playlistId: 'WL',
          boundaries: [{ videoId: 'a', name: 'Music', count: 1 }],
          videoIdsHash: 'match',
        }),
        setGroupMap: async () => {},
      },
      WLPlaylist: { read: async () => { readCalls++; return [{ id: 'a' }]; } },
      WLHeadings: {
        boundariesFrom: () => [],
        hashIds: () => 'match',
        watch: () => { watchCalls++; },
        stop() {},
        clear() {},
      },
    });

    await WLPanel.restoreHeadings();
    await WLPanel.restoreHeadings();
    await WLPanel.restoreHeadings();

    assert.equal(readCalls, 1, 'restoreHeadings must guard against repeated calls for the same playlist');
    assert.equal(watchCalls, 1, 'headings should only be (re)watched once per playlist');
  });

  it('clears the stored map and injects nothing when the video-set hash differs', async () => {
    let persistedMap;
    let watchCalled = false;

    const WLPanel = loadPanel({
      WLStorage: {
        getGroupMap: async () => ({
          playlistId: 'WL',
          boundaries: [{ videoId: 'a', name: 'Music', count: 1 }],
          videoIdsHash: 'stale-hash',
        }),
        setGroupMap: async (map) => { persistedMap = map; },
      },
      WLPlaylist: { read: async () => [{ id: 'b' }] },
      WLHeadings: {
        boundariesFrom: () => [],
        hashIds: () => 'fresh-hash',
        watch: () => { watchCalled = true; },
        stop() {},
        clear() {},
      },
    });

    await WLPanel.restoreHeadings();

    // persistedMap is a vm-sandbox-realm object; spread into a main-realm
    // plain object before deepEqual, or the comparison fails on prototype
    // identity even when every field matches (see tests/headings.test.js).
    assert.deepEqual({ ...persistedMap }, {}, 'a hash mismatch must clear the stored group map');
    assert.equal(watchCalled, false, 'stale groupings must not be injected');
  });

  it('does not throw when the stored group map cannot be read', async () => {
    // restoreHeadings() is called unawaited from syncTrigger(), so a rejected
    // await here would be an unhandled rejection rather than a visible error.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const WLPanel = loadPanel({
        WLStorage: {
          getGroupMap: async () => { throw new Error('storage broken'); },
          setGroupMap: async () => {},
        },
        WLPlaylist: { read: async () => { throw new Error('must not be called'); } },
        WLHeadings: {
          boundariesFrom: () => [],
          hashIds: () => 'x',
          watch: () => { throw new Error('must not be called'); },
          stop() {},
          clear() {},
        },
      });

      await assert.doesNotReject(() => WLPanel.restoreHeadings());
    } finally {
      console.warn = originalWarn;
    }
  });

  it('does not throw when clearing a stale group map fails', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const WLPanel = loadPanel({
        WLStorage: {
          getGroupMap: async () => ({
            playlistId: 'WL',
            boundaries: [{ videoId: 'a', name: 'Music', count: 1 }],
            videoIdsHash: 'stale-hash',
          }),
          setGroupMap: async () => { throw new Error('storage broken'); },
        },
        WLPlaylist: { read: async () => [{ id: 'b' }] },
        WLHeadings: {
          boundariesFrom: () => [],
          hashIds: () => 'fresh-hash',
          watch: () => { throw new Error('must not be called'); },
          stop() {},
          clear() {},
        },
      });

      await assert.doesNotReject(() => WLPanel.restoreHeadings());
    } finally {
      console.warn = originalWarn;
    }
  });

  it('does not call WLHeadings.watch when the run token changes while WLPlaylist.read is pending', async () => {
    // restoreHeadings() is fire-and-forget from syncTrigger() and awaits a
    // multi-page network call (WLPlaylist.read) before re-arming the
    // observer. resetForNavigation() bumps _runId but has no way to cancel
    // this in-flight call, so restoreHeadings must re-check ownership itself
    // right before watch() — otherwise a late continuation re-arms the
    // observer with a stale (or, after navigating off the playlist entirely,
    // permanently dangling) boundaries set.
    let watchCalled = false;
    let resolveRead;
    let signalReachedRead;
    const deferredRead = new Promise((resolve) => { resolveRead = resolve; });
    const reachedRead = new Promise((resolve) => { signalReachedRead = resolve; });

    const WLPanel = loadPanel({
      WLStorage: {
        getGroupMap: async () => ({
          playlistId: 'WL',
          boundaries: [{ videoId: 'a', name: 'Music', count: 1 }],
          videoIdsHash: 'match',
        }),
        setGroupMap: async () => {},
      },
      WLPlaylist: {
        read: async () => {
          signalReachedRead();
          return deferredRead;
        },
      },
      WLHeadings: {
        boundariesFrom: () => [],
        hashIds: () => 'match',
        watch: () => { watchCalled = true; },
        stop() {},
        clear() {},
      },
    });

    const restore = WLPanel.restoreHeadings(); // parks inside WLPlaylist.read
    await reachedRead;

    // Simulate resetForNavigation() firing mid-flight.
    WLPanel._runId++;

    resolveRead([{ id: 'a' }]);
    await restore;

    assert.equal(watchCalled, false, 'a stale restoreHeadings must not re-arm the observer after navigation');
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

  it('a superseded toggle does not call WLModal.showPreview or mutate currentSortOrder', async () => {
    let resolveResort;
    let signalReachedResort;
    const deferredResort = new Promise((resolve) => { resolveResort = resolve; });
    const reachedResort = new Promise((resolve) => { signalReachedResort = resolve; });

    const staleOrder = [{ id: 'stale', setVideoId: 'STALE' }];
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async (msg) => {
        if (msg.type === 'RESORT') {
          signalReachedResort();
          await deferredResort;
          return { success: true, sortOrder: [{ id: 'a', setVideoId: 'A', cluster: null, duration: 10, percentWatched: 0 }] };
        }
        throw new Error(`unexpected message ${msg.type}`);
      },
      toggleOverride: async () => ['v1'],
      playlistId: 'PL-A',
      sortOrder: staleOrder,
    });

    const toggle = WLPanel.toggleUnwatched('v1'); // parks inside the RESORT sendMessage call
    await reachedResort;

    // Simulate navigating away mid-toggle, exactly what resetForNavigation() does
    // to the run token.
    WLPanel._runId++;

    resolveResort(); // let the stale RESORT resolve now that a newer session owns the token
    await toggle;

    assert.deepEqual(modalCalls.showPreview, [], 'a superseded toggle must not render into a newer session');
    assert.deepEqual(WLPanel.currentSortOrder, staleOrder, 'a superseded toggle must not overwrite currentSortOrder');
  });

  it('shows an error and does not throw when sendMessage rejects', async () => {
    // toggleUnwatched() was the only orchestration method without a
    // try/catch, and the modal invokes it fire-and-forget — a rejection
    // (e.g. "Extension context invalidated" after an extension reload) would
    // otherwise be an unhandled rejection with the modal stuck on
    // "Re-sorting..." forever.
    const { WLPanel, modalCalls } = loadPanelWithStubs({
      sendMessage: async () => { throw new Error('Extension context invalidated'); },
      toggleOverride: async () => ['v1'],
      playlistId: 'PL123',
    });

    await assert.doesNotReject(() => WLPanel.toggleUnwatched('v1'));

    assert.deepEqual(modalCalls.showError, ['Extension context invalidated']);
  });
});

/**
 * Minimal document stub for loading content/modal.js directly — same shape as
 * documentStub above (body/createElement/querySelector), just stateful enough
 * to let #wl-trigger's presence flip after mountTrigger appends it.
 */
function makeTriggerDocument() {
  let mounted = null;
  return {
    body: { appendChild: (el) => { mounted = el; } },
    createElement: () => ({ setAttribute() {}, addEventListener() {} }),
    querySelector: (selector) => (selector === '#wl-trigger' ? mounted : null),
  };
}

describe('mountTrigger return value', () => {
  it('reports true when it creates the trigger and false when one exists', () => {
    const created = [];
    const doc = makeTriggerDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document: doc,
      getComputedStyle: () => ({ position: 'fixed', zIndex: '1', display: 'block', visibility: 'visible' }),
    });

    assert.equal(modal.mountTrigger({ onOpen: () => created.push(1) }), true);
    assert.equal(modal.mountTrigger({ onOpen: () => created.push(1) }), false, 'second call must not create a duplicate');
  });
});
