// tests/headings.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

// Load the real SELECTORS — headings.js reads SELECTORS.PLAYLIST_ITEMS/VIDEO_LINK
// as a bare global (set by content/selectors.js in the real content-script context).
const SELECTORS = loadGlobal('content/selectors.js', 'SELECTORS', {});

const load = () => loadGlobal('content/headings.js', 'WLHeadings', {
  document: undefined,
  MutationObserver: class { observe() {} disconnect() {} },
});

function video(overrides = {}) {
  return { id: 'v', title: 'T', cluster: 'Music', ...overrides };
}

describe('WLHeadings.boundariesFrom', () => {
  it('returns nothing for an empty order', () => {
    assert.deepEqual([...load().boundariesFrom([])], []);
  });

  it('marks the first video of each group', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    // Objects from boundariesFrom live in the vm sandbox's realm, so a bare
    // deepEqual against main-realm object literals fails on prototype identity
    // even when every field matches (see other boundariesFrom tests below for
    // the same pattern). Map to plain main-realm objects first.
    assert.deepEqual([...boundaries].map(b => ({ ...b })), [
      { videoId: 'a', name: 'Music', count: 2 },
      { videoId: 'c', name: 'Tech & AI', count: 1 },
    ]);
  });

  it('counts the videos in each group', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(boundaries[0].count, 3);
  });

  it('labels the null cluster as in progress', () => {
    const headings = load();
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: null })]);
    assert.equal(boundaries[0].name, headings.IN_PROGRESS_LABEL);
  });

  it('emits a fresh boundary when a group name recurs non-consecutively', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(boundaries.length, 3);
    assert.equal(boundaries[2].videoId, 'c');
  });

  it('emits one boundary per video when every cluster differs', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
    ]);
    assert.equal(boundaries.length, 2);
  });

  it('returns an empty array for duration-mode videos (no cluster property at all)', () => {
    // buildDurationSortOrder (lib/sort.js) returns videos with no `cluster` key
    // at all — not even `cluster: undefined`. Regression: this used to produce
    // a boundary named the string "undefined", which rendered a nameless
    // heading bar and, because _headingFor()'s lookup could never match it,
    // duplicated without bound on every observer-driven inject() pass.
    const boundaries = load().boundariesFrom([
      { id: 'a', title: 'T', duration: 60 },
      { id: 'b', title: 'T', duration: 90 },
    ]);
    assert.deepEqual([...boundaries], []);
  });
});

describe('WLHeadings.IN_PROGRESS_LABEL constant drift', () => {
  it('matches WLModal.IN_PROGRESS_LABEL byte-for-byte', () => {
    // Critical 1 was caused by exactly this seam: the two modules each define
    // their own copy of this label independently, and headings.js's copy of
    // the *logic* (not just the string) fell out of sync with modal.js's. This
    // guards the constant so at least that half of the seam can't drift silently.
    const WLHeadings = load();
    const WLModal = loadGlobal('content/modal.js', 'WLModal', { document: undefined });
    assert.equal(WLHeadings.IN_PROGRESS_LABEL, WLModal.IN_PROGRESS_LABEL);
  });
});

describe('WLHeadings.hashIds', () => {
  it('is stable for the same set of videos', () => {
    const headings = load();
    const videos = [video({ id: 'a' }), video({ id: 'b' })];
    assert.equal(headings.hashIds(videos), headings.hashIds(videos));
  });

  it('ignores ordering, so re-sorting does not invalidate headings', () => {
    const headings = load();
    const forward = [video({ id: 'a' }), video({ id: 'b' })];
    const reverse = [video({ id: 'b' }), video({ id: 'a' })];
    assert.equal(headings.hashIds(forward), headings.hashIds(reverse));
  });

  it('changes when a video is added', () => {
    const headings = load();
    const before = headings.hashIds([video({ id: 'a' })]);
    const after = headings.hashIds([video({ id: 'a' }), video({ id: 'b' })]);
    assert.notEqual(before, after);
  });

  it('changes when a video is removed', () => {
    const headings = load();
    const before = headings.hashIds([video({ id: 'a' }), video({ id: 'b' })]);
    const after = headings.hashIds([video({ id: 'a' })]);
    assert.notEqual(before, after);
  });
});

/**
 * Minimal fake `ytd-playlist-video-renderer` list, faithful enough to exercise
 * inject()/clear()/watch() without a real DOM: a `container` node holding
 * "item" elements (matched by SELECTORS.PLAYLIST_ITEMS) each with a video-link
 * child (matched by SELECTORS.VIDEO_LINK), plus insertBefore()/remove() that
 * keep previousElementSibling links honest — that's the one relationship
 * inject()'s idempotency check depends on.
 */
function fakePlaylist(videoIds) {
  const container = { nodeType: 1, children: [] };

  const makeItem = (id) => ({
    nodeType: 1,
    _isItem: true,
    parentNode: container,
    previousElementSibling: null,
    // Delimited with non-letter characters only, so a short test id like 'a' or
    // 'c' can never accidentally substring-match inside another item's href
    // (a literal "/watch?v=" would — "watch" itself contains both letters).
    querySelector: (sel) => (sel === SELECTORS.VIDEO_LINK
      ? { getAttribute: (a) => (a === 'href' ? `#${id}#` : null) }
      : null),
    getAttribute: () => null,
    hasAttribute: () => false,
  });

  const relink = () => {
    container.children.forEach((el, i) => {
      el.previousElementSibling = i > 0 ? container.children[i - 1] : null;
    });
  };

  container.insertBefore = (node, ref) => {
    // Real DOM insertBefore() moves a node already in the tree rather than
    // duplicating it — remove any prior placement first so this fixture
    // matches that, which inject()'s drift-repair (moving an existing
    // heading back into place) depends on.
    const existingIndex = container.children.indexOf(node);
    if (existingIndex !== -1) container.children.splice(existingIndex, 1);

    const i = container.children.indexOf(ref);
    container.children.splice(i === -1 ? container.children.length : i, 0, node);
    node.parentNode = container;
    relink();
  };

  container.children = videoIds.map(makeItem);
  relink();

  const document = {
    createElement: (tag) => {
      const el = {
        tagName: tag, nodeType: 1, className: '', _attrs: {},
        children: [],
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        hasAttribute(k) { return k in this._attrs; },
        appendChild(child) { this.children.push(child); },
        remove() {
          const i = container.children.indexOf(el);
          if (i !== -1) container.children.splice(i, 1);
          relink();
        },
      };
      return el;
    },
    querySelectorAll: (sel) => {
      if (sel === SELECTORS.PLAYLIST_ITEMS) return container.children.filter(el => el._isItem);
      if (sel === '[data-wl-heading]') return container.children.filter(el => el.hasAttribute?.('data-wl-heading'));
      return [];
    },
    querySelector: (sel) => (sel === SELECTORS.PLAYLIST_ITEMS
      ? container.children.find(el => el._isItem) ?? null
      : null),
    // watch() observes document.body directly (not a resolved playlist
    // container) so it can attach before the playlist has rendered at all.
    body: {},
  };

  return {
    document,
    container,
    /** Simulate YouTube lazily appending another item as the user scrolls. */
    addItem(id) { container.insertBefore(makeItem(id), null); },
  };
}

describe('WLHeadings.inject', () => {
  it('places one heading per group, before the group\'s first item', () => {
    const { document, container } = fakePlaylist(['a', 'b', 'c']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    const boundaries = headings.boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    const placed = headings.inject(boundaries);

    assert.equal(placed, 2);
    const tags = container.children.map(el => el.tagName ?? el._isItem);
    assert.deepEqual(tags, ['h2', true, true, 'h2', true]);
  });

  it('is idempotent: running twice produces one heading per group', () => {
    const { document, container } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]);

    headings.inject(boundaries);
    headings.inject(boundaries);

    const headingEls = container.children.filter(el => el.tagName === 'h2');
    assert.equal(headingEls.length, 1);
  });

  it('skips a group whose first video is not yet in the DOM (not loaded yet)', () => {
    const { document } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }), // 'b' has not lazily loaded yet
    ]);

    assert.equal(headings.inject(boundaries), 1);
  });

  it('labels the heading text with the group name and video count', () => {
    const { document, container } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    headings.inject([{ videoId: 'a', name: 'Music', count: 3 }]);

    const heading = container.children.find(el => el.tagName === 'h2');
    assert.equal(heading.children[0].textContent, 'Music');
    assert.equal(heading.children[1].textContent, '3 videos');
  });
});

describe('WLHeadings.clear', () => {
  it('removes every injected heading and leaves items untouched', () => {
    const { document, container } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    headings.inject(headings.boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
    ]));

    headings.clear();

    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 0);
    assert.equal(container.children.filter(el => el._isItem).length, 2);
  });
});

describe('WLHeadings.watch', () => {
  /** setTimeout/clearTimeout stand-in that never fires on its own — the test
   *  decides when the debounced callback runs via flush(), so nothing here
   *  depends on real wall-clock time. */
  function fakeClock() {
    let pending = null;
    let nextId = 1;
    return {
      setTimeout(fn) { const id = nextId++; pending = { id, fn }; return id; },
      clearTimeout(id) { if (pending?.id === id) pending = null; },
      flush() { const p = pending; pending = null; p?.fn(); },
      get scheduled() { return pending !== null; },
    };
  }

  it('ignores mutations that are only its own injected headings, so it cannot loop forever', () => {
    const { document, container } = fakePlaylist(['a']);
    const clock = fakeClock();
    let observerCallback;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    const injectedHeading = container.children.find(el => el.tagName === 'h2');

    // Simulate the observer seeing the mutation that inject() itself just caused.
    observerCallback([{ addedNodes: [injectedHeading], removedNodes: [] }]);

    assert.equal(clock.scheduled, false);
  });

  it('does not ignore a removal-only mutation batch (regression: .every() on an empty addedNodes list is vacuously true)', () => {
    const { document } = fakePlaylist(['a']);
    const clock = fakeClock();
    let observerCallback;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));

    // YouTube removed an item (delisted video, virtualized re-render) — no
    // nodes were added, only removed.
    observerCallback([{ addedNodes: [], removedNodes: [{ nodeType: 1 }] }]);

    assert.equal(clock.scheduled, true, 'a removal must still schedule a re-injection, not be treated as our own no-op');
  });

  it('debounces a real YouTube append and re-injects once flushed', () => {
    const { document, container, addItem } = fakePlaylist(['a']);
    const clock = fakeClock();
    let observerCallback;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
    ]));
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 1, 'b has not loaded yet');

    const newItem = { nodeType: 1, _isItem: true };
    addItem('b');
    observerCallback([{ addedNodes: [newItem], removedNodes: [] }]);
    assert.equal(clock.scheduled, true, 'a real append must schedule a debounced re-injection');

    clock.flush();
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 2);
  });

  it('attaches even when no playlist item exists yet, and injects once items appear', () => {
    // No items at all yet — this is the state of the page on first load,
    // before YouTube has rendered a single ytd-playlist-video-renderer.
    const { document, container, addItem } = fakePlaylist([]);
    const clock = fakeClock();
    let observerCallback;
    let observeCalls = 0;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() { observeCalls++; }
      disconnect() {}
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));

    assert.equal(observeCalls, 1, 'the observer must attach even though the playlist has not rendered yet');
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 0, 'nothing to inject before yet');

    // The playlist renders its first item.
    addItem('a');
    observerCallback([{ addedNodes: [{ nodeType: 1 }], removedNodes: [] }]);
    clock.flush();

    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 1);
  });

  it('clear() cancels a pending debounce, so a queued re-injection cannot undo it', () => {
    const { document, container } = fakePlaylist(['a']);
    const clock = fakeClock();
    let observerCallback;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 1);

    // A mutation lands and schedules a debounced re-injection...
    observerCallback([{ addedNodes: [{ nodeType: 1 }], removedNodes: [] }]);
    assert.equal(clock.scheduled, true, 'setup: a debounce should be pending');

    // ...but the caller clears headings before that debounce fires.
    headings.clear();
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 0);

    clock.flush();

    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 0,
      'a queued re-injection must not resurrect headings after clear()');
  });

  it('stop() disconnects the observer and cancels a pending debounce', () => {
    const { document } = fakePlaylist(['a']);
    const clock = fakeClock();
    let disconnected = false;
    let observerCallback;
    const FakeObserver = class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() { disconnected = true; }
    };
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: FakeObserver,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });

    headings.watch(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    observerCallback([{ addedNodes: [{ nodeType: 1 }], removedNodes: [] }]); // a real append schedules a debounce
    assert.equal(clock.scheduled, true, 'setup: a debounce should be pending before stop()');

    headings.stop();

    assert.equal(disconnected, true);
    assert.equal(clock.scheduled, false, 'stop() must cancel the pending debounce, not just disconnect');
  });
});

describe('WLHeadings.inject drift repair', () => {
  it('repositions a drifted heading instead of duplicating it when a stray node lands between it and its anchor', () => {
    const { document, container } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]);

    headings.inject(boundaries);
    const itemA = container.children.find(el => el._isItem);

    // Something (YouTube re-render, another script) inserts a node between
    // the heading and its anchor item.
    const stray = { nodeType: 1, tagName: 'div' };
    container.insertBefore(stray, itemA);
    assert.deepEqual(container.children.map(el => el.tagName), ['h2', 'div', undefined]);

    const placed = headings.inject(boundaries);

    assert.equal(placed, 1);
    assert.equal(container.children.filter(el => el.tagName === 'h2').length, 1, 'must not duplicate the heading');
    assert.deepEqual(container.children.map(el => el.tagName), ['div', 'h2', undefined]);
  });
});
