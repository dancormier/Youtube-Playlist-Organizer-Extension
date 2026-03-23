// tests/claude-api.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseClusters } from '../lib/claude-api.js';

describe('buildPrompt', () => {
  it('includes video titles and channels in the prompt', () => {
    const videos = [
      { id: 'v1', title: 'Roman Empire', channel: 'History Guy', duration: 1200 },
      { id: 'v2', title: 'Stand-up Special', channel: 'Comedy Central', duration: 495 },
    ];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('Roman Empire'));
    assert.ok(prompt.includes('History Guy'));
    assert.ok(prompt.includes('Stand-up Special'));
  });

  it('includes video IDs for reference', () => {
    const videos = [{ id: 'abc123', title: 'Test', channel: 'Ch', duration: 100 }];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('abc123'));
  });

  it('requests JSON output format', () => {
    const videos = [{ id: 'v1', title: 'Test', channel: 'Ch', duration: 100 }];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('JSON'));
  });
});

describe('parseClusters', () => {
  it('parses valid cluster JSON from response text', () => {
    const responseText = '{"clusters":[{"name":"History","videoIds":["v1","v2"]}]}';
    const result = parseClusters(responseText);
    assert.equal(result.clusters.length, 1);
    assert.equal(result.clusters[0].name, 'History');
    assert.deepEqual(result.clusters[0].videoIds, ['v1', 'v2']);
  });

  it('extracts JSON from markdown code block', () => {
    const responseText = 'Here is the result:\n```json\n{"clusters":[{"name":"Tech","videoIds":["v1"]}]}\n```';
    const result = parseClusters(responseText);
    assert.equal(result.clusters[0].name, 'Tech');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseClusters('not json at all'), /Failed to parse/);
  });

  it('throws when clusters key is missing', () => {
    assert.throws(() => parseClusters('{"categories":[]}'), /Missing "clusters"/);
  });
});
