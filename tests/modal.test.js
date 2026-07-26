// tests/modal.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

const load = () => loadGlobal('content/modal.js', 'WLModal', { document: undefined });

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

/**
 * Minimal document stub covering only what mountTrigger/removeTrigger touch.
 * The rest of WLModal's DOM-rendering methods need far more of the DOM API
 * (innerHTML parsing, event delegation, focus management) than is worth
 * faking without a real jsdom dependency, so those remain manually verified.
 */
function fakeDocument() {
  const elements = [];
  const makeElement = (tag) => ({
    tagName: tag,
    id: '',
    className: '',
    children: [],
    _listeners: {},
    setAttribute() {},
    addEventListener(type, fn) { this._listeners[type] = fn; },
    remove() {
      const i = elements.indexOf(this);
      if (i !== -1) elements.splice(i, 1);
    },
  });

  return {
    _elements: elements, // exposed for test introspection only; not part of the real DOM API
    body: { appendChild(el) { elements.push(el); } },
    createElement(tag) { return makeElement(tag); },
    querySelector(selector) {
      if (selector === '#wl-trigger') return elements.find(el => el.id === 'wl-trigger') ?? null;
      return null;
    },
  };
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
