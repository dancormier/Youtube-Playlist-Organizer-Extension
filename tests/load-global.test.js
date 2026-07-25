// tests/load-global.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { loadGlobal } from './helpers/load-global.js';

describe('loadGlobal', () => {
  const tmpDir = 'tests/.tmp';
  const tmpFile = `${tmpDir}/fixture-global.js`;

  it('returns a global declared with const', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const WLFixture = { answer: () => 42 };');
    try {
      const WLFixture = loadGlobal(tmpFile, 'WLFixture');
      assert.equal(WLFixture.answer(), 42);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('injects sandbox values the script can read', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const WLFixture = { host: () => location.host };');
    try {
      const WLFixture = loadGlobal(tmpFile, 'WLFixture', {
        location: { host: 'www.youtube.com' },
      });
      assert.equal(WLFixture.host(), 'www.youtube.com');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the global is not defined', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const Other = {};');
    try {
      assert.throws(() => loadGlobal(tmpFile, 'WLMissing'), /did not define WLMissing/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('propagates ReferenceError when a different identifier is undefined (regression)', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpFile, 'const WLFixture = {}; someUndefinedFunction();');
    try {
      assert.throws(() => loadGlobal(tmpFile, 'WLFixture'), /someUndefinedFunction is not defined/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
