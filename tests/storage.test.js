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
