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
