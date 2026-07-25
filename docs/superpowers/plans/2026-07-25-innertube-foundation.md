# InnerTube Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM-scraping and DOM-clicking data path with YouTube's InnerTube API, making a full playlist reorder one batched call instead of minutes of simulated clicks.

**Architecture:** InnerTube requires the page's cookies, so all API work happens in content scripts (which are plain globals in MV3, not ES modules). Claude calls stay in the background service worker, where the page's CSP can't interfere. Content scripts communicate with the background by message passing.

**Tech Stack:** Vanilla JS, no bundler. Chrome MV3 + Firefox MV3. Node's built-in `node:test` runner.

## Global Constraints

- **Firefox is the primary target.** Chrome is secondary. Any behaviour difference resolves in Firefox's favour.
- **Content scripts cannot be ES modules.** Files under `content/` define a single global (`const WLThing = {...}`) and are load-ordered by the manifest. Never add `import`/`export` to a `content/` file.
- **`lib/` files are ES modules**, used only by the background. Firefox's background is built by concatenating them, so declaration order in `build.sh` matters.
- **Test runner:** `node --test tests/*.test.js`. The glob is required — bare `node --test tests/` fails.
- **Commits:** Conventional Commits (`type(scope): description`). Never add AI attribution to any git artifact.
- **Manifest versions:** semver core only (`MAJOR.MINOR.PATCH`). Pre-release suffixes are invalid in both Chrome and Firefox.
- **No DOM fallback.** When InnerTube fails, surface the error. Never silently degrade.
- **Watched threshold:** `percentWatched < 10` counts as unwatched. Exactly 10 counts as watched.

---

### Task 1: Test harness for globals, and single-sourced version

Content scripts define globals, so they can't be imported by tests. Existing tests string-match source text, which doesn't test behaviour. This task adds a `node:vm` loader so later tasks can write real tests, and moves the version into `package.json` so the two manifests can't drift.

**Files:**
- Create: `tests/helpers/load-global.js`
- Modify: `package.json`
- Modify: `build.sh`
- Test: `tests/load-global.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `loadGlobal(path, globalName, sandbox?) → object` — evaluates a content script and returns the global it defines. Every later task's tests use this.

- [ ] **Step 1: Write the failing test**

Create `tests/load-global.test.js`:

```js
// tests/load-global.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { loadGlobal } from './helpers/load-global.js';

describe('loadGlobal', () => {
  const tmpDir = 'tests/.tmp';
  const tmpFile = `${tmpDir}/fixture-global.js`;

  it('returns a global declared with const', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const WLFixture = { answer: () => 42 };');
    try {
      const WLFixture = loadGlobal(tmpFile, 'WLFixture');
      assert.equal(WLFixture.answer(), 42);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('injects sandbox values the script can read', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const WLFixture = { host: () => location.host };');
    try {
      const WLFixture = loadGlobal(tmpFile, 'WLFixture', {
        location: { host: 'www.youtube.com' },
      });
      assert.equal(WLFixture.host(), 'www.youtube.com');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the global is not defined', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const Other = {};');
    try {
      assert.throws(() => loadGlobal(tmpFile, 'WLMissing'), /did not define WLMissing/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/load-global.test.js`
Expected: FAIL — `Cannot find module './helpers/load-global.js'`

- [ ] **Step 3: Write the helper**

Create `tests/helpers/load-global.js`:

```js
// tests/helpers/load-global.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Evaluate a content script and return the global it defines.
 *
 * Content scripts declare their global with `const`, which in a vm context does
 * NOT attach to the context object — so we append an explicit assignment.
 */
export function loadGlobal(path, globalName, sandbox = {}) {
  const code = readFileSync(path, 'utf8');

  const context = vm.createContext({
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    ...sandbox,
  });

  vm.runInContext(`${code}\n;globalThis[${JSON.stringify(globalName)}] = ${globalName};`, context);

  const value = context[globalName];
  if (!value) throw new Error(`${path} did not define ${globalName}`);
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/load-global.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Add version and test script to package.json**

Replace `package.json` with:

```json
{
  "private": true,
  "type": "module",
  "version": "0.5.0",
  "scripts": {
    "test": "node --test tests/*.test.js",
    "build": "./build.sh"
  },
  "dependencies": {
    "canvas": "^3.2.1"
  }
}
```

- [ ] **Step 6: Inject the version at build time**

In `build.sh`, immediately after the `cd "$SCRIPT_DIR"` line, add:

```bash
VERSION=$(node -p "require('./package.json').version")
echo "Building version $VERSION"
```

Then replace the two `cp manifest.*.json` lines. Change:

```bash
cp manifest.chrome.json dist/chrome/manifest.json
```

to:

```bash
node -e "
  const m = require('./manifest.chrome.json');
  m.version = process.argv[1];
  require('fs').writeFileSync('dist/chrome/manifest.json', JSON.stringify(m, null, 2));
" "$VERSION"
```

And change:

```bash
cp manifest.firefox.json dist/firefox/manifest.json
```

to:

```bash
node -e "
  const m = require('./manifest.firefox.json');
  m.version = process.argv[1];
  require('fs').writeFileSync('dist/firefox/manifest.json', JSON.stringify(m, null, 2));
" "$VERSION"
```

- [ ] **Step 7: Verify both manifests get the same version**

Run:

```bash
./build.sh >/dev/null && \
  node -p "require('./dist/chrome/manifest.json').version" && \
  node -p "require('./dist/firefox/manifest.json').version"
```

Expected: `0.5.0` printed twice.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — the 16 existing tests plus 3 new ones

- [ ] **Step 9: Commit**

```bash
git add tests/helpers/load-global.js tests/load-global.test.js package.json build.sh
git commit -m "test: add vm-based loader for content-script globals, single-source version"
```

---

### Task 2: WLInnerTube — config parsing and request signing

The two pure pieces of the API layer: pulling client config out of page HTML, and building the `SAPISIDHASH` authorization header.

**Files:**
- Create: `content/innertube.js`
- Test: `tests/innertube.test.js`

**Interfaces:**
- Consumes: `loadGlobal` from Task 1
- Produces:
  - `WLInnerTube.parseConfig(source: string) → {apiKey, clientName, clientVersion, delegatedSessionId}`
  - `WLInnerTube.sha1Hex(input: string) → Promise<string>`
  - `WLInnerTube.buildAuthHeader(sapisid: string, timestamp: number, origin: string) → Promise<string>`
  - `WLInnerTube.readCookie(name: string) → string|null`

- [ ] **Step 1: Write the failing test**

Create `tests/innertube.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/innertube.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/innertube.js'`

- [ ] **Step 3: Write the implementation**

Create `content/innertube.js`:

```js
// content/innertube.js
// The only module that knows about YouTube's internal API.
// Loaded as a content script global — no imports, no exports.

const WLInnerTube = {
  ORIGIN: 'https://www.youtube.com',
  _config: null,

  /** Pull InnerTube client config from page HTML. Pure — takes source, returns config. */
  parseConfig(source) {
    const pick = (re) => {
      const match = source.match(re);
      return match ? match[1] : null;
    };
    return {
      apiKey: pick(/"INNERTUBE_API_KEY":"(.*?)"/),
      clientName: pick(/"INNERTUBE_CLIENT_NAME":"(.*?)"/) || 'WEB',
      clientVersion: pick(/"INNERTUBE_CLIENT_VERSION":"(.*?)"/),
      delegatedSessionId: pick(/"DELEGATED_SESSION_ID":"(.*?)"/),
    };
  },

  /** Scan inline script text only — YouTube's full innerHTML is multiple MB. */
  getConfig() {
    if (this._config) return this._config;

    const scripts = [...document.querySelectorAll('script')]
      .map(s => s.textContent || '')
      .filter(t => t.includes('INNERTUBE_API_KEY'));
    const source = scripts.length ? scripts.join('\n') : document.documentElement.innerHTML;

    this._config = this.parseConfig(source);
    return this._config;
  },

  readCookie(name) {
    const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
    return match ? match[2] : null;
  },

  async sha1Hex(input) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /** Google's scheme: SHA1("<unix seconds> <SAPISID> <origin>"). */
  async buildAuthHeader(sapisid, timestamp, origin) {
    const hash = await this.sha1Hex(`${timestamp} ${sapisid} ${origin}`);
    return `SAPISIDHASH ${timestamp}_${hash}`;
  },

  /** Live auth from the page's cookie jar. Returns null when no cookie is readable. */
  async currentAuth() {
    const sapisid =
      this.readCookie('SAPISID') ||
      this.readCookie('__Secure-3PAPISID') ||
      this.readCookie('__Secure-1PAPISID');
    if (!sapisid) return null;
    return this.buildAuthHeader(sapisid, Math.floor(Date.now() / 1000), this.ORIGIN);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/innertube.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add content/innertube.js tests/innertube.test.js
git commit -m "feat(innertube): add config parsing and SAPISIDHASH signing"
```

---

### Task 3: WLInnerTube — calls, errors, and continuation paging

Adds the network layer. `nextToken` must prefer the token under `continuationItemRenderer`; picking the last `continuationCommand` in the tree selects an unrelated widget's token and paging stalls — this was measured during the spike.

**Files:**
- Modify: `content/innertube.js`
- Test: `tests/innertube.test.js`

**Interfaces:**
- Consumes: `WLInnerTube.parseConfig`, `WLInnerTube.currentAuth` from Task 2
- Produces:
  - `WLInnerTube.call(endpoint: string, body: object) → Promise<object>` — throws `InnerTubeError`
  - `WLInnerTube.nextToken(data: object) → string|null`
  - `WLInnerTube.findAll(obj: object, key: string) → any[]`
  - `WLInnerTube.pageAll(body: object, maxPages?: number) → Promise<object[]>`
  - `InnerTubeError` with `.endpoint`, `.status`, `.snippet`

- [ ] **Step 1: Write the failing test**

Append to `tests/innertube.test.js`:

```js
describe('WLInnerTube.findAll', () => {
  it('finds values at any depth', () => {
    const api = load();
    const tree = { a: { b: [{ target: 1 }, { c: { target: 2 } }] } };
    assert.deepEqual(api.findAll(tree, 'target'), [1, 2]);
  });

  it('returns an empty array when the key is absent', () => {
    assert.deepEqual(load().findAll({ a: 1 }, 'missing'), []);
  });
});

describe('WLInnerTube.nextToken', () => {
  it('prefers the token under continuationItemRenderer', () => {
    const data = {
      decoy: { continuationCommand: { token: 'WRONG' } },
      contents: {
        continuationItemRenderer: {
          continuationEndpoint: { continuationCommand: { token: 'RIGHT' } },
        },
      },
    };
    assert.equal(load().nextToken(data), 'RIGHT');
  });

  it('returns null when there is no continuation', () => {
    assert.equal(load().nextToken({ contents: [] }), null);
  });

  it('ignores continuation entries with no token', () => {
    const data = { continuationItemRenderer: { continuationCommand: {} } };
    assert.equal(load().nextToken(data), null);
  });
});

describe('WLInnerTube.call', () => {
  function apiWithFetch(fetchImpl) {
    const api = load({ fetch: fetchImpl, document: { cookie: 'SAPISID=secret' } });
    api._config = { apiKey: 'K', clientName: 'WEB', clientVersion: '2.0', delegatedSessionId: null };
    return api;
  }

  it('returns parsed JSON on success', async () => {
    const api = apiWithFetch(async () => ({
      ok: true, status: 200, json: async () => ({ hello: 'world' }),
    }));
    assert.deepEqual(await api.call('browse', { browseId: 'VLWL' }), { hello: 'world' });
  });

  it('sends the auth header and credentials', async () => {
    let seen = null;
    const api = apiWithFetch(async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await api.call('browse', { browseId: 'VLWL' });
    assert.match(seen.url, /youtubei\/v1\/browse\?key=K/);
    assert.match(seen.options.headers.Authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    assert.equal(seen.options.credentials, 'include');
  });

  it('merges the client context into the body', async () => {
    let body = null;
    const api = apiWithFetch(async (url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await api.call('browse', { browseId: 'VLWL' });
    assert.equal(body.browseId, 'VLWL');
    assert.equal(body.context.client.clientVersion, '2.0');
  });

  it('throws InnerTubeError carrying endpoint and status', async () => {
    const api = apiWithFetch(async () => ({
      ok: false, status: 404, text: async () => 'Requested entity was not found.',
    }));
    await assert.rejects(
      () => api.call('browse', {}),
      (err) => {
        assert.equal(err.name, 'InnerTubeError');
        assert.equal(err.endpoint, 'browse');
        assert.equal(err.status, 404);
        assert.match(err.snippet, /not found/);
        return true;
      }
    );
  });

  it('throws InnerTubeError when there is no readable cookie', async () => {
    const api = load({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
                       document: { cookie: '' } });
    api._config = { apiKey: 'K', clientName: 'WEB', clientVersion: '2.0' };
    await assert.rejects(() => api.call('browse', {}), /no readable SAPISID/i);
  });
});

describe('WLInnerTube.pageAll', () => {
  it('follows continuations until exhausted', async () => {
    const pages = [
      { id: 1, continuationItemRenderer: { continuationCommand: { token: 't1' } } },
      { id: 2, continuationItemRenderer: { continuationCommand: { token: 't2' } } },
      { id: 3 },
    ];
    let call = 0;
    const api = load({
      fetch: async () => ({ ok: true, status: 200, json: async () => pages[call++] }),
      document: { cookie: 'SAPISID=secret' },
    });
    api._config = { apiKey: 'K', clientName: 'WEB', clientVersion: '2.0' };

    const result = await api.pageAll({ browseId: 'VLWL' });
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(p => p.id), [1, 2, 3]);
  });

  it('stops when a continuation token repeats', async () => {
    const stuck = { id: 'x', continuationItemRenderer: { continuationCommand: { token: 'same' } } };
    const api = load({
      fetch: async () => ({ ok: true, status: 200, json: async () => stuck }),
      document: { cookie: 'SAPISID=secret' },
    });
    api._config = { apiKey: 'K', clientName: 'WEB', clientVersion: '2.0' };

    const result = await api.pageAll({ browseId: 'VLWL' });
    assert.equal(result.length, 2, 'should stop once the token repeats');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/innertube.test.js`
Expected: FAIL — `api.findAll is not a function`

- [ ] **Step 3: Write the implementation**

In `content/innertube.js`, insert this class above `const WLInnerTube = {`:

```js
class InnerTubeError extends Error {
  constructor(endpoint, status, snippet) {
    super(`InnerTube ${endpoint} failed (${status}): ${snippet}`);
    this.name = 'InnerTubeError';
    this.endpoint = endpoint;
    this.status = status;
    this.snippet = snippet;
  }
}
```

Then add these methods inside the `WLInnerTube` object, after `currentAuth`:

```js
  /** Recursively collect every value stored under `key`. */
  findAll(obj, key, found = []) {
    if (obj === null || typeof obj !== 'object') return found;
    if (Array.isArray(obj)) {
      for (const value of obj) this.findAll(value, key, found);
      return found;
    }
    for (const [k, value] of Object.entries(obj)) {
      if (k === key) found.push(value);
      this.findAll(value, key, found);
    }
    return found;
  },

  /**
   * The feed's "load more" token. Responses carry several continuationCommands
   * for unrelated widgets, so prefer the one under continuationItemRenderer.
   */
  nextToken(data) {
    for (const item of this.findAll(data, 'continuationItemRenderer')) {
      const commands = this.findAll(item, 'continuationCommand').filter(c => c && c.token);
      if (commands.length) return commands[0].token;
    }
    return null;
  },

  async call(endpoint, body) {
    const config = this.getConfig();
    const auth = await this.currentAuth();
    if (!auth) {
      throw new InnerTubeError(endpoint, 0, 'no readable SAPISID cookie — are you signed in?');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': auth,
      'X-Goog-AuthUser': '0',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': config.clientVersion || '',
    };
    if (config.delegatedSessionId) headers['X-Goog-PageId'] = config.delegatedSessionId;

    const url = `${this.ORIGIN}/youtubei/v1/${endpoint}?key=${config.apiKey}&prettyPrint=false`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          context: {
            client: {
              clientName: config.clientName,
              clientVersion: config.clientVersion,
              hl: 'en',
              gl: 'US',
            },
          },
          ...body,
        }),
      });
    } catch (err) {
      throw new InnerTubeError(endpoint, 0, String(err));
    }

    if (!response.ok) {
      const text = await response.text();
      throw new InnerTubeError(endpoint, response.status, text.slice(0, 200));
    }
    return response.json();
  },

  /** Follow continuations, returning every page's raw response. */
  async pageAll(body, maxPages = 20) {
    const first = await this.call('browse', body);
    const pages = [first];

    let token = this.nextToken(first);
    const seen = new Set();

    for (let page = 1; page < maxPages && token; page++) {
      if (seen.has(token)) break;
      seen.add(token);

      const next = await this.call('browse', { continuation: token });
      pages.push(next);
      token = this.nextToken(next);
    }
    return pages;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/innertube.test.js`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add content/innertube.js tests/innertube.test.js
git commit -m "feat(innertube): add call layer, typed errors and continuation paging"
```

---

### Task 4: WLPlaylist — reading a playlist

**Files:**
- Create: `content/playlist.js`
- Test: `tests/playlist.test.js`

**Interfaces:**
- Consumes: `WLInnerTube.pageAll`, `WLInnerTube.findAll`, `WLInnerTube.call`
- Produces:
  - `WLPlaylist.browseIdFor(playlistId: string) → string`
  - `WLPlaylist.normalize(renderer: object) → Video|null`
  - `WLPlaylist.read(playlistId: string) → Promise<Video[]>`
  - `Video = {id, setVideoId, title, channel, duration, percentWatched, category, description, unavailable}`

- [ ] **Step 1: Write the failing test**

Create `tests/playlist.test.js`:

```js
// tests/playlist.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

function load(innerTube = {}) {
  const stub = {
    findAll(obj, key, found = []) {
      if (obj === null || typeof obj !== 'object') return found;
      if (Array.isArray(obj)) { for (const v of obj) this.findAll(v, key, found); return found; }
      for (const [k, v] of Object.entries(obj)) {
        if (k === key) found.push(v);
        this.findAll(v, key, found);
      }
      return found;
    },
    ...innerTube,
  };
  return loadGlobal('content/playlist.js', 'WLPlaylist', { WLInnerTube: stub });
}

function renderer(overrides = {}) {
  return {
    videoId: 'abc123',
    setVideoId: 'SET1',
    lengthSeconds: '520',
    title: { runs: [{ text: 'Some Video' }] },
    shortBylineText: { runs: [{ text: 'Some Channel' }] },
    thumbnailOverlays: [
      { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 32 } },
    ],
    ...overrides,
  };
}

describe('WLPlaylist.browseIdFor', () => {
  it('maps WL to VLWL', () => {
    assert.equal(load().browseIdFor('WL'), 'VLWL');
  });
  it('prefixes other playlists with VL', () => {
    assert.equal(load().browseIdFor('PLabc'), 'VLPLabc');
  });
});

describe('WLPlaylist.normalize', () => {
  it('extracts every field', () => {
    const video = load().normalize(renderer());
    assert.equal(video.id, 'abc123');
    assert.equal(video.setVideoId, 'SET1');
    assert.equal(video.title, 'Some Video');
    assert.equal(video.channel, 'Some Channel');
    assert.equal(video.duration, 520);
    assert.equal(video.percentWatched, 32);
    assert.equal(video.unavailable, false);
  });

  it('defaults percentWatched to 0 when there is no resume overlay', () => {
    const video = load().normalize(renderer({ thumbnailOverlays: [] }));
    assert.equal(video.percentWatched, 0);
  });

  it('initialises enrichment fields to null', () => {
    const video = load().normalize(renderer());
    assert.equal(video.category, null);
    assert.equal(video.description, null);
  });

  it('marks entries with no title as unavailable', () => {
    const video = load().normalize(renderer({ title: undefined }));
    assert.equal(video.unavailable, true);
    assert.equal(video.title, '[Unavailable]');
  });

  it('returns null when there is no setVideoId, since reorder is impossible', () => {
    assert.equal(load().normalize(renderer({ setVideoId: undefined })), null);
  });

  it('defaults a missing channel to Unknown', () => {
    const video = load().normalize(renderer({ shortBylineText: undefined }));
    assert.equal(video.channel, 'Unknown');
  });
});

describe('WLPlaylist.read', () => {
  it('flattens every page into one list', async () => {
    const playlist = load({
      pageAll: async () => [
        { contents: [{ playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) }] },
        { contents: [{ playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: 'S2' }) }] },
      ],
    });
    const videos = await playlist.read('WL');
    assert.deepEqual(videos.map(v => v.id), ['a', 'b']);
  });

  it('deduplicates entries repeated across pages', async () => {
    const dupe = { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) };
    const playlist = load({ pageAll: async () => [{ contents: [dupe] }, { contents: [dupe] }] });
    const videos = await playlist.read('WL');
    assert.equal(videos.length, 1);
  });

  it('skips renderers with no setVideoId', async () => {
    const playlist = load({
      pageAll: async () => [{
        contents: [
          { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) },
          { playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: undefined }) },
        ],
      }],
    });
    const videos = await playlist.read('WL');
    assert.deepEqual(videos.map(v => v.id), ['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/playlist.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/playlist.js'`

- [ ] **Step 3: Write the implementation**

Create `content/playlist.js`:

```js
// content/playlist.js
// Depends on: content/innertube.js (loaded first via manifest)

const WLPlaylist = {
  browseIdFor(playlistId) {
    return playlistId === 'WL' ? 'VLWL' : `VL${playlistId}`;
  },

  /** First text run anywhere under `field`, or null. */
  _text(field) {
    if (!field) return null;
    const runs = WLInnerTube.findAll(field, 'text');
    return runs.length ? String(runs[0]) : null;
  },

  /**
   * Turn a playlistVideoRenderer into a Video.
   * Returns null when there is no setVideoId — reorder is impossible without it.
   */
  normalize(renderer) {
    if (!renderer || !renderer.setVideoId) return null;

    const title = this._text(renderer.title);
    const resume = WLInnerTube.findAll(renderer, 'percentDurationWatched');

    return {
      id: renderer.videoId || '',
      setVideoId: renderer.setVideoId,
      title: title || '[Unavailable]',
      channel: this._text(renderer.shortBylineText) || 'Unknown',
      duration: Number(renderer.lengthSeconds) || 0,
      percentWatched: resume.length ? Number(resume[0]) : 0,
      category: null,
      description: null,
      unavailable: !title,
    };
  },

  async read(playlistId) {
    const pages = await WLInnerTube.pageAll({ browseId: this.browseIdFor(playlistId) });

    const videos = [];
    const seen = new Set();

    for (const page of pages) {
      for (const renderer of WLInnerTube.findAll(page, 'playlistVideoRenderer')) {
        const video = this.normalize(renderer);
        if (!video || seen.has(video.setVideoId)) continue;
        seen.add(video.setVideoId);
        videos.push(video);
      }
    }
    return videos;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/playlist.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add content/playlist.js tests/playlist.test.js
git commit -m "feat(playlist): read and normalise playlists from InnerTube"
```

---

### Task 5: WLPlaylist — applying a new order

Every move goes in one `edit_playlist` call. Writes are not read-your-own-write consistent, so confirmation polls — measured at ~1.2s during the spike.

**Files:**
- Modify: `content/playlist.js`
- Test: `tests/playlist.test.js`

**Interfaces:**
- Consumes: `WLPlaylist.read` from Task 4
- Produces:
  - `WLPlaylist.buildMoveActions(orderedSetVideoIds: string[]) → object[]`
  - `WLPlaylist.applyOrder(playlistId: string, orderedSetVideoIds: string[]) → Promise<{applied: boolean, waitedMs: number}>`

- [ ] **Step 1: Write the failing test**

Append to `tests/playlist.test.js`:

```js
describe('WLPlaylist.buildMoveActions', () => {
  it('anchors the first item with MOVE_VIDEO_BEFORE', () => {
    const [first] = load().buildMoveActions(['A', 'B', 'C']);
    assert.equal(first.action, 'ACTION_MOVE_VIDEO_BEFORE');
    assert.equal(first.setVideoId, 'A');
    assert.equal(first.movedSetVideoIdSuccessor, 'B');
  });

  it('chains every later item after its predecessor', () => {
    const actions = load().buildMoveActions(['A', 'B', 'C']);
    assert.equal(actions[1].action, 'ACTION_MOVE_VIDEO_AFTER');
    assert.equal(actions[1].setVideoId, 'B');
    assert.equal(actions[1].movedSetVideoIdPredecessor, 'A');
    assert.equal(actions[2].movedSetVideoIdPredecessor, 'B');
  });

  it('produces one action per item', () => {
    assert.equal(load().buildMoveActions(['A', 'B', 'C', 'D']).length, 4);
  });

  it('returns no actions for lists too short to reorder', () => {
    assert.deepEqual(load().buildMoveActions(['A']), []);
    assert.deepEqual(load().buildMoveActions([]), []);
  });

  it('never omits the anchor, which YouTube treats as a silent no-op', () => {
    for (const action of load().buildMoveActions(['A', 'B', 'C'])) {
      const anchored = action.movedSetVideoIdPredecessor || action.movedSetVideoIdSuccessor;
      assert.ok(anchored, `action for ${action.setVideoId} has no anchor`);
    }
  });
});

describe('WLPlaylist.applyOrder', () => {
  function withCalls(handlers) {
    const calls = [];
    const playlist = load({
      call: async (endpoint, body) => {
        calls.push({ endpoint, body });
        return handlers(endpoint, body, calls.length);
      },
      pageAll: async () => [handlers('browse', {}, calls.length)],
    });
    return { playlist, calls };
  }

  it('makes no edit call for a list too short to reorder', async () => {
    const { playlist, calls } = withCalls((endpoint) =>
      endpoint === 'browse/edit_playlist'
        ? { status: 'STATUS_SUCCEEDED' }
        : { contents: [{ playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'A' }) }] }
    );
    await playlist.applyOrder('PLx', ['A']);
    const edits = calls.filter(c => c.endpoint === 'browse/edit_playlist');
    assert.equal(edits.length, 0);
  });

  it('batches all actions into one edit_playlist request', async () => {
    const { playlist, calls } = withCalls((endpoint) =>
      endpoint === 'browse/edit_playlist'
        ? { status: 'STATUS_SUCCEEDED' }
        : {
            contents: [
              { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'A' }) },
              { playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: 'B' }) },
            ],
          }
    );
    await playlist.applyOrder('PLx', ['A', 'B']);
    const edits = calls.filter(c => c.endpoint === 'browse/edit_playlist');
    assert.equal(edits.length, 1);
    assert.equal(edits[0].body.actions.length, 2);
    assert.equal(edits[0].body.playlistId, 'PLx');
  });

  it('reports applied:true once the order matches', async () => {
    const { playlist } = withCalls((endpoint) =>
      endpoint === 'browse/edit_playlist'
        ? { status: 'STATUS_SUCCEEDED' }
        : {
            contents: [
              { playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: 'B' }) },
              { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'A' }) },
            ],
          }
    );
    const result = await playlist.applyOrder('PLx', ['B', 'A']);
    assert.equal(result.applied, true);
  });

  it('reports applied:false when the order never converges', async () => {
    const { playlist } = withCalls((endpoint) =>
      endpoint === 'browse/edit_playlist'
        ? { status: 'STATUS_SUCCEEDED' }
        : {
            contents: [
              { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'A' }) },
              { playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: 'B' }) },
            ],
          }
    );
    const result = await playlist.applyOrder('PLx', ['B', 'A'], { timeoutMs: 50, intervalMs: 10 });
    assert.equal(result.applied, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/playlist.test.js`
Expected: FAIL — `playlist.buildMoveActions is not a function`

- [ ] **Step 3: Write the implementation**

Append these methods to the `WLPlaylist` object in `content/playlist.js`:

```js
  /**
   * Chain each entry after its predecessor. Every action MUST carry an anchor —
   * an action with neither predecessor nor successor is a silent no-op that
   * still returns STATUS_SUCCEEDED.
   */
  buildMoveActions(ordered) {
    if (ordered.length < 2) return [];

    return ordered.map((setVideoId, index) =>
      index === 0
        ? {
            action: 'ACTION_MOVE_VIDEO_BEFORE',
            setVideoId,
            movedSetVideoIdSuccessor: ordered[1],
          }
        : {
            action: 'ACTION_MOVE_VIDEO_AFTER',
            setVideoId,
            movedSetVideoIdPredecessor: ordered[index - 1],
          }
    );
  },

  async _currentOrder(playlistId) {
    const videos = await this.read(playlistId);
    return videos.map(v => v.setVideoId);
  },

  /**
   * Apply an order in one call, then poll until it is visible.
   * Reads are cached server-side, so an immediate read returns stale data.
   */
  async applyOrder(playlistId, ordered, { timeoutMs = 10000, intervalMs = 800 } = {}) {
    const actions = this.buildMoveActions(ordered);
    if (actions.length === 0) return { applied: true, waitedMs: 0 };

    await WLInnerTube.call('browse/edit_playlist', { playlistId, actions });

    const target = ordered.join(',');
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const current = await this._currentOrder(playlistId);
      if (current.join(',') === target) {
        return { applied: true, waitedMs: Date.now() - started };
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return { applied: false, waitedMs: Date.now() - started };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/playlist.test.js`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add content/playlist.js tests/playlist.test.js
git commit -m "feat(playlist): apply sort order in one batched edit_playlist call"
```

---

### Task 6: WLEnrich — per-video category and description

**Files:**
- Create: `content/enrich.js`
- Test: `tests/enrich.test.js`

**Interfaces:**
- Consumes: `WLInnerTube.call`
- Produces:
  - `WLEnrich.MAX_DESCRIPTION = 300`
  - `WLEnrich.extract(playerResponse: object) → {category, description}`
  - `WLEnrich.enrich(videos: Video[], options?) → Promise<Video[]>` — mutates and returns the same array

- [ ] **Step 1: Write the failing test**

Create `tests/enrich.test.js`:

```js
// tests/enrich.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

function load(innerTube = {}) {
  return loadGlobal('content/enrich.js', 'WLEnrich', { WLInnerTube: innerTube });
}

function playerResponse(overrides = {}) {
  return {
    videoDetails: { shortDescription: 'A description.', ...overrides.videoDetails },
    microformat: { playerMicroformatRenderer: { category: 'Science & Technology', ...overrides.micro } },
  };
}

describe('WLEnrich.extract', () => {
  it('pulls category and description', () => {
    const { category, description } = load().extract(playerResponse());
    assert.equal(category, 'Science & Technology');
    assert.equal(description, 'A description.');
  });

  it('truncates long descriptions to MAX_DESCRIPTION', () => {
    const enrich = load();
    const long = 'x'.repeat(1000);
    const { description } = enrich.extract(playerResponse({ videoDetails: { shortDescription: long } }));
    assert.equal(description.length, enrich.MAX_DESCRIPTION);
  });

  it('returns nulls when fields are absent', () => {
    const { category, description } = load().extract({});
    assert.equal(category, null);
    assert.equal(description, null);
  });
});

describe('WLEnrich.enrich', () => {
  it('populates every video', async () => {
    const enrich = load({ call: async () => playerResponse() });
    const videos = [
      { id: 'a', category: null, description: null },
      { id: 'b', category: null, description: null },
    ];
    await enrich.enrich(videos, { concurrency: 2 });
    assert.equal(videos[0].category, 'Science & Technology');
    assert.equal(videos[1].category, 'Science & Technology');
  });

  it('leaves fields null when a call fails, without rejecting', async () => {
    const enrich = load({
      call: async (endpoint, body) => {
        if (body.videoId === 'b') throw new Error('boom');
        return playerResponse();
      },
    });
    const videos = [
      { id: 'a', category: null, description: null },
      { id: 'b', category: null, description: null },
    ];
    await enrich.enrich(videos, { concurrency: 2 });
    assert.equal(videos[0].category, 'Science & Technology');
    assert.equal(videos[1].category, null);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const enrich = load({
      call: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return playerResponse();
      },
    });
    const videos = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, category: null, description: null }));
    await enrich.enrich(videos, { concurrency: 3 });
    assert.ok(peak <= 3, `peak concurrency was ${peak}`);
  });

  it('skips unavailable videos, which have nothing to fetch', async () => {
    let calls = 0;
    const enrich = load({ call: async () => { calls++; return playerResponse(); } });
    await enrich.enrich([{ id: 'a', unavailable: true, category: null, description: null }]);
    assert.equal(calls, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enrich.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'content/enrich.js'`

- [ ] **Step 3: Write the implementation**

Create `content/enrich.js`:

```js
// content/enrich.js
// Depends on: content/innertube.js

const WLEnrich = {
  MAX_DESCRIPTION: 300,

  extract(playerResponse) {
    const details = (playerResponse && playerResponse.videoDetails) || {};
    const micro =
      (playerResponse && playerResponse.microformat && playerResponse.microformat.playerMicroformatRenderer) || {};

    const description = typeof details.shortDescription === 'string'
      ? details.shortDescription.slice(0, this.MAX_DESCRIPTION)
      : null;

    return { category: micro.category || null, description };
  },

  /**
   * Fetch category and description for each video.
   * A failed call leaves the fields null rather than failing the whole sort —
   * classification still works from title and channel.
   */
  async enrich(videos, { concurrency = 6 } = {}) {
    const targets = videos.filter(v => !v.unavailable);
    let cursor = 0;

    const worker = async () => {
      while (cursor < targets.length) {
        const video = targets[cursor++];
        try {
          const response = await WLInnerTube.call('player', { videoId: video.id });
          const { category, description } = this.extract(response);
          video.category = category;
          video.description = description;
        } catch {
          // Leave category/description null — enrichment is best-effort.
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, targets.length) }, worker);
    await Promise.all(workers);
    return videos;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/enrich.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add content/enrich.js tests/enrich.test.js
git commit -m "feat(enrich): fetch category and description with bounded concurrency"
```

---

### Task 7: Taxonomy and the rewritten sort

Replaces the fractional `progress` model with integer `percentWatched`, adds the 10% threshold, per-video overrides, and ghost handling.

**Files:**
- Create: `lib/taxonomy.js`
- Modify: `lib/sort.js` (full rewrite)
- Modify: `tests/sort.test.js` (full rewrite)
- Modify: `build.sh`

**Interfaces:**
- Consumes: `Video` shape from Task 4
- Produces:
  - `TAXONOMY: string[]` and `UNAVAILABLE_GROUP = 'Unavailable'` from `lib/taxonomy.js`
  - `WATCHED_THRESHOLD = 10`, `effectiveProgress(video, overrides) → number`
  - `buildSortOrder(videos, clusterResult, overrides?) → SortedVideo[]` where `SortedVideo = Video & {cluster: string|null}`

- [ ] **Step 1: Write the failing test**

Replace `tests/sort.test.js` entirely:

```js
// tests/sort.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSortOrder, effectiveProgress, WATCHED_THRESHOLD } from '../lib/sort.js';
import { UNAVAILABLE_GROUP } from '../lib/taxonomy.js';

function video(overrides = {}) {
  return {
    id: 'v', setVideoId: 'S', title: 'T', channel: 'C',
    duration: 600, percentWatched: 0, category: null,
    description: null, unavailable: false,
    ...overrides,
  };
}

describe('effectiveProgress', () => {
  it('treats progress below the threshold as unwatched', () => {
    assert.equal(effectiveProgress(video({ percentWatched: 9 }), []), 0);
  });

  it('treats exactly the threshold as watched', () => {
    assert.equal(effectiveProgress(video({ percentWatched: WATCHED_THRESHOLD }), []), WATCHED_THRESHOLD);
  });

  it('treats an overridden video as unwatched regardless of progress', () => {
    assert.equal(effectiveProgress(video({ id: 'x', percentWatched: 100 }), ['x']), 0);
  });

  it('leaves non-overridden videos alone', () => {
    assert.equal(effectiveProgress(video({ id: 'x', percentWatched: 50 }), ['other']), 50);
  });
});

describe('buildSortOrder', () => {
  const clusters = {
    clusters: [
      { name: 'Tech & AI', videoIds: ['t1', 't2'] },
      { name: 'Music', videoIds: ['m1'] },
    ],
  };

  it('returns an empty array for empty input', () => {
    assert.deepEqual(buildSortOrder([], { clusters: [] }, []), []);
  });

  it('puts in-progress videos first', () => {
    const videos = [
      video({ id: 't1', percentWatched: 0 }),
      video({ id: 'p1', percentWatched: 50 }),
    ];
    const [first] = buildSortOrder(videos, clusters, []);
    assert.equal(first.id, 'p1');
    assert.equal(first.cluster, null);
  });

  it('sorts in-progress by remaining watch time ascending', () => {
    const videos = [
      video({ id: 'long', duration: 1000, percentWatched: 50 }),   // 500s left
      video({ id: 'short', duration: 400, percentWatched: 50 }),   // 200s left
    ];
    const order = buildSortOrder(videos, { clusters: [] }, []);
    assert.deepEqual(order.map(v => v.id), ['short', 'long']);
  });

  it('does not promote videos below the threshold', () => {
    const videos = [
      video({ id: 't1', percentWatched: 5 }),
      video({ id: 't2', percentWatched: 0 }),
    ];
    const order = buildSortOrder(videos, clusters, []);
    assert.equal(order.every(v => v.cluster !== null), true);
  });

  it('respects overrides, moving the video out of in-progress', () => {
    const videos = [video({ id: 't1', percentWatched: 100 })];
    const order = buildSortOrder(videos, clusters, ['t1']);
    assert.equal(order[0].cluster, 'Tech & AI');
  });

  it('orders groups by the taxonomy, not by cluster response order', () => {
    const videos = [video({ id: 't1' }), video({ id: 'm1' })];
    const order = buildSortOrder(videos, clusters, []);
    // Music precedes Tech & AI in the taxonomy.
    assert.deepEqual(order.map(v => v.id), ['m1', 't1']);
  });

  it('sorts by duration ascending within a group', () => {
    const videos = [
      video({ id: 't1', duration: 900 }),
      video({ id: 't2', duration: 300 }),
    ];
    const order = buildSortOrder(videos, clusters, []);
    assert.deepEqual(order.map(v => v.id), ['t2', 't1']);
  });

  it('places unavailable videos last, in their own group', () => {
    const videos = [
      video({ id: 'ghost', unavailable: true }),
      video({ id: 't1' }),
    ];
    const order = buildSortOrder(videos, clusters, []);
    assert.equal(order[order.length - 1].id, 'ghost');
    assert.equal(order[order.length - 1].cluster, UNAVAILABLE_GROUP);
  });

  it('puts unclustered videos in Other, before unavailable', () => {
    const videos = [
      video({ id: 'ghost', unavailable: true }),
      video({ id: 'orphan' }),
      video({ id: 't1' }),
    ];
    const order = buildSortOrder(videos, clusters, []);
    assert.deepEqual(order.map(v => v.id), ['t1', 'orphan', 'ghost']);
    assert.equal(order[1].cluster, 'Other');
  });

  it('appends model-invented categories after the taxonomy', () => {
    const videos = [video({ id: 'n1' }), video({ id: 'm1' })];
    const withNew = { clusters: [{ name: 'Knitting', videoIds: ['n1'] }, { name: 'Music', videoIds: ['m1'] }] };
    const order = buildSortOrder(videos, withNew, []);
    assert.deepEqual(order.map(v => v.id), ['m1', 'n1']);
  });

  it('includes every input video exactly once', () => {
    const videos = [
      video({ id: 't1' }), video({ id: 't2' }), video({ id: 'm1' }),
      video({ id: 'orphan' }), video({ id: 'ghost', unavailable: true }),
      video({ id: 'p1', percentWatched: 40 }),
    ];
    const order = buildSortOrder(videos, clusters, []);
    assert.equal(order.length, videos.length);
    assert.equal(new Set(order.map(v => v.id)).size, videos.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sort.test.js`
Expected: FAIL — `Cannot find module '../lib/taxonomy.js'`

- [ ] **Step 3: Create the taxonomy**

Create `lib/taxonomy.js`:

```js
// lib/taxonomy.js
// Ordered casual → serious. The model assigns into this list and may add a
// small number of its own; anything unrecognised sorts after these.

export const TAXONOMY = [
  'Music',
  'Comedy & Entertainment',
  'Food & Cooking',
  'Home & DIY',
  'Health & Fitness',
  'Tech & AI',
  'Geography & Nature',
  'Science & Space',
  'True Crime & History',
  'Philosophy & Self-Help',
  'Politics & News',
];

export const OTHER_GROUP = 'Other';
export const UNAVAILABLE_GROUP = 'Unavailable';
export const MAX_NEW_CATEGORIES = 2;
```

- [ ] **Step 4: Rewrite the sort**

Replace `lib/sort.js` entirely:

```js
// lib/sort.js
import { TAXONOMY, OTHER_GROUP, UNAVAILABLE_GROUP } from './taxonomy.js';

/** Watch percentages below this count as unwatched. Exactly this value counts as watched. */
export const WATCHED_THRESHOLD = 10;

export function effectiveProgress(video, overrides = []) {
  if (overrides.includes(video.id)) return 0;
  if (video.percentWatched < WATCHED_THRESHOLD) return 0;
  return video.percentWatched;
}

/** Sort videos by duration ascending. Used for regular playlists. */
export function buildDurationSortOrder(videos) {
  return [...videos].sort((a, b) => a.duration - b.duration);
}

/**
 * Order:
 *   1. In progress, by remaining watch time ascending
 *   2. Topic groups in taxonomy order, by duration ascending within each
 *   3. Other, then Unavailable
 */
export function buildSortOrder(videos, clusterResult, overrides = []) {
  if (videos.length === 0) return [];

  const available = videos.filter(v => !v.unavailable);
  const unavailable = videos
    .filter(v => v.unavailable)
    .map(v => ({ ...v, cluster: UNAVAILABLE_GROUP }));

  const inProgress = available
    .filter(v => effectiveProgress(v, overrides) > 0)
    .sort((a, b) => {
      const remainingA = a.duration * (1 - effectiveProgress(a, overrides) / 100);
      const remainingB = b.duration * (1 - effectiveProgress(b, overrides) / 100);
      return remainingA - remainingB;
    })
    .map(v => ({ ...v, cluster: null }));

  const unwatched = available.filter(v => effectiveProgress(v, overrides) === 0);

  const clusterOf = new Map();
  for (const cluster of clusterResult.clusters || []) {
    for (const videoId of cluster.videoIds) clusterOf.set(videoId, cluster.name);
  }

  const groups = new Map();
  for (const video of unwatched) {
    const name = clusterOf.get(video.id) || OTHER_GROUP;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ ...video, cluster: name });
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.duration - b.duration);
  }

  // Taxonomy order first, then any model-invented names, then Other.
  const invented = [...groups.keys()]
    .filter(name => !TAXONOMY.includes(name) && name !== OTHER_GROUP)
    .sort();
  const ordered = [...TAXONOMY, ...invented, OTHER_GROUP];

  const grouped = [];
  for (const name of ordered) {
    if (groups.has(name)) grouped.push(...groups.get(name));
  }

  return [...inProgress, ...grouped, ...unavailable];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/sort.test.js`
Expected: PASS, 16 tests

- [ ] **Step 6: Add taxonomy.js to the Firefox bundle**

In `build.sh`, find the Firefox bundle line:

```bash
cat lib/sort.js lib/claude-api.js background/service-worker.js \
```

Change it to put taxonomy first (declaration order matters in a concatenated bundle):

```bash
cat lib/taxonomy.js lib/sort.js lib/claude-api.js background/service-worker.js \
```

Also add `lib/taxonomy.js` to the Chrome copy block, after the `cp lib/sort.js` line:

```bash
cp lib/taxonomy.js dist/chrome/lib/
```

- [ ] **Step 7: Verify the build still works**

Run: `./build.sh && node --check dist/firefox/background/background.bundle.js`
Expected: no output, exit 0

- [ ] **Step 8: Commit**

```bash
git add lib/taxonomy.js lib/sort.js tests/sort.test.js build.sh
git commit -m "feat(sort): add watched threshold, overrides, ghosts and fixed taxonomy"
```

---

### Task 8: Classification against the fixed taxonomy

Renames `lib/claude-api.js` to `lib/classify.js` and rewrites the prompt to assign into the taxonomy using the new metadata.

**Files:**
- Create: `lib/classify.js`
- Delete: `lib/claude-api.js`
- Create: `tests/classify.test.js`
- Delete: `tests/claude-api.test.js`
- Modify: `build.sh`

**Interfaces:**
- Consumes: `TAXONOMY`, `MAX_NEW_CATEGORIES` from Task 7
- Produces:
  - `buildPrompt(videos: Video[]) → string`
  - `parseClusters(text: string) → {clusters: [{name, videoIds}]}`
  - `categorizeVideos(apiKey: string, videos: Video[]) → Promise<{clusters}>`

- [ ] **Step 1: Write the failing test**

Create `tests/classify.test.js`:

```js
// tests/classify.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseClusters } from '../lib/classify.js';
import { TAXONOMY } from '../lib/taxonomy.js';

function video(overrides = {}) {
  return {
    id: 'v1', title: 'A Title', channel: 'A Channel',
    duration: 600, category: 'Science & Technology',
    description: 'A description.', unavailable: false,
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('lists every taxonomy category', () => {
    const prompt = buildPrompt([video()]);
    for (const name of TAXONOMY) assert.ok(prompt.includes(name), `missing ${name}`);
  });

  it('includes id, title, channel and category for each video', () => {
    const prompt = buildPrompt([video({ id: 'abc', title: 'Sushi', channel: 'Atlas Obscura' })]);
    assert.ok(prompt.includes('abc'));
    assert.ok(prompt.includes('Sushi'));
    assert.ok(prompt.includes('Atlas Obscura'));
    assert.ok(prompt.includes('Science & Technology'));
  });

  it('omits the category field when enrichment failed', () => {
    const prompt = buildPrompt([video({ category: null })]);
    assert.ok(!prompt.includes('ytCategory: "null"'));
  });

  it('escapes double quotes in titles', () => {
    const prompt = buildPrompt([video({ title: 'He said "hello"' })]);
    assert.ok(prompt.includes('\\"hello\\"'));
  });

  it('excludes unavailable videos, which have nothing to classify', () => {
    const prompt = buildPrompt([video({ id: 'ok' }), video({ id: 'ghost', unavailable: true })]);
    assert.ok(prompt.includes('ok'));
    assert.ok(!prompt.includes('ghost'));
  });
});

describe('parseClusters', () => {
  it('parses bare JSON', () => {
    const result = parseClusters('{"clusters":[{"name":"Music","videoIds":["a"]}]}');
    assert.equal(result.clusters[0].name, 'Music');
  });

  it('parses JSON inside a fenced code block', () => {
    const result = parseClusters('```json\n{"clusters":[{"name":"Music","videoIds":["a"]}]}\n```');
    assert.equal(result.clusters[0].name, 'Music');
  });

  it('parses a fenced block with no language tag', () => {
    const result = parseClusters('```\n{"clusters":[]}\n```');
    assert.deepEqual(result.clusters, []);
  });

  it('throws a useful error on malformed JSON', () => {
    assert.throws(() => parseClusters('not json at all'), /Failed to parse cluster JSON/);
  });

  it('throws when the clusters array is missing', () => {
    assert.throws(() => parseClusters('{"groups":[]}'), /Missing "clusters" array/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/classify.test.js`
Expected: FAIL — `Cannot find module '../lib/classify.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/classify.js`:

```js
// lib/classify.js
import { TAXONOMY, MAX_NEW_CATEGORIES } from './taxonomy.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export function buildPrompt(videos) {
  const escape = (value) => String(value).replace(/"/g, '\\"');

  const list = videos
    .filter(v => !v.unavailable)
    .map(v => {
      const fields = [
        `id: "${escape(v.id)}"`,
        `title: "${escape(v.title)}"`,
        `channel: "${escape(v.channel)}"`,
      ];
      if (v.category) fields.push(`ytCategory: "${escape(v.category)}"`);
      return `- ${fields.join(', ')}`;
    })
    .join('\n');

  return `You are organizing a YouTube Watch Later playlist. Assign each video to one category.

Prefer these categories:
${TAXONOMY.map(name => `- ${name}`).join('\n')}

Rules:
- Each video belongs to exactly one category
- Strongly prefer the categories above
- You may introduce at most ${MAX_NEW_CATEGORIES} new categories, but only when a video genuinely fits none of them
- The channel name is often a stronger signal than the title
- ytCategory is YouTube's own label. It is coarse and sometimes wrong — treat it as a hint, not an answer
- Return ONLY valid JSON, no explanation

Videos:
${list}

Return JSON in this exact format:
{"clusters":[{"name":"Category Name","videoIds":["id1","id2"]}]}`;
}

export function parseClusters(text) {
  let json = text.trim();

  const fenced = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) json = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse cluster JSON: ${json.slice(0, 100)}`);
  }

  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    throw new Error('Missing "clusters" array in response');
  }
  return parsed;
}

/** Call Claude with streaming for faster perceived performance. */
export async function categorizeVideos(apiKey, videos) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      stream: true,
      messages: [{ role: 'user', content: buildPrompt(videos) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullText += event.delta.text;
        }
      } catch {
        // Skip malformed events.
      }
    }
  }
  return parseClusters(fullText);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/classify.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Remove the old module and its tests**

```bash
git rm lib/claude-api.js tests/claude-api.test.js
```

- [ ] **Step 6: Update build.sh for the rename**

In `build.sh`, change the Chrome copy line:

```bash
cp lib/claude-api.js dist/chrome/lib/
```

to:

```bash
cp lib/classify.js dist/chrome/lib/
```

And the Firefox bundle line:

```bash
cat lib/taxonomy.js lib/sort.js lib/claude-api.js background/service-worker.js \
```

to:

```bash
cat lib/taxonomy.js lib/sort.js lib/classify.js background/service-worker.js \
```

- [ ] **Step 7: Update the background import**

In `background/service-worker.js`, change:

```js
import { categorizeVideos } from '../lib/claude-api.js';
```

to:

```js
import { categorizeVideos } from '../lib/classify.js';
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/classify.js tests/classify.test.js build.sh background/service-worker.js
git commit -m "feat(classify): assign videos into a fixed taxonomy using channel and category"
```

---

### Task 9: Background wiring — ANALYZE and RESORT

`RESORT` re-runs sorting against cached clusters when the user toggles a video's watch state, so toggling never re-calls Claude.

**Files:**
- Modify: `background/service-worker.js`
- Test: `tests/resort-contract.test.js`

**Interfaces:**
- Consumes: `categorizeVideos`, `buildSortOrder`, `buildDurationSortOrder`
- Produces: message contracts
  - `{type: 'ANALYZE', videos, playlistId}` → `{success: true, sortOrder}` or `{success: false, error}`
  - `{type: 'RESORT', overrides}` → `{success: true, sortOrder}` or `{success: false, error}`

- [ ] **Step 1: Write the characterization test**

This is a characterization test, not a red-green test: it pins down the
`buildSortOrder` behaviour that `handleResort` depends on, so that a later
change to sorting can't silently break re-sorting. It is expected to pass
immediately against Task 7's code.

Create `tests/resort-contract.test.js`:

```js
// tests/resort-contract.test.js
// Pins the sorting behaviour handleResort relies on: overrides change which
// group a video lands in, and never change cluster membership.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSortOrder } from '../lib/sort.js';

function video(overrides = {}) {
  return {
    id: 'v', setVideoId: 'S', title: 'T', channel: 'C',
    duration: 600, percentWatched: 0, category: null,
    description: null, unavailable: false,
    ...overrides,
  };
}

// RESORT must reproduce ANALYZE's grouping from cached clusters alone.
describe('resort against cached clusters', () => {
  const videos = [
    video({ id: 'a', percentWatched: 100 }),
    video({ id: 'b', percentWatched: 0 }),
  ];
  const clusters = { clusters: [{ name: 'Music', videoIds: ['a', 'b'] }] };

  it('places a fully-watched video in progress when not overridden', () => {
    const order = buildSortOrder(videos, clusters, []);
    assert.equal(order[0].id, 'a');
    assert.equal(order[0].cluster, null);
  });

  it('moves it into its cluster once overridden', () => {
    const order = buildSortOrder(videos, clusters, ['a']);
    assert.equal(order.every(v => v.cluster === 'Music'), true);
  });

  it('keeps cluster membership identical across override changes', () => {
    const before = buildSortOrder(videos, clusters, []);
    const after = buildSortOrder(videos, clusters, ['a']);
    const clusterFor = (order, id) => order.find(v => v.id === id).cluster;
    assert.equal(clusterFor(before, 'b'), clusterFor(after, 'b'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resort-contract.test.js`
Expected: PASS immediately — this test locks in behaviour from Task 7 that the handler must preserve. If it fails, Task 7 is wrong; fix that first.

- [ ] **Step 3: Rewrite the message handlers**

In `background/service-worker.js`, replace the entire `chrome.runtime.onMessage.addListener` block and the `handleAnalyze` function with:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    handleAnalyze(message.videos, message.playlistId).then(sendResponse);
    return true;
  }

  if (message.type === 'RESORT') {
    handleResort(message.overrides).then(sendResponse);
    return true;
  }

  if (message.type === 'SORT_BY_DURATION') {
    sendResponse({ success: true, sortOrder: buildDurationSortOrder(message.videos) });
    return true;
  }

  if (message.type === 'GET_SORT_STATE') {
    chrome.storage.local.get('sortState', (data) => sendResponse(data.sortState || null));
    return true;
  }
});

async function handleAnalyze(videos, playlistId) {
  try {
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (!apiKey) {
      return { success: false, error: 'No API key configured. Open settings to add your Claude API key.' };
    }

    const { unwatchedOverrides = [] } = await chrome.storage.local.get('unwatchedOverrides');

    const classifiable = videos.filter(v => !v.unavailable);
    const clusters = await categorizeVideos(apiKey, classifiable);
    const sortOrder = buildSortOrder(videos, clusters, unwatchedOverrides);

    await chrome.storage.local.set({
      cachedClusters: { playlistId, clusters, videos },
      sortState: { videos, clusters, sortOrder, timestamp: Date.now() },
    });

    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Re-sort using cached clusters. Never calls Claude — watch state does not change grouping. */
async function handleResort(overrides) {
  try {
    const { cachedClusters } = await chrome.storage.local.get('cachedClusters');
    if (!cachedClusters) {
      return { success: false, error: 'No cached analysis. Run Analyze first.' };
    }

    await chrome.storage.local.set({ unwatchedOverrides: overrides });
    const sortOrder = buildSortOrder(cachedClusters.videos, cachedClusters.clusters, overrides);
    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

- [ ] **Step 4: Verify the bundle still parses**

Run: `./build.sh && node --check dist/firefox/background/background.bundle.js`
Expected: no output, exit 0

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add background/service-worker.js tests/resort-contract.test.js
git commit -m "feat(background): add RESORT handler and cluster caching"
```

---

### Task 10: Wire the content script and delete the DOM path

Replaces `panel.js`'s scraping and reordering with the API modules, and removes `scraper.js` and `reorder.js`. The existing inline panel UI stays for now — Plan 2 replaces it with the modal.

**Files:**
- Modify: `content/panel.js`
- Modify: `content/selectors.js`
- Modify: `manifest.chrome.json`, `manifest.firefox.json`
- Modify: `build.sh`
- Delete: `content/scraper.js`, `content/reorder.js`
- Modify: `tests/selectors.test.js`

**Interfaces:**
- Consumes: `WLPlaylist.read`, `WLPlaylist.applyOrder`, `WLEnrich.enrich`, background `ANALYZE`
- Produces: a working end-to-end sort with no DOM automation

- [ ] **Step 1: Trim the selectors**

`MENU_BUTTON` and `MOVE_TO_TOP` existed only for DOM reordering. Replace `content/selectors.js`:

```js
// content/selectors.js
// YouTube DOM selectors. Only what the UI still needs — reordering no longer
// touches the DOM, so the action-menu selectors are gone.
const SELECTORS = {
  PLAYLIST_ITEMS: 'ytd-playlist-video-renderer',
  VIDEO_TITLE: '#video-title',
  VIDEO_LINK: 'a#video-title',
};
```

- [ ] **Step 2: Update the selector test**

Replace the `required` array in `tests/selectors.test.js`:

```js
    const required = [
      'PLAYLIST_ITEMS',
      'VIDEO_TITLE',
      'VIDEO_LINK',
    ];
```

- [ ] **Step 3: Run the selector test**

Run: `node --test tests/selectors.test.js`
Expected: PASS, 2 tests

- [ ] **Step 4: Replace scraping with the API read**

In `content/panel.js`, inside the `#wl-analyze-btn` click handler, replace:

```js
        const videos = await WLScraper.scrapeAll();
```

with:

```js
        const playlistId = new URL(location.href).searchParams.get('list');
        const videos = await WLPlaylist.read(playlistId);
        if (this._analyseCancelled) return;

        this.$('#wl-analyze-status').textContent = 'Fetching video details...';
        await WLEnrich.enrich(videos);
```

- [ ] **Step 5: Pass the playlist id to the background**

In the same handler, replace:

```js
          result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos });
```

with:

```js
          const playlistIdForAnalyze = new URL(location.href).searchParams.get('list');
          result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos, playlistId: playlistIdForAnalyze });
```

- [ ] **Step 6: Replace DOM reordering with the batched call**

In the `#wl-apply-btn` click handler, replace the whole `WLReorder.reorder(...)` call and its result handling with:

```js
      const playlistId = new URL(location.href).searchParams.get('list');
      const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

      this.$('#wl-sort-count').textContent = `Applying ${orderedSetVideoIds.length} moves...`;
      this.$('#wl-sort-progress').style.width = '50%';

      let result;
      try {
        result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
      } catch (err) {
        this.showError(err.message);
        return;
      }

      this.$('#wl-sort-progress').style.width = '100%';

      if (result.applied) {
        this.showIdleWithMessage(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s.`);
      } else {
        this.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
      }
```

- [ ] **Step 7: Remove the cancel-sort handler**

A batched call cannot be cancelled mid-flight. In `content/panel.js`, delete:

```js
    // Cancel sort
    this.$('#wl-sort-cancel-btn').addEventListener('click', () => {
      WLReorder.cancel();
    });
```

And remove the cancel button from the sorting state's `innerHTML`:

```html
        <button class="wl-yt-btn wl-cancel-inline" id="wl-sort-cancel-btn">Cancel</button>
```

- [ ] **Step 7b: Invalidate cached InnerTube config on SPA navigation**

`WLInnerTube` memoizes client config, and the content script survives YouTube's
in-app navigation. Switching Google accounts changes `DELEGATED_SESSION_ID`, so a
stale cache would send edits with the wrong session.

In `content/panel.js`, inside the `pageObserver` callback where a URL change is
detected, immediately after `WLPanel.lastVideoHash = null;` add:

```js
    WLInnerTube.resetConfig();
```

- [ ] **Step 8: Delete the DOM automation modules**

```bash
git rm content/scraper.js content/reorder.js
```

- [ ] **Step 9: Update both manifests**

In `manifest.chrome.json` and `manifest.firefox.json`, replace the content script `js` array with:

```json
      "js": ["content/selectors.js", "content/innertube.js", "content/playlist.js", "content/enrich.js", "content/panel.js"],
```

- [ ] **Step 10: Update build.sh's shared file list**

In `build.sh`, replace these lines in the `SHARED` array:

```bash
  content/scraper.js
  content/reorder.js
```

with:

```bash
  content/innertube.js
  content/playlist.js
  content/enrich.js
```

- [ ] **Step 11: Verify the build**

Run:

```bash
./build.sh && \
  node --check dist/firefox/background/background.bundle.js && \
  ls dist/firefox/content/
```

Expected: exit 0, and `dist/firefox/content/` lists `enrich.js  innertube.js  panel.js  playlist.js  selectors.js` with no `scraper.js` or `reorder.js`.

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 13: Manual verification in Firefox**

Load `dist/firefox/` via `about:debugging#/runtime/this-firefox`, then on the throwaway playlist:

1. Click **Analyze & sort** — the preview populates
2. Confirm groups use taxonomy names
3. Click **Apply Sort** — completes in roughly 1–2 seconds
4. Confirm the playlist order matches the preview
5. Break the API key in settings deliberately, re-run, and confirm the error names the failure

- [ ] **Step 14: Commit**

```bash
git add content/panel.js content/selectors.js tests/selectors.test.js manifest.chrome.json manifest.firefox.json build.sh
git commit -m "feat: replace DOM scraping and reordering with the InnerTube path"
```

---

## Done when

- `npm test` passes
- `dist/firefox/content/` contains no `scraper.js` or `reorder.js`
- A full sort of the real Watch Later applies in seconds rather than minutes
- Videos under 10% watched no longer sort to the top
