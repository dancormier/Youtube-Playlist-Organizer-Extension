// tests/sort.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSortOrder, buildDurationSortOrder, effectiveProgress, WATCHED_THRESHOLD,
  SORT_DEFAULTS, SORT_CHOICES, normalizeSortOptions,
} from '../lib/sort.js';
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

  it('ignores the reserved Other and Unavailable names so no video is emitted twice', () => {
    // Regression: a user listing "Other" as a category made `ordered` contain it
    // twice, and the sort order doubled every video in that group.
    const videos = [video({ id: 'a' }), video({ id: 'b' }), video({ id: 'u', unavailable: true })];
    const order = buildSortOrder(videos, {
      clusters: [{ name: 'Other', videoIds: ['a', 'b'] }],
    }, [], ['Music', 'Other', 'Unavailable']);
    assert.deepEqual(order.map(v => v.id), ['a', 'b', 'u']);
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

describe('normalizeSortOptions', () => {
  it('fills every default from nothing', () => {
    assert.deepEqual(normalizeSortOptions(undefined), SORT_DEFAULTS);
    assert.deepEqual(normalizeSortOptions(null), SORT_DEFAULTS);
    assert.deepEqual(normalizeSortOptions('nope'), SORT_DEFAULTS);
  });

  it('keeps whitelisted values and replaces unknown ones with the default', () => {
    const s = normalizeSortOptions({ withinGroup: 'title', inProgress: 'bogus', groupOrder: 'alpha', extra: 1 });
    assert.deepEqual(s, { withinGroup: 'title', inProgress: 'top', groupOrder: 'alpha' });
  });

  it('maps the retired inProgress "ignore" onto "within" rather than the default', () => {
    assert.equal(normalizeSortOptions({ inProgress: 'ignore' }).inProgress, 'within');
    assert.equal(SORT_CHOICES.inProgress.some(c => c.value === 'ignore'), false, 'no longer offered');
  });

  it('accepts every value SORT_CHOICES offers', () => {
    for (const [key, choices] of Object.entries(SORT_CHOICES)) {
      for (const { value } of choices) assert.equal(normalizeSortOptions({ [key]: value })[key], value);
    }
  });

  it('defaults are the first choice of each select', () => {
    for (const [key, choices] of Object.entries(SORT_CHOICES)) assert.equal(choices[0].value, SORT_DEFAULTS[key]);
  });
});

describe('buildSortOrder options: withinGroup', () => {
  const clusters = { clusters: [{ name: 'Music', videoIds: ['a', 'b', 'c'] }] };
  const videos = [
    video({ id: 'a', title: 'banana', duration: 500 }),
    video({ id: 'b', title: 'Apple', duration: 900 }),
    video({ id: 'c', title: 'cherry', duration: 100 }),
  ];
  const ids = (options) => buildSortOrder(videos, clusters, [], undefined, options).map(v => v.id);

  it('duration-asc is the default and matches the five-argument form', () => {
    assert.deepEqual(ids({}), ['c', 'a', 'b']);
    assert.deepEqual(ids({ withinGroup: 'duration-asc' }), buildSortOrder(videos, clusters, []).map(v => v.id));
  });

  it('duration-desc puts the longest first', () => {
    assert.deepEqual(ids({ withinGroup: 'duration-desc' }), ['b', 'a', 'c']);
  });

  it('playlist keeps arrival order, including across interleaved groups', () => {
    assert.deepEqual(ids({ withinGroup: 'playlist' }), ['a', 'b', 'c']);
    const mixed = [1, 2, 3, 4, 5, 6, 7].map(n => video({ id: String(n), duration: 1000 - n * 100 }));
    const twoGroups = { clusters: [
      { name: 'Music', videoIds: ['1', '5', '7'] },
      { name: 'Tech & AI', videoIds: ['2', '3', '4', '6'] },
    ] };
    const order = buildSortOrder(mixed, twoGroups, [], undefined, { withinGroup: 'playlist' }).map(v => v.id);
    assert.deepEqual(order, ['1', '5', '7', '2', '3', '4', '6']);
  });

  it('title sorts case-insensitively', () => {
    assert.deepEqual(ids({ withinGroup: 'title' }), ['b', 'a', 'c']);
  });

  it('never changes the in-progress group, which always sorts by time left', () => {
    const started = [
      video({ id: 'x', title: 'zzz', duration: 1000, percentWatched: 90 }), // 100 left
      video({ id: 'y', title: 'aaa', duration: 1000, percentWatched: 50 }), // 500 left
    ];
    for (const withinGroup of ['duration-desc', 'playlist', 'title']) {
      const order = buildSortOrder([...started].reverse(), clusters, [], undefined, { withinGroup });
      assert.deepEqual(order.map(v => v.id), ['x', 'y'], withinGroup);
    }
  });
});

describe('buildSortOrder options: inProgress', () => {
  const clusters = { clusters: [
    { name: 'Music', videoIds: ['m1', 'm2', 'm3'] },
    { name: 'Tech & AI', videoIds: ['t1', 't2'] },
  ] };
  const videos = [
    video({ id: 't1', duration: 300 }),
    video({ id: 'm1', duration: 900, percentWatched: 50 }), // 450 left
    video({ id: 'm2', duration: 200 }),
    video({ id: 'm3', duration: 1000, percentWatched: 90 }), // 100 left
    video({ id: 't2', duration: 100, percentWatched: 20 }), // 80 left
  ];

  it('top (default) makes one null-cluster group ordered by time left', () => {
    const order = buildSortOrder(videos, clusters, [], undefined, { inProgress: 'top' });
    assert.deepEqual(order.map(v => v.id), ['t2', 'm3', 'm1', 'm2', 't1']);
    assert.deepEqual(order.slice(0, 3).map(v => v.cluster), [null, null, null]);
    assert.equal(order.every(v => typeof v.inProgress === 'boolean'), true);
  });

  it('within keeps started videos in their group, first, by time left, then the rest per withinGroup', () => {
    const order = buildSortOrder(videos, clusters, [], undefined, { inProgress: 'within', withinGroup: 'duration-asc' });
    assert.deepEqual(order.map(v => v.id), ['m3', 'm1', 'm2', 't2', 't1']);
    assert.equal(order.some(v => v.cluster === null), false, 'no In Progress group');
    const m3 = order.find(v => v.id === 'm3');
    assert.equal(m3.cluster, 'Music');
    assert.equal(m3.percentWatched, 90, 'the modal still needs this to print "left"');
    assert.equal(m3.inProgress, true);
    assert.equal(order.find(v => v.id === 'm2').inProgress, false);
  });

  it('within honours withinGroup for the unwatched tail only', () => {
    const more = [...videos, video({ id: 'm4', duration: 50 })];
    const withM4 = { clusters: [{ name: 'Music', videoIds: ['m1', 'm2', 'm3', 'm4'] }, clusters.clusters[1]] };
    const asc = buildSortOrder(more, withM4, [], undefined, { inProgress: 'within', withinGroup: 'duration-asc' });
    const desc = buildSortOrder(more, withM4, [], undefined, { inProgress: 'within', withinGroup: 'duration-desc' });
    assert.deepEqual(asc.map(v => v.id), ['m3', 'm1', 'm4', 'm2', 't2', 't1']);
    assert.deepEqual(desc.map(v => v.id), ['m3', 'm1', 'm2', 'm4', 't2', 't1'], 'started pair unchanged, tail reversed');
  });

  it('the retired ignore value behaves as within', () => {
    const legacy = buildSortOrder(videos, clusters, [], undefined, { inProgress: 'ignore' });
    const within = buildSortOrder(videos, clusters, [], undefined, { inProgress: 'within' });
    assert.deepEqual(legacy.map(v => v.id), within.map(v => v.id));
  });

  it('within still respects overrides for the started flag', () => {
    const order = buildSortOrder(videos, clusters, ['m3'], undefined, { inProgress: 'within' });
    assert.deepEqual(order.map(v => v.id), ['m1', 'm2', 'm3', 't2', 't1']);
    assert.equal(order.find(v => v.id === 'm3').inProgress, false);
  });
});

describe('buildSortOrder options: groupOrder', () => {
  const taxonomy = ['Zebra', 'Music', 'Apple'];
  const clusters = { clusters: [
    { name: 'Music', videoIds: ['m1'] },
    { name: 'Apple', videoIds: ['a1', 'a2'] },
    { name: 'Zebra', videoIds: ['z1', 'z2'] },
    { name: 'Knitting', videoIds: ['k1', 'k2', 'k3'] },
  ] };
  const videos = [
    video({ id: 'other1' }), video({ id: 'other2' }), video({ id: 'other3' }), video({ id: 'other4' }),
    video({ id: 'k1' }), video({ id: 'k2' }), video({ id: 'k3' }),
    video({ id: 'a1' }), video({ id: 'a2' }),
    video({ id: 'z1' }), video({ id: 'z2' }),
    video({ id: 'm1' }),
    video({ id: 'ghost', unavailable: true }),
  ];
  const groupsOf = (options) => {
    const order = buildSortOrder(videos, clusters, [], taxonomy, options);
    return [...new Set(order.map(v => v.cluster))];
  };

  it('taxonomy (default): taxonomy order, invented names, Other, Unavailable', () => {
    assert.deepEqual(groupsOf({}), ['Zebra', 'Music', 'Apple', 'Knitting', 'Other', 'Unavailable']);
  });

  it('size: largest first, ties broken by taxonomy order; Other stays last even when biggest', () => {
    assert.deepEqual(groupsOf({ groupOrder: 'size' }), ['Knitting', 'Zebra', 'Apple', 'Music', 'Other', 'Unavailable']);
  });

  it('alpha: alphabetical, Other last', () => {
    assert.deepEqual(groupsOf({ groupOrder: 'alpha' }), ['Apple', 'Knitting', 'Music', 'Zebra', 'Other', 'Unavailable']);
  });

  it('with inProgress top, the In Progress group precedes every ordering', () => {
    const withStarted = [video({ id: 'p', percentWatched: 50 }), ...videos];
    for (const groupOrder of ['taxonomy', 'size', 'alpha']) {
      const order = buildSortOrder(withStarted, clusters, [], taxonomy, { groupOrder });
      assert.equal(order[0].id, 'p', groupOrder);
      assert.equal(order[order.length - 1].id, 'ghost', groupOrder);
    }
  });
});

describe('buildSortOrder ignores options in the non-AI path', () => {
  it('buildDurationSortOrder is untouched by sort options', () => {
    const order = buildDurationSortOrder([video({ id: 'b', duration: 9 }), video({ id: 'a', duration: 1 })]);
    assert.deepEqual(order.map(v => v.id), ['a', 'b']);
    assert.equal('cluster' in order[0], false);
    assert.equal('inProgress' in order[0], false);
  });
});
