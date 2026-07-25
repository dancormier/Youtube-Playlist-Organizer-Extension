// tests/resort-handler.test.js
// Exercises the RESORT message handler in background/service-worker.js through a
// mocked `chrome` global, since the handler functions are not exported (the file is
// bundled for Firefox by raw concatenation — see background/service-worker.js header
// comment in task-9-brief.md). `chrome` is a free identifier inside the handler
// closures, resolved against globalThis at call time, so swapping globalThis.chrome
// between calls to the same captured listener works without re-importing the module.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/** Build a minimal chrome mock backed by a plain object for storage.local/sync. */
function createChromeMock({ local = {}, sync = {} } = {}) {
  const localStore = { ...local };
  const syncStore = { ...sync };
  let messageListener;

  const chrome = {
    action: { setIcon: () => Promise.resolve() },
    tabs: {
      onUpdated: { addListener: () => {} },
      onActivated: { addListener: () => {} },
      query: (_queryInfo, cb) => cb([]),
    },
    runtime: {
      onMessage: {
        addListener: (fn) => { messageListener = fn; },
      },
    },
    storage: {
      sync: {
        get: (key) => Promise.resolve(
          typeof key === 'string' ? { [key]: syncStore[key] } : { ...syncStore }
        ),
      },
      local: {
        get: (key) => Promise.resolve(
          typeof key === 'string' ? { [key]: localStore[key] } : { ...localStore }
        ),
        set: (obj) => {
          Object.assign(localStore, obj);
          return Promise.resolve();
        },
      },
    },
  };

  return { chrome, localStore, getListener: () => messageListener };
}

function video(overrides = {}) {
  return {
    id: 'v', setVideoId: 'S', title: 'T', channel: 'C',
    duration: 600, percentWatched: 0, category: null,
    description: null, unavailable: false,
    ...overrides,
  };
}

// Import the module once with a bootstrap chrome mock in place (top-level code in
// service-worker.js calls chrome.tabs.* immediately on load).
let getListener;
before(async () => {
  const bootstrap = createChromeMock();
  globalThis.chrome = bootstrap.chrome;
  await import('../background/service-worker.js');
  getListener = bootstrap.getListener;
});

function sendMessage(chrome, message) {
  globalThis.chrome = chrome;
  const listener = getListener();
  return new Promise((resolve) => {
    const keepAlive = listener(message, {}, resolve);
    assert.equal(keepAlive, true, 'listener must return true to keep the async channel open');
  });
}

describe('RESORT playlist scoping', () => {
  const videos = [
    video({ id: 'a', percentWatched: 100 }),
    video({ id: 'b', percentWatched: 0 }),
  ];
  const clusters = { clusters: [{ name: 'Music', videoIds: ['a', 'b'] }] };

  it('errors when the cache belongs to a different playlist, without falling back', async () => {
    const { chrome, localStore } = createChromeMock({
      local: { cachedClusters: { playlistId: 'WL', clusters, videos } },
    });

    const response = await sendMessage(chrome, { type: 'RESORT', overrides: ['a'], playlistId: 'OTHER' });

    assert.equal(response.success, false);
    assert.match(response.error, /different playlist/i);
    assert.equal(response.sortOrder, undefined);
    // Must not silently recompute and must not mutate overrides on a rejected resort.
    assert.equal(localStore.unwatchedOverrides, undefined);
  });

  it('succeeds and returns a recomputed order when the playlistId matches', async () => {
    const { chrome } = createChromeMock({
      local: { cachedClusters: { playlistId: 'WL', clusters, videos } },
    });

    const response = await sendMessage(chrome, { type: 'RESORT', overrides: ['a'], playlistId: 'WL' });

    assert.equal(response.success, true);
    assert.equal(response.sortOrder.every(v => v.cluster === 'Music'), true);
  });

  it('refreshes the persisted sortState so GET_SORT_STATE is not stale', async () => {
    const { chrome, localStore } = createChromeMock({
      local: {
        cachedClusters: { playlistId: 'WL', clusters, videos },
        sortState: { videos, clusters, sortOrder: [], timestamp: 1 },
      },
    });

    const response = await sendMessage(chrome, { type: 'RESORT', overrides: ['a'], playlistId: 'WL' });

    assert.equal(response.success, true);
    assert.ok(localStore.sortState, 'sortState should be written');
    assert.deepEqual(localStore.sortState.sortOrder, response.sortOrder);
    assert.ok(localStore.sortState.timestamp > 1);
  });
});
