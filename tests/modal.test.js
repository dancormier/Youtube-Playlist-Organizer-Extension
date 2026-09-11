// tests/modal.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';
import { SORT_CHOICES } from '../lib/sort.js';

const load = () => loadGlobal('content/modal.js', 'WLModal', { document: undefined });
// showPreview reads WLHeadings at click time for the per-group unwatched total.
const realHeadings = () => loadGlobal('content/headings.js', 'WLHeadings', {
  document: undefined, MutationObserver: class { observe() {} disconnect() {} },
});

function video(overrides = {}) {
  return {
    id: 'v', title: 'T', duration: 600, percentWatched: 0,
    cluster: 'Music', unavailable: false, ...overrides,
  };
}

describe('WLModal.toGroups', () => {
  it('returns an empty array for an empty order', () => {
    assert.deepEqual([...load().toGroups([])], []);
  });

  it('groups consecutive videos sharing a cluster', () => {
    const groups = load().toGroups([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Music' }),
      video({ id: 'c', cluster: 'Tech & AI' }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual([...groups[0].videos.map(v => v.id)], ['a', 'b']);
    assert.equal(groups[1].name, 'Tech & AI');
  });

  it('labels the null cluster as in progress', () => {
    const modal = load();
    assert.equal(modal.toGroups([video({ cluster: null })])[0].name, modal.IN_PROGRESS_LABEL);
  });

  it('treats a video with no cluster property as its own unlabelled group', () => {
    // buildDurationSortOrder returns videos with no cluster key at all.
    const groups = load().toGroups([{ id: 'a', title: 'T', duration: 60 }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, null, 'duration mode must not render a heading');
  });

  it('starts a new group when a cluster name repeats non-consecutively', () => {
    const groups = load().toGroups([
      video({ id: 'a', cluster: 'Music' }),
      video({ id: 'b', cluster: 'Tech & AI' }),
      video({ id: 'c', cluster: 'Music' }),
    ]);
    assert.equal(groups.length, 3);
  });
});

describe('WLModal.formatDuration', () => {
  it('formats under an hour as m:ss', () => { assert.equal(load().formatDuration(125), '2:05'); });
  it('formats an hour or more as h:mm:ss', () => { assert.equal(load().formatDuration(3725), '1:02:05'); });
  it('formats zero', () => { assert.equal(load().formatDuration(0), '0:00'); });
  it('pads seconds below ten', () => { assert.equal(load().formatDuration(65), '1:05'); });
});

describe('WLModal.metaFor', () => {
  it('shows remaining time for in-progress videos', () => {
    assert.equal(load().metaFor(video({ cluster: null, duration: 600, percentWatched: 50 })), '5:00 left');
  });

  it('shows total duration for unwatched videos', () => {
    assert.equal(load().metaFor(video({ duration: 600 })), '10:00');
  });

  it('shows a marker for unavailable videos', () => {
    assert.equal(load().metaFor(video({ unavailable: true })), 'unavailable');
  });

  it('never produces NaN when percentWatched is missing', () => {
    // Regression: the old panel read a deleted `progress` field and rendered NaN:NaN.
    assert.ok(!load().metaFor({ cluster: null, duration: 600 }).includes('NaN'));
  });
});

describe('WLModal.isInProgress', () => {
  it('trusts the sorter\'s inProgress flag when present, whatever the cluster is', () => {
    // inProgress 'within' keeps the cluster name on a started video.
    assert.equal(load().isInProgress(video({ cluster: 'Music', inProgress: true })), true);
    assert.equal(load().isInProgress(video({ cluster: null, inProgress: false })), false);
  });

  it('falls back to the null-cluster convention for orders saved before the flag existed', () => {
    assert.equal(load().isInProgress(video({ cluster: null })), true);
    assert.equal(load().isInProgress(video({ cluster: 'Music' })), false);
  });

  it('metaFor shows time left for a started video inside its category', () => {
    assert.equal(load().metaFor(video({ cluster: 'Music', inProgress: true, duration: 600, percentWatched: 50 })), '5:00 left');
  });
});

describe('WLModal.SORT_CHOICES constant drift', () => {
  it('matches lib/sort.js SORT_CHOICES exactly', () => {
    // Content scripts cannot import lib/, so the modal carries its own copy of
    // the select contents. The background whitelists values against the lib
    // copy, so a value that only exists here would silently fall back to the
    // default at sort time.
    const modal = load();
    assert.deepEqual(JSON.parse(JSON.stringify(modal.SORT_CHOICES)), JSON.parse(JSON.stringify(SORT_CHOICES)));
    assert.deepEqual(Object.keys(modal.SORT_FIELD_LABELS), Object.keys(SORT_CHOICES));
  });
});

/**
 * Minimal element/document fake, just enough for showModes(). open() builds the
 * modal shell with innerHTML, which is not worth faking, so these tests stub
 * _body()/_footer() directly and call showModes() on its own.
 */
function fakeUi() {
  const make = (tag) => ({
    tagName: tag, className: '', type: '', innerHTML: '', textContent: '',
    children: [], _attrs: {},
    _listeners: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    addEventListener(ev, fn) { this._listeners[ev] = fn; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    focus() {},
  });
  return { make, document: { createElement: make } };
}

function showModesWith({ present, handlers = {} }) {
  const { make, document } = fakeUi();
  const modal = loadGlobal('content/modal.js', 'WLModal', {
    document,
    WLHeadings: { present: () => present },
  });
  const body = make('div');
  const footer = make('div');
  modal._body = () => body;
  modal._footer = () => footer;
  modal._handlers = handlers;
  modal.showModes();
  return { footer, labels: footer.children.map(el => el.textContent) };
}

describe('WLModal.showModes', () => {
  it('offers no heading controls when no headings are present', () => {
    const { labels } = showModesWith({ present: false });
    assert.deepEqual([...labels], ['Close']);
  });

  it('offers the heading controls when headings are present', () => {
    const { labels } = showModesWith({ present: true });
    assert.deepEqual([...labels], ['Hide group headings', 'Close']);
  });

  it('wires the hide button to onHideHeadings', () => {
    let called = false;
    const { footer } = showModesWith({
      present: true,
      handlers: { onHideHeadings: () => { called = true; } },
    });
    footer.children.find(el => el.textContent === 'Hide group headings')._listeners.click();
    assert.equal(called, true);
  });

  it('does not throw when showModes runs with no handlers registered', () => {
    // Every handler call site uses ?., and the buttons are reachable before
    // open() has wired anything in the tests above.
    const { footer } = showModesWith({ present: true });
    assert.doesNotThrow(() => {
      footer.children.find(el => el.textContent === 'Hide group headings')._listeners.click();
    });
  });
});

/** The control (select or checkbox) carrying data-wl-sort inside a rendered field. */
const controlIn = (field) => field.children.find(el => el.getAttribute('data-wl-sort') !== null);

function previewWith({ sortOrder = [], sortOptions = null, handlers = {}, activeSortKey = null } = {}) {
  const { make, document } = fakeUi();
  const activeElement = activeSortKey
    ? { getAttribute: (k) => (k === 'data-wl-sort' ? activeSortKey : null) }
    : undefined;
  document.activeElement = activeElement;
  const modal = loadGlobal('content/modal.js', 'WLModal', { document, WLHeadings: realHeadings() });
  const body = make('div');
  body.querySelector = (selector) => {
    const match = /\[data-wl-sort="(\w+)"\]/.exec(selector);
    const row = body.children.find(el => el.className === 'wl-sort-options');
    return row?.children.map(controlIn).find(c => c.getAttribute('data-wl-sort') === match?.[1]) ?? null;
  };
  const footer = make('div');
  modal._body = () => body;
  modal._footer = () => footer;
  modal._handlers = handlers;
  modal.showPreview(sortOrder, sortOptions);
  const row = body.children.find(el => el.className === 'wl-sort-options') ?? null;
  const controls = row ? row.children.map(controlIn) : [];
  const selects = controls.filter(c => c.tagName === 'select');
  const checkbox = controls.find(c => c.tagName === 'input') ?? null;
  return { modal, body, footer, row, controls, selects, checkbox };
}

describe('WLModal.showPreview group headings', () => {
  it('shows the count and unwatched total beside each group name', () => {
    const { body } = previewWith({ sortOrder: [
      video({ id: 'a', cluster: 'Music', duration: 600 }),
      video({ id: 'b', cluster: 'Music', duration: 1000, percentWatched: 75, inProgress: true }),
      video({ id: 'c', cluster: 'Tech & AI', duration: 30 }),
    ] });
    const headings = body.children.filter(el => el.className.startsWith('wl-group-heading'));
    assert.deepEqual(headings.map(h => h.textContent), ['Music', 'Tech & AI']);
    assert.deepEqual(headings.map(h => h.children[0].className), ['wl-group-meta', 'wl-group-meta']);
    assert.deepEqual(headings.map(h => h.children[0].textContent), ['2 videos · 14m', '1 video · 1m']);
  });

  it('shows only the count when no video has a duration', () => {
    const { body } = previewWith({ sortOrder: [{ id: 'a', title: 'T', cluster: 'Music' }] });
    assert.equal(body.children[0].children[0].textContent, '1 video');
  });
});

describe('WLModal.showPreview sort options', () => {
  const options = { withinGroup: 'title', inProgress: 'within', groupOrder: 'alpha' };

  it('renders no options row when none are given (duration mode)', () => {
    const { row, body } = previewWith({ sortOrder: [video({ id: 'a' })] });
    assert.equal(row, null);
    assert.equal(body.children[0].className, 'wl-group-heading');
  });

  it('renders one labelled control per option, above the list, with the current value selected', () => {
    const { body, row, controls, selects, checkbox } = previewWith({ sortOrder: [video({ id: 'a' })], sortOptions: options });
    assert.equal(body.children[0].className, 'wl-sort-toggle', 'a show/hide toggle comes first');
    assert.equal(body.children[0].getAttribute('aria-expanded'), 'false', 'collapsed by default');
    assert.equal(body.children[1], row, 'the row comes before the first heading');
    assert.equal(row.hidden, true);
    body.children[0]._listeners.click();
    assert.equal(row.hidden, false);
    assert.equal(body.children[0].getAttribute('aria-expanded'), 'true');
    assert.deepEqual(row.children.map(f => f.tagName), ['label', 'label', 'label']);
    assert.deepEqual(controls.map(c => c.getAttribute('data-wl-sort')), ['withinGroup', 'inProgress', 'groupOrder']);
    assert.deepEqual(selects.map(s => s.getAttribute('data-wl-sort')), ['withinGroup', 'groupOrder']);
    for (const select of selects) {
      const key = select.getAttribute('data-wl-sort');
      assert.deepEqual(select.children.map(o => o.value), SORT_CHOICES[key].map(c => c.value));
      assert.deepEqual(select.children.filter(o => o.selected).map(o => o.value), [options[key]]);
    }
    assert.equal(checkbox.type, 'checkbox');
    assert.equal(checkbox.getAttribute('data-wl-sort'), 'inProgress');
    assert.equal(checkbox.checked, false, "'within' renders unchecked");
  });

  it('renders the checkbox checked for inProgress top, inside a wl-sort-check label', () => {
    const { row, checkbox } = previewWith({ sortOptions: { ...options, inProgress: 'top' } });
    assert.equal(checkbox.checked, true);
    const field = row.children.find(f => f.className === 'wl-sort-check');
    assert.equal(field.children[0], checkbox);
    assert.equal(field.children[1].textContent, 'Group in progress');
  });

  it('toggling the checkbox emits top when checked and within when unchecked', () => {
    const emitted = [];
    const { checkbox } = previewWith({
      sortOptions: options,
      handlers: { onSortOptionsChange: (next) => emitted.push(next) },
    });
    checkbox.checked = true;
    checkbox._listeners.change();
    checkbox.checked = false;
    checkbox._listeners.change();
    assert.deepEqual(emitted.map(o => ({ ...o })), [
      { withinGroup: 'title', inProgress: 'top', groupOrder: 'alpha' },
      { withinGroup: 'title', inProgress: 'within', groupOrder: 'alpha' },
    ]);
  });

  it('a change emits the full option set with only that key replaced', () => {
    const emitted = [];
    const { selects } = previewWith({
      sortOptions: options,
      handlers: { onSortOptionsChange: (next) => emitted.push(next) },
    });
    const groupOrder = selects.find(s => s.getAttribute('data-wl-sort') === 'groupOrder');
    groupOrder.value = 'size';
    groupOrder._listeners.change();
    assert.deepEqual(emitted.map(o => ({ ...o })), [{ withinGroup: 'title', inProgress: 'within', groupOrder: 'size' }]);
  });

  it('a second change carries the first one, not a render-time snapshot', () => {
    // Regression: two quick changes before the first re-sort returned reverted
    // each other because the handler closed over the options at render time.
    const emitted = [];
    const { selects } = previewWith({
      sortOptions: options,
      handlers: { onSortOptionsChange: (next) => emitted.push(next) },
    });
    const byKey = (k) => selects.find(s => s.getAttribute('data-wl-sort') === k);
    byKey('withinGroup').value = 'duration-desc';
    byKey('withinGroup')._listeners.change();
    byKey('groupOrder').value = 'alpha';
    byKey('groupOrder')._listeners.change();
    assert.deepEqual({ ...emitted[1] }, { withinGroup: 'duration-desc', inProgress: 'within', groupOrder: 'alpha' });
  });

  it('does not throw on change when no handler is registered', () => {
    const { selects } = previewWith({ sortOptions: options });
    selects[0].value = 'playlist';
    assert.doesNotThrow(() => selects[0]._listeners.change());
  });

  it('focuses Apply normally, but the control that triggered a re-render keeps focus', () => {
    const focusedWith = (activeSortKey) => {
      const focused = [];
      const { make, document } = fakeUi();
      document.createElement = (tag) => { const el = make(tag); el.focus = () => focused.push(el); return el; };
      if (activeSortKey) document.activeElement = { getAttribute: (k) => (k === 'data-wl-sort' ? activeSortKey : null) };
      const modal = loadGlobal('content/modal.js', 'WLModal', { document, WLHeadings: realHeadings() });
      const body = make('div');
      const byKey = (key) => body.children[1].children.map(controlIn).find(c => c.getAttribute('data-wl-sort') === key);
      body.querySelector = (selector) => byKey(/"(\w+)"/.exec(selector)[1]);
      const footer = make('div');
      modal._body = () => body;
      modal._footer = () => footer;
      modal.showPreview([], options);
      return { focused, apply: footer.children[0], byKey };
    };

    const plain = focusedWith(null);
    assert.deepEqual(plain.focused, [plain.apply]);

    const select = focusedWith('groupOrder');
    assert.deepEqual(select.focused, [select.byKey('groupOrder')]);

    const checkbox = focusedWith('inProgress');
    assert.equal(checkbox.byKey('inProgress').tagName, 'input');
    assert.deepEqual(checkbox.focused, [checkbox.byKey('inProgress')]);
  });
});

describe('WLModal._renderItem unwatched toggle', () => {
  it('reports pressed only when the sorter treated a started video as unwatched', () => {
    const { document } = fakeUi();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });
    modal._handlers = {};
    const pressed = (v) => modal._renderItem(v).children[2].getAttribute('aria-pressed');
    assert.equal(pressed(video({ percentWatched: 50, cluster: null, inProgress: true })), 'false');
    assert.equal(pressed(video({ percentWatched: 50, cluster: 'Music', inProgress: true })), 'false', 'within: started, not overridden');
    assert.equal(pressed(video({ percentWatched: 50, cluster: 'Music', inProgress: false })), 'true', 'overridden');
  });
});

/**
 * Minimal document stub covering only what mountTrigger/removeTrigger/close
 * touch. The rest of WLModal's DOM-rendering methods need far more of the
 * DOM API (innerHTML parsing, event delegation) than is worth faking without
 * a real jsdom dependency, so those remain manually verified.
 *
 * `isConnected` mirrors the real DOM property: an element is connected iff
 * it is present in this document's `elements` list (i.e. was appended and
 * not since removed). This is enough fidelity to test close()'s fallback
 * logic honestly without pulling in a DOM library.
 */
function fakeDocument() {
  const elements = [];
  const makeElement = (tag) => {
    const el = {
      tagName: tag,
      id: '',
      className: '',
      children: [],
      _listeners: {},
      _focused: false,
      classList: {
        add(name) { if (!this.contains(name)) el.className = (el.className + ' ' + name).trim(); },
        contains(name) { return el.className.split(/\s+/).includes(name); },
      },
      setAttribute() {},
      addEventListener(type, fn) { this._listeners[type] = fn; },
      focus() { this._focused = true; },
      remove() {
        const i = elements.indexOf(el);
        if (i !== -1) elements.splice(i, 1);
      },
    };
    Object.defineProperty(el, 'isConnected', { get: () => elements.includes(el) });
    return el;
  };

  return {
    _elements: elements, // exposed for test introspection only; not part of the real DOM API
    body: { appendChild(el) { elements.push(el); } },
    createElement(tag) { return makeElement(tag); },
    _host: null, // set by a test to simulate YouTube's chip row being present
    querySelector(selector) {
      if (selector === '#wl-trigger') return elements.find(el => el.id === 'wl-trigger') ?? null;
      if (this._host && selector === this._host._selector) return this._host;
      return null;
    },
  };
}

function fakeHost(selector) {
  const host = { _selector: selector, children: [], appendChild(el) { this.children.push(el); } };
  return host;
}

describe('WLModal.mountTrigger', () => {
  it('is idempotent: two calls append exactly one #wl-trigger button', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    modal.mountTrigger({ onOpen: () => {} });
    modal.mountTrigger({ onOpen: () => {} });

    const triggers = document._elements.filter(el => el.id === 'wl-trigger');
    assert.equal(triggers.length, 1);
  });

  it('wires the click handler to call onOpen', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    let opened = false;
    modal.mountTrigger({ onOpen: () => { opened = true; } });
    document._elements[0]._listeners.click();

    assert.equal(opened, true);
  });
});

describe('WLModal.mountTrigger placement', () => {
  it('mounts inline in the first matching chip-row host', () => {
    const document = fakeDocument();
    const selector = 'ytd-playlist-video-list-renderer ytd-feed-filter-chip-bar-renderer #chips-wrapper';
    document._host = fakeHost(selector);
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document, SELECTORS: { TRIGGER_HOSTS: ['nope', selector] },
    });
    modal.mountTrigger({ onOpen: () => {} });
    assert.equal(document._host.children.length, 1);
    assert.match(document._host.children[0].className, /wl-trigger-inline/);
    assert.equal(document._elements.length, 0, 'not appended to body');
  });

  it('moves a floating trigger into the chip row once the row appears', () => {
    const document = fakeDocument();
    const selector = 'chip-bar-view-model .ytChipBarViewModelChipBarScrollContainer';
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document, SELECTORS: { TRIGGER_HOSTS: [selector] },
    });
    assert.equal(modal.mountTrigger({ onOpen: () => {} }), true);
    assert.equal(document._elements.length, 1, 'floating first');
    document._host = fakeHost(selector);
    assert.equal(modal.mountTrigger({ onOpen: () => {} }), false, 'no second button');
    assert.equal(document._host.children.length, 1, 'moved into the row');
    assert.match(document._host.children[0].className, /wl-trigger-inline/);
  });

  it('mounts in the parent of a { parentOf } match', () => {
    const document = fakeDocument();
    const host = fakeHost(null);
    document._host = { _selector: 'chip-bar-view-model chip-view-model', parentElement: host };
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document, SELECTORS: { TRIGGER_HOSTS: [{ parentOf: 'chip-bar-view-model chip-view-model' }] },
    });
    modal.mountTrigger({ onOpen: () => {} });
    assert.equal(host.children.length, 1);
    assert.equal(document._elements.length, 0);
  });

  it('falls back to a floating button on body when no host matches', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document, SELECTORS: { TRIGGER_HOSTS: ['nope'] },
    });
    modal.mountTrigger({ onOpen: () => {} });
    assert.equal(document._elements.length, 1);
    assert.doesNotMatch(document._elements[0].className, /wl-trigger-inline/);
  });
});

describe('WLModal.removeTrigger', () => {
  it('removes a mounted trigger', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    modal.mountTrigger({ onOpen: () => {} });
    assert.ok(document.querySelector('#wl-trigger'));

    modal.removeTrigger();
    assert.equal(document.querySelector('#wl-trigger'), null);
  });

  it('is a no-op when no trigger is mounted', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    assert.doesNotThrow(() => modal.removeTrigger());
  });
});

describe('WLModal.close', () => {
  // These tests poke _lastFocused/_root directly rather than going through
  // open(), which needs far more DOM fidelity (innerHTML parsing) than this
  // stub provides. That's an honest trade: it means these tests exercise
  // close()'s focus-restoration branch in isolation, not the full open→close
  // lifecycle, but the branch itself — connected vs. detached — is exactly
  // what changed and what the stub can model faithfully via `isConnected`.

  it('restores focus to the last-focused element when it is still connected', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    const field = document.createElement('input');
    document.body.appendChild(field); // connected

    modal._lastFocused = field;
    modal._root = null;
    modal.close();

    assert.equal(field._focused, true);
  });

  it('falls back to the trigger when the last-focused element has been detached', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    const detached = document.createElement('input'); // never appended — not connected
    modal.mountTrigger({ onOpen: () => {} });

    modal._lastFocused = detached;
    modal._root = null;
    modal.close();

    assert.equal(detached._focused, false, 'must not focus a detached node');
    assert.equal(document.querySelector('#wl-trigger')._focused, true);
  });

  it('does nothing when both the last-focused element and the trigger are gone', () => {
    const document = fakeDocument();
    const modal = loadGlobal('content/modal.js', 'WLModal', { document });

    const detached = document.createElement('input'); // never appended, no trigger mounted

    modal._lastFocused = detached;
    modal._root = null;

    assert.doesNotThrow(() => modal.close());
    assert.equal(detached._focused, false);
  });
});

describe('WLModal.showBusy cancellability', () => {
  function busyWith(opts, handlers = {}) {
    const { make, document } = fakeUi();
    const modal = loadGlobal('content/modal.js', 'WLModal', {
      document,
      WLHeadings: { present: () => false },
    });
    const body = make('div');
    const footer = make('div');
    modal._body = () => body;
    modal._footer = () => footer;
    modal._handlers = handlers;
    modal.close = () => { closed = true; };
    let closed = false;
    modal.showBusy('Applying 3 moves...', opts);
    return { modal, footer, button: footer.children[0], wasClosed: () => closed };
  }

  it('is cancellable by default', () => {
    const { modal, button } = busyWith(undefined);
    assert.equal(modal._cancellable, true);
    assert.equal(button.disabled, undefined, 'the default Cancel button stays enabled');
  });

  it('disables the button when the work has already been sent', () => {
    const { modal, button } = busyWith({ cancellable: false });
    assert.equal(modal._cancellable, false);
    assert.equal(button.disabled, true);
    assert.equal(button._listeners.click, undefined, 'no click handler is wired at all');
  });

  it('ignores _cancel() while uninterruptible, so Escape and backdrop clicks cannot fire onCancel', () => {
    // Regression: the reorder is already written by this point. Cancelling only
    // hid the modal and skipped the reload, leaving the playlist silently
    // reordered while the UI implied nothing had happened. Escape and backdrop
    // clicks route through _cancel() too, which is why the guard lives there
    // rather than on the button.
    let cancelled = false;
    const { modal, wasClosed } = busyWith({ cancellable: false }, { onCancel: () => { cancelled = true; } });

    modal._cancel();

    assert.equal(cancelled, false, 'onCancel must not fire');
    assert.equal(wasClosed(), false, 'the modal must not close');
  });

  it('still cancels normally when the state is interruptible', () => {
    let cancelled = false;
    const { modal, wasClosed } = busyWith({ cancellable: true }, { onCancel: () => { cancelled = true; } });

    modal._cancel();

    assert.equal(cancelled, true);
    assert.equal(wasClosed(), true);
  });

  it('restores cancellability when a later state renders', () => {
    // Without this, one uninterruptible apply would wedge Escape shut for the
    // rest of the modal's life.
    const { modal, footer } = busyWith({ cancellable: false });
    assert.equal(modal._cancellable, false, 'setup');

    footer.children.length = 0;
    modal.showError('something broke');

    assert.equal(modal._cancellable, true);
  });
});
