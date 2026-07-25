// tests/innertube.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

function load(sandbox = {}) {
  return loadGlobal('content/innertube.js', 'WLInnerTube', sandbox);
}

describe('WLInnerTube.parseConfig', () => {
  const source = `
    ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyTEST","INNERTUBE_CLIENT_NAME":"WEB",
    "INNERTUBE_CLIENT_VERSION":"2.20260724.01.01","DELEGATED_SESSION_ID":"sess123"});
  `;

  it('extracts every config field', () => {
    const config = load().parseConfig(source);
    assert.equal(config.apiKey, 'AIzaSyTEST');
    assert.equal(config.clientName, 'WEB');
    assert.equal(config.clientVersion, '2.20260724.01.01');
    assert.equal(config.delegatedSessionId, 'sess123');
  });

  it('defaults clientName to WEB when absent', () => {
    const config = load().parseConfig('{"INNERTUBE_API_KEY":"k"}');
    assert.equal(config.clientName, 'WEB');
  });

  it('returns null for missing fields rather than throwing', () => {
    const config = load().parseConfig('nothing useful here');
    assert.equal(config.apiKey, null);
    assert.equal(config.delegatedSessionId, null);
  });
});

describe('WLInnerTube.sha1Hex', () => {
  it('matches the known SHA-1 vector for "abc"', async () => {
    const hash = await load().sha1Hex('abc');
    assert.equal(hash, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('produces 40 lowercase hex characters', async () => {
    const hash = await load().sha1Hex('anything at all');
    assert.match(hash, /^[0-9a-f]{40}$/);
  });
});

describe('WLInnerTube.buildAuthHeader', () => {
  it('formats as SAPISIDHASH <ts>_<sha1>', async () => {
    const header = await load().buildAuthHeader('SECRET', 1700000000, 'https://www.youtube.com');
    assert.match(header, /^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
  });

  it('hashes timestamp, sapisid and origin joined by spaces', async () => {
    const api = load();
    const expected = await api.sha1Hex('1700000000 SECRET https://www.youtube.com');
    const header = await api.buildAuthHeader('SECRET', 1700000000, 'https://www.youtube.com');
    assert.equal(header, `SAPISIDHASH 1700000000_${expected}`);
  });
});

describe('WLInnerTube.readCookie', () => {
  it('reads a cookie by name', () => {
    const api = load({ document: { cookie: 'A=1; SAPISID=abc123; B=2' } });
    assert.equal(api.readCookie('SAPISID'), 'abc123');
  });

  it('returns null when the cookie is absent', () => {
    const api = load({ document: { cookie: 'A=1' } });
    assert.equal(api.readCookie('SAPISID'), null);
  });

  it('does not match a cookie whose name is a suffix of another', () => {
    const api = load({ document: { cookie: '__Secure-3PAPISID=wrong; SAPISID=right' } });
    assert.equal(api.readCookie('SAPISID'), 'right');
  });
});

describe('WLInnerTube.getConfig / resetConfig', () => {
  it('memoizes — calling getConfig twice returns the identical object', () => {
    const document = {
      querySelectorAll: () => [
        { textContent: '{"INNERTUBE_API_KEY":"key1","DELEGATED_SESSION_ID":"sess1"}' }
      ],
      documentElement: { innerHTML: 'fallback' },
    };
    const api = load({ document });
    const config1 = api.getConfig();
    const config2 = api.getConfig();
    assert.strictEqual(config1, config2);
  });

  it('after resetConfig, the next getConfig re-reads and reflects changed content', () => {
    const document = {
      querySelectorAll: () => [
        { textContent: '{"INNERTUBE_API_KEY":"key1","DELEGATED_SESSION_ID":"sess1"}' }
      ],
      documentElement: { innerHTML: 'fallback' },
    };
    const api = load({ document });
    const config1 = api.getConfig();
    assert.equal(config1.delegatedSessionId, 'sess1');

    // Change the document content
    document.querySelectorAll = () => [
      { textContent: '{"INNERTUBE_API_KEY":"key2","DELEGATED_SESSION_ID":"sess2"}' }
    ];

    // Without reset, it would still return the memoized config
    api.resetConfig();
    const config2 = api.getConfig();
    assert.equal(config2.delegatedSessionId, 'sess2');
  });
});
