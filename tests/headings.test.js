// tests/headings.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';
import { buildSortOrder } from '../lib/sort.js';

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
      { videoId: 'a', name: 'Music', count: 2, remaining: 0 },
      { videoId: 'c', name: 'Tech & AI', count: 1, remaining: 0 },
    ]);
  });

  it('totals the unwatched seconds per group: whole durations, minus the watched part of started videos', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music', duration: 600 }),
      video({ id: 'b', cluster: 'Music', duration: 1000, percentWatched: 75, inProgress: true }),
      video({ id: 'c', cluster: 'Tech & AI', duration: 300, percentWatched: 50, inProgress: false }),
    ]);
    assert.deepEqual([...boundaries].map(b => b.remaining), [850, 300],
      'an overridden video (inProgress false) counts in full whatever its percentage');
  });

  it('treats a null cluster as started even without the inProgress flag (legacy sortState)', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: null, duration: 1000, percentWatched: 90 }),
      video({ id: 'b', cluster: null, duration: 200, percentWatched: 50 }),
    ]);
    assert.equal(boundaries[0].remaining, 200);
  });

  it('ignores videos with no numeric duration in the total but still counts them', () => {
    const boundaries = load().boundariesFrom([
      video({ id: 'a', cluster: 'Music', duration: 120 }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Music', duration: 'n/a' }),
    ]);
    assert.equal(boundaries[0].count, 3);
    assert.equal(boundaries[0].remaining, 120);
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

describe('WLHeadings.formatTotal', () => {
  const cases = [
    [0, '0m'],
    [59, '1m'],
    [60, '1m'],
    [3600, '1h'],
    [3661, '1h 1m'],
    [86400, '24h'],
    [90061, '25h 1m'],
  ];
  for (const [seconds, expected] of cases) {
    it(`formats ${seconds}s as "${expected}"`, () => {
      assert.equal(load().formatTotal(seconds), expected);
    });
  }
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
 * child (matched by SELECTORS.VIDEO_LINK).
 *
 * Headings now live INSIDE their anchor item, not beside it, so this models a
 * real tree: appendChild() detaches from the previous parent first (the real
 * DOM moves a node rather than copying it, which inject()'s drift repair
 * depends on), remove() unhooks from whatever parent currently holds the node,
 * and querySelectorAll walks the whole tree rather than just the top level.
 *
 * `previousElementSibling` is still maintained for the items themselves. Nothing
 * in headings.js reads it any more, but a stray-sibling test asserts against it
 * to prove headings stay out of the container's child list.
 */
function fakePlaylist(videoIds) {
  const container = { nodeType: 1, children: [] };

  const relink = () => {
    container.children.forEach((el, i) => {
      el.previousElementSibling = i > 0 ? container.children[i - 1] : null;
    });
  };

  const detach = (node) => {
    const parent = node.parentNode;
    if (!parent) return;
    const i = parent.children.indexOf(node);
    if (i !== -1) parent.children.splice(i, 1);
    node.parentNode = null;
    if (parent === container) relink();
  };

  const classListFor = (el) => ({
    add(name) { if (!el._classes.includes(name)) el._classes.push(name); },
    remove(name) {
      const i = el._classes.indexOf(name);
      if (i !== -1) el._classes.splice(i, 1);
    },
    contains(name) { return el._classes.includes(name); },
  });

  const attach = (parent, child) => {
    detach(child);
    parent.children.push(child);
    child.parentNode = parent;
  };

  const makeItem = (id) => {
    const el = {
      nodeType: 1,
      _isItem: true,
      _classes: [],
      parentNode: container,
      previousElementSibling: null,
      children: [],
      // Delimited with non-letter characters only, so a short test id like 'a' or
      // 'c' can never accidentally substring-match inside another item's href
      // (a literal "/watch?v=" would — "watch" itself contains both letters).
      querySelector: (sel) => (sel === SELECTORS.VIDEO_LINK
        ? { getAttribute: (a) => (a === 'href' ? `#${id}#` : null) }
        : null),
      getAttribute: () => null,
      hasAttribute: () => false,
      appendChild(child) { attach(el, child); },
    };
    el.classList = classListFor(el);
    return el;
  };

  container.insertBefore = (node, ref) => {
    detach(node);
    const i = container.children.indexOf(ref);
    container.children.splice(i === -1 ? container.children.length : i, 0, node);
    node.parentNode = container;
    relink();
  };

  container.children = videoIds.map(makeItem);
  relink();

  /** Every element in the tree, at any depth. */
  const walk = (node, out = []) => {
    for (const child of node.children || []) {
      out.push(child);
      walk(child, out);
    }
    return out;
  };

  const document = {
    createElement: (tag) => {
      const el = {
        tagName: tag, nodeType: 1, className: '', _attrs: {}, _classes: [],
        parentNode: null,
        children: [],
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        hasAttribute(k) { return k in this._attrs; },
        appendChild(child) { attach(el, child); },
        remove() { detach(el); },
      };
      el.classList = classListFor(el);
      return el;
    },
    querySelectorAll: (sel) => {
      if (sel === SELECTORS.PLAYLIST_ITEMS) return container.children.filter(el => el._isItem);
      if (sel === '[data-wl-heading]') return walk(container).filter(el => el.hasAttribute?.('data-wl-heading'));
      if (sel === '.wl-group-anchor') return walk(container).filter(el => el.classList?.contains('wl-group-anchor'));
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
    /** Headings anywhere in the tree. */
    allHeadings: () => walk(container).filter(el => el.tagName === 'h2'),
    /** The heading held by the item at `index`, or null. */
    headingIn: (index) =>
      container.children[index]?.children.find(el => el.tagName === 'h2') ?? null,
    /**
     * Guard for the bug this whole design exists to avoid: a non-item child of
     * the sortable container makes YouTube's handleDragMove_ index into a rect
     * cache that has no entry there, throwing on every mousemove.
     */
    assertChildListIsPureItems: () => {
      assert.ok(
        container.children.every(el => el._isItem),
        'the sortable container must hold only playlist items — a foreign sibling breaks drag-and-drop',
      );
    },
  };
}

describe('WLHeadings.inject', () => {
  it('places each group\'s heading inside that group\'s first item, never beside it', () => {
    const { document, container, headingIn, assertChildListIsPureItems } = fakePlaylist(['a', 'b', 'c']);
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
    assertChildListIsPureItems();
    assert.equal(headingIn(0)?.getAttribute('data-wl-heading'), 'Music');
    assert.equal(headingIn(1), null, 'a video mid-group carries no heading');
    assert.equal(headingIn(2)?.getAttribute('data-wl-heading'), 'Tech & AI');
    assert.deepEqual(
      container.children.map(el => el.classList.contains('wl-group-anchor')),
      [true, false, true],
      'only group-starting items get the class that opens the margin gap',
    );
  });

  it('is idempotent: running twice produces one heading per group', () => {
    const { document, allHeadings, assertChildListIsPureItems } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]);

    headings.inject(boundaries);
    headings.inject(boundaries);

    assert.equal(allHeadings().length, 1);
    assertChildListIsPureItems();
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
    const { document, headingIn } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    headings.inject([{ videoId: 'a', name: 'Music', count: 3 }]);

    const heading = headingIn(0);
    assert.equal(heading.children[0].textContent, 'Music');
    assert.equal(heading.children[1].textContent, '3 videos');
    assert.equal(heading.children.length, 2, 'a group map stored without remaining gets no total');
  });

  it('draws the in-progress heading with a play icon and no typed glyph in its label', () => {
    const { document, headingIn } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    headings.inject([{ videoId: 'a', name: headings.IN_PROGRESS_LABEL, count: 1 }]);

    const heading = headingIn(0);
    assert.equal(heading.className, 'wl-playlist-heading wl-in-progress');
    assert.match(heading.innerHTML, /^<svg class="wl-play-icon"/);
    assert.equal(heading.children[0].textContent, 'In progress');
    assert.equal(heading.getAttribute('data-wl-heading'), 'In progress');
  });

  it('appends the unwatched total after the count', () => {
    const { document, headingIn } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    headings.inject([{ videoId: 'a', name: 'Music', count: 3, remaining: 11520 }]);

    const heading = headingIn(0);
    assert.deepEqual(heading.children.map(el => el.className), ['', 'wl-heading-count', 'wl-heading-total']);
    assert.equal(heading.children[2].textContent, '3h 12m');
  });

  it('omits the total when nothing is left to watch', () => {
    const { document, headingIn } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });

    headings.inject([{ videoId: 'a', name: 'Music', count: 1, remaining: 0 }]);

    assert.equal(headingIn(0).children.length, 2);
  });
});

describe('WLHeadings.clear', () => {
  it('removes every injected heading and leaves items untouched', () => {
    const { document, container, allHeadings } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    headings.inject(headings.boundariesFrom([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
    ]));

    headings.clear();

    assert.equal(allHeadings().length, 0);
    assert.equal(container.children.filter(el => el._isItem).length, 2);
  });

  it('strips the anchor class, so no item is left holding an empty margin gap', () => {
    const { document, container } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    headings.inject(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    assert.equal(container.children[0].classList.contains('wl-group-anchor'), true, 'setup');

    headings.clear();

    assert.deepEqual(
      container.children.map(el => el.classList.contains('wl-group-anchor')),
      [false, false],
    );
  });
});

describe('WLHeadings.present', () => {
  // Drives whether the modal offers its "Hide group headings" control, so it
  // has to track the real lifecycle rather than any stored intent.
  const loadWith = (document) => loadGlobal('content/headings.js', 'WLHeadings', {
    document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
  });

  it('is false before anything is injected', () => {
    const { document } = fakePlaylist(['a', 'b']);
    assert.equal(loadWith(document).present(), false);
  });

  it('is true once headings are injected', () => {
    const { document } = fakePlaylist(['a', 'b']);
    const headings = loadWith(document);
    headings.inject(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    assert.equal(headings.present(), true);
  });

  it('is false again after clear()', () => {
    const { document } = fakePlaylist(['a', 'b']);
    const headings = loadWith(document);
    headings.inject(headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]));
    headings.clear();
    assert.equal(headings.present(), false);
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
    const { document, headingIn } = fakePlaylist(['a']);
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
    const injectedHeading = headingIn(0);
    assert.ok(injectedHeading, 'setup: a heading must have been injected to feed back to the observer');

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
    const { document, container, addItem, allHeadings } = fakePlaylist(['a']);
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
    assert.equal(allHeadings().length, 1, 'b has not loaded yet');

    const newItem = { nodeType: 1, _isItem: true };
    addItem('b');
    observerCallback([{ addedNodes: [newItem], removedNodes: [] }]);
    assert.equal(clock.scheduled, true, 'a real append must schedule a debounced re-injection');

    clock.flush();
    assert.equal(allHeadings().length, 2);
  });

  it('attaches even when no playlist item exists yet, and injects once items appear', () => {
    // No items at all yet — this is the state of the page on first load,
    // before YouTube has rendered a single ytd-playlist-video-renderer.
    const { document, container, addItem, allHeadings } = fakePlaylist([]);
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
    assert.equal(allHeadings().length, 0, 'nothing to inject before yet');

    // The playlist renders its first item.
    addItem('a');
    observerCallback([{ addedNodes: [{ nodeType: 1 }], removedNodes: [] }]);
    clock.flush();

    assert.equal(allHeadings().length, 1);
  });

  it('clear() cancels a pending debounce, so a queued re-injection cannot undo it', () => {
    const { document, container, allHeadings } = fakePlaylist(['a']);
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
    assert.equal(allHeadings().length, 1);

    // A mutation lands and schedules a debounced re-injection...
    observerCallback([{ addedNodes: [{ nodeType: 1 }], removedNodes: [] }]);
    assert.equal(clock.scheduled, true, 'setup: a debounce should be pending');

    // ...but the caller clears headings before that debounce fires.
    headings.clear();
    assert.equal(allHeadings().length, 0);

    clock.flush();

    assert.equal(allHeadings().length, 0,
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
  it('moves a heading that ended up in the wrong item instead of duplicating it', () => {
    // Polymer re-renders the list while dragging and reorders items under us, so
    // a heading can end up held by an item that no longer starts its group.
    const { document, container, allHeadings, headingIn } = fakePlaylist(['a', 'b']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]);

    headings.inject(boundaries);
    const heading = headingIn(0);

    // Something moves the heading into the wrong item.
    container.children[1].appendChild(heading);
    assert.equal(headingIn(0), null, 'setup: the heading has drifted');
    assert.equal(headingIn(1), heading, 'setup: it now hangs off the wrong item');

    const placed = headings.inject(boundaries);

    assert.equal(placed, 1);
    assert.equal(allHeadings().length, 1, 'must not duplicate the heading');
    assert.equal(headingIn(0), heading, 'the same node must be moved back, not replaced');
    assert.equal(headingIn(1), null);
  });

  it('keeps headings out of the sortable container even when a stray sibling appears', () => {
    // Regression for the drag-and-drop break: YouTube's handleDragMove_ caches
    // one rect per child of the container and indexes it by child position, so
    // any non-item child made it read undefined and throw on every mousemove.
    const { document, container, assertChildListIsPureItems } = fakePlaylist(['a']);
    const headings = loadGlobal('content/headings.js', 'WLHeadings', {
      document, SELECTORS, MutationObserver: class { observe() {} disconnect() {} },
    });
    const boundaries = headings.boundariesFrom([video({ id: 'a', cluster: 'Music' })]);

    headings.inject(boundaries);
    assertChildListIsPureItems();

    // A foreign node lands in the container. Re-injecting must not respond by
    // putting a heading beside the items too.
    container.insertBefore({ nodeType: 1, tagName: 'div', children: [] }, container.children[0]);
    headings.inject(boundaries);

    assert.equal(
      container.children.filter(el => el.tagName === 'h2').length, 0,
      'no heading may be a direct child of the sortable container',
    );
  });
});

describe('WLHeadings.boundariesFrom against real sort output', () => {
  // With inProgress 'within' the sorter emits no null cluster, so no In Progress
  // heading must appear and started videos count toward their group.
  const clusters = { clusters: [{ name: 'Music', videoIds: ['a', 'b'] }] };
  const videos = [
    { id: 'a', title: 'A', duration: 600, percentWatched: 50, unavailable: false },
    { id: 'b', title: 'B', duration: 600, percentWatched: 0, unavailable: false },
  ];

  it('emits an In Progress heading only for the top option', () => {
    const headings = load();
    const top = headings.boundariesFrom(buildSortOrder(videos, clusters, [], undefined, { inProgress: 'top' }));
    assert.deepEqual([...top].map(b => ({ ...b })), [
      { videoId: 'a', name: headings.IN_PROGRESS_LABEL, count: 1, remaining: 300 },
      { videoId: 'b', name: 'Music', count: 1, remaining: 600 },
    ]);

    const within = headings.boundariesFrom(buildSortOrder(videos, clusters, [], undefined, { inProgress: 'within' }));
    assert.deepEqual([...within].map(b => ({ ...b })), [{ videoId: 'a', name: 'Music', count: 2, remaining: 900 }]);
  });
});
