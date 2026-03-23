// tests/sort.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSortOrder } from '../lib/sort.js';

describe('buildSortOrder', () => {
  const videos = [
    { id: 'v1', title: 'Roman Empire', channel: 'History Guy', duration: 1200, progress: 0.72 },
    { id: 'v2', title: 'Perfect Pasta', channel: 'Chef', duration: 600, progress: 0.35 },
    { id: 'v3', title: 'Constantinople', channel: 'History Guy', duration: 754, progress: 0 },
    { id: 'v4', title: 'Viking Age', channel: 'Timeline', duration: 2721, progress: 0 },
    { id: 'v5', title: 'Stand-up Highlights', channel: 'Comedy Central', duration: 495, progress: 0 },
    { id: 'v6', title: 'Sketch Comedy', channel: 'SNL', duration: 1327, progress: 0 },
    { id: 'v7', title: 'Film Analysis', channel: 'Every Frame', duration: 900, progress: 0 },
  ];

  const clusters = {
    clusters: [
      { name: 'History', videoIds: ['v3', 'v4'] },
      { name: 'Comedy', videoIds: ['v5', 'v6'] },
      { name: 'Media Criticism', videoIds: ['v7'] },
    ]
  };

  it('puts in-progress videos first, sorted by remaining time ascending', () => {
    const result = buildSortOrder(videos, clusters);
    // v1: 1200 * (1 - 0.72) = 336s remaining
    // v2: 600 * (1 - 0.35) = 390s remaining
    assert.equal(result[0].id, 'v1'); // 336s remaining
    assert.equal(result[1].id, 'v2'); // 390s remaining
  });

  it('groups remaining videos by cluster', () => {
    const result = buildSortOrder(videos, clusters);
    const afterProgress = result.slice(2);
    const historyIdx = afterProgress.findIndex(v => v.id === 'v3');
    const otherHistoryIdx = afterProgress.findIndex(v => v.id === 'v4');
    assert.ok(Math.abs(historyIdx - otherHistoryIdx) === 1, 'History videos should be adjacent');
  });

  it('sorts within clusters by duration ascending', () => {
    const result = buildSortOrder(videos, clusters);
    const afterProgress = result.slice(2);
    const historyVideos = afterProgress.filter(v => ['v3', 'v4'].includes(v.id));
    assert.equal(historyVideos[0].id, 'v3'); // 754s
    assert.equal(historyVideos[1].id, 'v4'); // 2721s
  });

  it('includes cluster name in the result', () => {
    const result = buildSortOrder(videos, clusters);
    const v3 = result.find(v => v.id === 'v3');
    assert.equal(v3.cluster, 'History');
  });

  it('marks in-progress videos with no cluster', () => {
    const result = buildSortOrder(videos, clusters);
    assert.equal(result[0].cluster, null);
    assert.equal(result[1].cluster, null);
  });

  it('handles videos not assigned to any cluster', () => {
    const sparseCluster = { clusters: [{ name: 'History', videoIds: ['v3'] }] };
    const smallList = [
      { id: 'v3', title: 'Constantinople', channel: 'History Guy', duration: 754, progress: 0 },
      { id: 'v5', title: 'Stand-up', channel: 'Comedy Central', duration: 495, progress: 0 },
    ];
    const result = buildSortOrder(smallList, sparseCluster);
    assert.equal(result.length, 2);
    const v5 = result.find(v => v.id === 'v5');
    assert.equal(v5.cluster, 'Other');
  });

  it('returns empty array for empty input', () => {
    const result = buildSortOrder([], { clusters: [] });
    assert.deepEqual(result, []);
  });
});
