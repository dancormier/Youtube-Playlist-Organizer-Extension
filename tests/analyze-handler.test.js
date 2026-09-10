// tests/analyze-handler.test.js
// Drives the ANALYZE, LIST_MODELS and YT_PAGE handlers in background/service-worker.js
// through a mocked `chrome` global and a stubbed global `fetch`. See
// resort-handler.test.js for why swapping globalThis.chrome between calls works.
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function createChromeMock({ local = {}, sync = {} } = {}) {
  const localStore = { ...local };
  const syncStore = { ...sync };
  const iconCalls = [];
  let messageListener;

  const pick = (store, keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (k in store) out[k] = store[k];
    return out;
  };

  const chrome = {
    action: { setIcon: (args) => { iconCalls.push(args); return Promise.resolve(); } },
    runtime: { onMessage: { addListener: (fn) => { messageListener = fn; } } },
    storage: {
      sync: {
        get: (keys) => Promise.resolve(pick(syncStore, keys)),
        set: (obj) => { Object.assign(syncStore, obj); return Promise.resolve(); },
        remove: (key) => { delete syncStore[key]; return Promise.resolve(); },
      },
      local: {
        get: (keys) => Promise.resolve(pick(localStore, keys)),
        set: (obj) => { Object.assign(localStore, obj); return Promise.resolve(); },
      },
    },
  };

  return { chrome, localStore, syncStore, iconCalls, getListener: () => messageListener };
}

function video(overrides = {}) {
  return {
    id: 'v', setVideoId: 'S', title: 'T', channel: 'C',
    duration: 600, percentWatched: 0, category: null,
    description: null, unavailable: false,
    ...overrides,
  };
}

function stubFetch(reply, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return { ok, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return calls;
}

let getListener;
const realFetch = globalThis.fetch;
before(async () => {
  const bootstrap = createChromeMock();
  globalThis.chrome = bootstrap.chrome;
  await import('../background/service-worker.js');
  getListener = bootstrap.getListener;
});
afterEach(() => { globalThis.fetch = realFetch; });

function sendMessage(chrome, message, sender = {}) {
  globalThis.chrome = chrome;
  const listener = getListener();
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true, 'listener must return true to keep the async channel open');
  });
}

describe('ANALYZE', () => {
  const videos = [video({ id: 'a' }), video({ id: 'b' }), video({ id: 'ghost', unavailable: true })];

  it('refuses without a key when the provider needs one, and never fetches', async () => {
    const calls = stubFetch({});
    const { chrome } = createChromeMock({ sync: { settings: { provider: 'anthropic', apiKey: '' } } });

    const response = await sendMessage(chrome, { type: 'ANALYZE', videos, playlistId: 'WL' });

    assert.equal(response.success, false);
    assert.equal(response.error, "No API key configured. Open the extension's settings.");
    assert.equal(calls.length, 0);
  });

  it('proceeds without a key for a provider that does not need one', async () => {
    const calls = stubFetch({ choices: [{ message: { content: '{"clusters":[{"name":"Music","videoIds":["a","b"]}]}' } }] });
    const { chrome } = createChromeMock({ sync: { settings: { provider: 'ollama' } } });

    const response = await sendMessage(chrome, { type: 'ANALYZE', videos, playlistId: 'WL' });

    assert.equal(response.success, true, response.error);
    assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  });

  it('uses the configured provider, sends only classifiable videos, and sorts by the custom taxonomy', async () => {
    const calls = stubFetch({ content: [{ text: '{"clusters":[{"name":"Knitting","videoIds":["a"]},{"name":"Woodwork","videoIds":["b"]}]}' }] });
    const { chrome, localStore } = createChromeMock({
      sync: { settings: { provider: 'anthropic', apiKey: 'k', taxonomy: ['Woodwork', 'Knitting'] } },
    });

    const response = await sendMessage(chrome, { type: 'ANALYZE', videos, playlistId: 'WL' });

    assert.equal(response.success, true, response.error);
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    const prompt = calls[0].body.messages[0].content;
    assert.ok(prompt.includes('- Woodwork\n- Knitting'));
    assert.ok(!prompt.includes('ghost'));
    assert.deepEqual(response.sortOrder.map(v => v.id), ['b', 'a', 'ghost']);
    assert.equal(localStore.cachedClusters.playlistId, 'WL');
  });

  it('migrates a legacy apiKey on the way in', async () => {
    stubFetch({ content: [{ text: '{"clusters":[]}' }] });
    const { chrome, syncStore } = createChromeMock({ sync: { apiKey: 'sk-ant-legacy' } });

    const response = await sendMessage(chrome, { type: 'ANALYZE', videos, playlistId: 'WL' });

    assert.equal(response.success, true, response.error);
    assert.equal(syncStore.settings.apiKey, 'sk-ant-legacy');
    assert.equal(syncStore.apiKey, undefined);
  });

  it('surfaces provider errors as a failed response', async () => {
    stubFetch({ error: 'nope' }, { ok: false, status: 401 });
    const { chrome } = createChromeMock({ sync: { settings: { provider: 'openai', apiKey: 'bad' } } });

    const response = await sendMessage(chrome, { type: 'ANALYZE', videos, playlistId: 'WL' });

    assert.equal(response.success, false);
    assert.match(response.error, /OpenAI API error \(401\)/);
  });
});

describe('LIST_MODELS', () => {
  it('lists models using the settings in the message, not the saved ones', async () => {
    const calls = stubFetch({ data: [{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }] });
    const { chrome } = createChromeMock({ sync: { settings: { provider: 'anthropic', apiKey: 'saved' } } });

    const response = await sendMessage(chrome, {
      type: 'LIST_MODELS', settings: { provider: 'gemini', apiKey: 'unsaved' },
    });

    assert.equal(response.success, true, response.error);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/models');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer unsaved');
    assert.deepEqual(response.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('returns the error text on failure', async () => {
    stubFetch({});
    const { chrome } = createChromeMock();
    const response = await sendMessage(chrome, { type: 'LIST_MODELS', settings: { provider: 'openai', apiKey: '' } });
    assert.equal(response.success, false);
    assert.match(response.error, /no API key/);
  });
});

describe('YT_PAGE', () => {
  it('sets the active icon on the sending tab and answers synchronously', async () => {
    const { chrome, iconCalls } = createChromeMock();
    globalThis.chrome = chrome;
    const keepAlive = getListener()({ type: 'YT_PAGE' }, { tab: { id: 42 } }, () => {});
    assert.equal(keepAlive, false);
    assert.equal(iconCalls.length, 1);
    assert.equal(iconCalls[0].tabId, 42);
    assert.match(iconCalls[0].path[16], /active/);
  });

  it('ignores a message with no tab', async () => {
    const { chrome, iconCalls } = createChromeMock();
    globalThis.chrome = chrome;
    getListener()({ type: 'YT_PAGE' }, {}, () => {});
    assert.equal(iconCalls.length, 0);
  });
});
