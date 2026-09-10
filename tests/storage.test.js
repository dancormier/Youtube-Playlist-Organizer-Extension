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

  it('removes a video on toggle-off', async () => {
    const { api } = load({ unwatchedOverrides: ['a'] });
    await api.toggleOverride('b');
    assert.deepEqual([...(await api.toggleOverride('b'))], ['a']);
  });

  it('serializes concurrent toggles to prevent race conditions', async () => {
    const store = { unwatchedOverrides: [] };
    const chrome = {
      storage: {
        local: {
          async get(key) {
            // Yield control to allow interleaving
            await new Promise(r => setTimeout(r, 0));
            return key in store ? { [key]: store[key] } : {};
          },
          async set(values) {
            // Yield control to allow interleaving
            await new Promise(r => setTimeout(r, 0));
            Object.assign(store, values);
          },
        },
      },
    };
    const api = loadGlobal('content/storage.js', 'WLStorage', { chrome });

    // Fire two toggles without awaiting the first.
    // Without serialization, both would read [], compute independently, and the second
    // write would overwrite the first, losing one toggle.
    // With serialization, the second toggle waits for the first to complete and write,
    // then reads the updated state.
    const p1 = api.toggleOverride('a');
    const p2 = api.toggleOverride('b');

    await p1;
    await p2;

    // Both toggles should be present in the final store
    assert.deepEqual([...store.unwatchedOverrides].sort(), ['a', 'b']);
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

describe('WLStorage.setSortOptions', () => {
  function loadWithSync(initial = {}) {
    const sync = { ...initial };
    const chrome = {
      storage: {
        local: { async get() { return {}; }, async set() {} },
        sync: {
          async get(key) { return key in sync ? { [key]: sync[key] } : {}; },
          async set(values) { Object.assign(sync, values); },
        },
      },
    };
    return { api: loadGlobal('content/storage.js', 'WLStorage', { chrome }), sync };
  }

  it('writes sort into the existing settings object without touching its other fields', async () => {
    const { api, sync } = loadWithSync({ settings: { provider: 'openai', apiKey: 'k', sort: { withinGroup: 'title' } } });
    await api.setSortOptions({ withinGroup: 'playlist', inProgress: 'within', groupOrder: 'alpha' });
    assert.equal(sync.settings.apiKey, 'k');
    assert.equal(sync.settings.provider, 'openai');
    assert.deepEqual({ ...sync.settings.sort }, { withinGroup: 'playlist', inProgress: 'within', groupOrder: 'alpha' });
  });

  it('creates the settings object when none is stored', async () => {
    const { api, sync } = loadWithSync();
    await api.setSortOptions({ groupOrder: 'size' });
    assert.deepEqual({ ...sync.settings.sort }, { groupOrder: 'size' });
  });
});
