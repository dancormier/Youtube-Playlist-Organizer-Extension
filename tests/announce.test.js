// tests/announce.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// content/announce.js defines no global, so it is evaluated directly rather
// than through loadGlobal.
function run(chrome) {
  vm.runInContext(readFileSync('content/announce.js', 'utf8'), vm.createContext({ chrome }));
}

describe('content/announce.js', () => {
  it('sends exactly one YT_PAGE message on load', () => {
    const sent = [];
    run({ runtime: { sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); } } });
    assert.deepEqual(sent.map(m => ({ ...m })), [{ type: 'YT_PAGE' }]);
  });

  it('sends YT_LEAVE on pagehide so the icon resets when the tab leaves YouTube', () => {
    const sent = [];
    const listeners = {};
    const chrome = { runtime: { sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); } } };
    const ctx = vm.createContext({ chrome, addEventListener: (ev, fn) => { listeners[ev] = fn; } });
    vm.runInContext(readFileSync('content/announce.js', 'utf8'), ctx);
    listeners.pagehide();
    assert.deepEqual(sent.map(m => m.type), ['YT_PAGE', 'YT_LEAVE']);
  });

  it('swallows a rejected send so the rest of the content scripts still load', async () => {
    run({ runtime: { sendMessage: () => Promise.reject(new Error('no receiver')) } });
    await new Promise(r => setTimeout(r, 0));
  });

  it('survives a synchronous throw from the runtime', () => {
    assert.doesNotThrow(() => run({ runtime: { sendMessage: () => { throw new Error('gone'); } } }));
  });
});
