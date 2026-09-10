// tests/providers.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, MODEL_GUIDANCE, getProvider, pickRecommended } from '../lib/providers.js';

describe('PROVIDERS table', () => {
  it('has unique ids', () => {
    const ids = PROVIDERS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('covers the expected providers in order', () => {
    assert.deepEqual(PROVIDERS.map(p => p.id),
      ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama', 'custom']);
  });

  it('uses only the two request kinds classify.js knows how to build', () => {
    for (const p of PROVIDERS) assert.ok(['anthropic', 'openai'].includes(p.kind), p.id);
  });

  it('gives every provider a label and a hint', () => {
    for (const p of PROVIDERS) {
      assert.ok(p.label.length > 0, `${p.id} label`);
      assert.ok(p.hint.length > 0, `${p.id} hint`);
    }
  });

  it('gives every provider except custom a default model and base URL', () => {
    for (const p of PROVIDERS) {
      if (p.id === 'custom') {
        assert.equal(p.baseUrl, '', 'custom URL is user-supplied');
        continue;
      }
      assert.ok(p.defaultModel.length > 0, `${p.id} defaultModel`);
      assert.match(p.baseUrl, /^https?:\/\//, `${p.id} baseUrl`);
    }
  });

  it('marks only Ollama as not needing a key', () => {
    assert.deepEqual(PROVIDERS.filter(p => !p.needsKey).map(p => p.id), ['ollama']);
  });

  it('exports non-empty model guidance', () => {
    assert.match(MODEL_GUIDANCE, /smallest current model/);
  });
});

describe('getProvider', () => {
  it('returns the provider by id', () => {
    assert.equal(getProvider('openai').label, 'OpenAI');
  });

  it('returns null for an unknown id', () => {
    assert.equal(getProvider('nope'), null);
    assert.equal(getProvider(undefined), null);
  });
});

describe('pickRecommended', () => {
  const anthropic = getProvider('anthropic');

  it('prefers the default model when the list contains it', () => {
    const models = ['claude-opus-4-1', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5'];
    assert.equal(pickRecommended(models, anthropic), 'claude-haiku-4-5-20251001');
  });

  it('falls back to the first small-tier model when the default is absent', () => {
    assert.equal(pickRecommended(['gpt-5', 'gpt-5-mini', 'gpt-5-nano'], anthropic), 'gpt-5-mini');
    assert.equal(pickRecommended(['big-model', 'gemma-3b'], anthropic), 'gemma-3b');
    assert.equal(pickRecommended(['Big', 'Some-Flash-Lite'], anthropic), 'Some-Flash-Lite');
  });

  it('falls back to the first model when nothing looks small', () => {
    assert.equal(pickRecommended(['alpha', 'beta'], anthropic), 'alpha');
  });

  it('returns null for an empty list', () => {
    assert.equal(pickRecommended([], anthropic), null);
  });

  it('copes with a provider that has no default model', () => {
    assert.equal(pickRecommended(['x', 'y-mini'], getProvider('custom')), 'y-mini');
  });
});
