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

describe('buildSortOrder with a custom taxonomy', () => {
  it('orders and canonicalises against the taxonomy passed in, not the default', () => {
    const taxonomy = ['Woodwork', 'Knitting'];
    const videos = [video({ id: 'k' }), video({ id: 'w' }), video({ id: 'm' })];
    const order = buildSortOrder(videos, {
      clusters: [
        { name: 'knitting', videoIds: ['k'] },
        { name: 'Woodwork', videoIds: ['w'] },
        { name: 'Music', videoIds: ['m'] },
      ],
    }, [], taxonomy);

    // Custom order first; Music is no longer a taxonomy name, so it sorts after.
    assert.deepEqual(order.map(v => v.id), ['w', 'k', 'm']);
    assert.equal(order[1].cluster, 'Knitting', 'folds onto the custom spelling');
  });
});

describe('buildSortOrder cluster-name folding', () => {
  it('folds a differently-cased taxonomy name onto the taxonomy spelling', () => {
    // Regression: group identity is a plain string match, so "tech & ai" and
    // "Tech & AI" produced two groups and two headings for one category.
    const videos = [video({ id: 'a' }), video({ id: 'b' })];
    const order = buildSortOrder(videos, {
      clusters: [
        { name: 'Tech & AI', videoIds: ['a'] },
        { name: 'tech & ai', videoIds: ['b'] },
      ],
    }, []);

    assert.deepEqual([...new Set(order.map(v => v.cluster))], ['Tech & AI'],
      'both videos must land in one group, spelled as the taxonomy spells it');
  });

  it('folds surrounding whitespace onto the taxonomy spelling', () => {
    const order = buildSortOrder([video({ id: 'a' })], {
      clusters: [{ name: '  Music  ', videoIds: ['a'] }],
    }, []);
    assert.equal(order[0].cluster, 'Music');
  });

  it('folds model-invented names onto the spelling that arrived first', () => {
    // No canonical spelling exists for these, so first-seen wins. What matters
    // is that they do not fragment.
    const videos = [video({ id: 'a' }), video({ id: 'b' })];
    const order = buildSortOrder(videos, {
      clusters: [
        { name: 'Knitting', videoIds: ['a'] },
        { name: 'KNITTING', videoIds: ['b'] },
      ],
    }, []);

    assert.deepEqual([...new Set(order.map(v => v.cluster))], ['Knitting']);
  });

  it('still separates genuinely different categories', () => {
    // Guard against the folding being too aggressive.
    const videos = [video({ id: 'a' }), video({ id: 'b' })];
    const order = buildSortOrder(videos, {
      clusters: [
        { name: 'Music', videoIds: ['a'] },
        { name: 'Tech & AI', videoIds: ['b'] },
      ],
    }, []);

    assert.equal(new Set(order.map(v => v.cluster)).size, 2);
  });

  it('sorts a case-folded taxonomy group into its taxonomy position, not after it', () => {
    // Ordering keys off TAXONOMY.includes(name), so an unfolded "music" would
    // have been treated as invented and sorted after every real category.
    const videos = [video({ id: 'tech' }), video({ id: 'music' })];
    const order = buildSortOrder(videos, {
      clusters: [
        { name: 'Tech & AI', videoIds: ['tech'] },
        { name: 'music', videoIds: ['music'] },
      ],
    }, []);

    assert.deepEqual(order.map(v => v.id), ['music', 'tech'],
      'Music precedes Tech & AI in the taxonomy');
  });
});
