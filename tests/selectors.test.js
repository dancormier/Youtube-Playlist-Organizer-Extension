// tests/selectors.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('selectors', () => {
  it('exports all required selectors', () => {
    const code = readFileSync('content/selectors.js', 'utf8');
    const required = [
      'PLAYLIST_ITEMS',
      'VIDEO_TITLE',
      'VIDEO_LINK',
    ];
    for (const name of required) {
      assert.ok(code.includes(name), `Missing selector: ${name}`);
    }
  });

  it('selectors are non-empty strings', () => {
    const code = readFileSync('content/selectors.js', 'utf8');
    // Match object literal format: KEY: 'value'
    const matches = [...code.matchAll(/(\w+):\s*'([^']*)'/g)];
    assert.ok(matches.length > 0, 'No selector values found');
    for (const [, name, value] of matches) {
      assert.ok(value.length > 0, `Empty selector: ${name}`);
    }
  });
});
