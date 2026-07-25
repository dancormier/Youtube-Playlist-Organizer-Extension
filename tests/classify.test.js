// tests/classify.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseClusters } from '../lib/classify.js';
import { TAXONOMY } from '../lib/taxonomy.js';

function video(overrides = {}) {
  return {
    id: 'v1', title: 'A Title', channel: 'A Channel',
    duration: 600, category: 'Science & Technology',
    description: 'A description.', unavailable: false,
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('lists every taxonomy category', () => {
    const prompt = buildPrompt([video()]);
    for (const name of TAXONOMY) assert.ok(prompt.includes(name), `missing ${name}`);
  });

  it('includes id, title, channel and category for each video', () => {
    const prompt = buildPrompt([video({ id: 'abc', title: 'Sushi', channel: 'Atlas Obscura' })]);
    assert.ok(prompt.includes('abc'));
    assert.ok(prompt.includes('Sushi'));
    assert.ok(prompt.includes('Atlas Obscura'));
    assert.ok(prompt.includes('Science & Technology'));
  });

  it('omits the category field when enrichment failed', () => {
    const prompt = buildPrompt([video({ category: null })]);
    assert.ok(!prompt.includes('ytCategory: "null"'));
  });

  it('escapes double quotes in titles', () => {
    const prompt = buildPrompt([video({ title: 'He said "hello"' })]);
    assert.ok(prompt.includes('\\"hello\\"'));
  });

  it('excludes unavailable videos, which have nothing to classify', () => {
    const prompt = buildPrompt([video({ id: 'ok' }), video({ id: 'ghost', unavailable: true })]);
    assert.ok(prompt.includes('ok'));
    assert.ok(!prompt.includes('ghost'));
  });
});

describe('parseClusters', () => {
  it('parses bare JSON', () => {
    const result = parseClusters('{"clusters":[{"name":"Music","videoIds":["a"]}]}');
    assert.equal(result.clusters[0].name, 'Music');
  });

  it('parses JSON inside a fenced code block', () => {
    const result = parseClusters('```json\n{"clusters":[{"name":"Music","videoIds":["a"]}]}\n```');
    assert.equal(result.clusters[0].name, 'Music');
  });

  it('parses a fenced block with no language tag', () => {
    const result = parseClusters('```\n{"clusters":[]}\n```');
    assert.deepEqual(result.clusters, []);
  });

  it('throws a useful error on malformed JSON', () => {
    assert.throws(() => parseClusters('not json at all'), /Failed to parse cluster JSON/);
  });

  it('throws when the clusters array is missing', () => {
    assert.throws(() => parseClusters('{"groups":[]}'), /Missing "clusters" array/);
  });

  it('throws when a cluster videoIds is a string instead of an array', () => {
    assert.throws(
      () => parseClusters('{"clusters":[{"name":"Music","videoIds":"abc123"}]}'),
      /Invalid cluster at index 0.*"videoIds" must be an array, got string/
    );
  });

  it('throws when a cluster videoIds is absent', () => {
    assert.throws(
      () => parseClusters('{"clusters":[{"name":"Music"}]}'),
      /Invalid cluster at index 0.*"videoIds" must be an array, got undefined/
    );
  });

  it('throws when a cluster name is missing', () => {
    assert.throws(
      () => parseClusters('{"clusters":[{"videoIds":["a"]}]}'),
      /Invalid cluster at index 0.*"name" must be a non-empty string/
    );
  });

  it('throws when a cluster name is empty', () => {
    assert.throws(
      () => parseClusters('{"clusters":[{"name":"","videoIds":["a"]}]}'),
      /Invalid cluster at index 0.*"name" must be a non-empty string/
    );
  });
});
