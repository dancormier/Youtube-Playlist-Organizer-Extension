// tests/headings.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

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
    assert.deepEqual([...boundaries].map(b => ({ ...b })), [
      { videoId: 'a', name: 'Music' },
      { videoId: 'c', name: 'Tech & AI' },
    ]);
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
