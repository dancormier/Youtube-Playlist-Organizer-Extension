// tests/helpers/load-global.js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Evaluate a content script and return the global it defines.
 *
 * Content scripts declare their global with `const`, which in a vm context does
 * NOT attach to the context object — so we append an explicit assignment.
 */
export function loadGlobal(path, globalName, sandbox = {}) {
  const code = readFileSync(path, 'utf8');

  const context = vm.createContext({
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    ...sandbox,
  });

  try {
    vm.runInContext(`${code}\n;globalThis[${JSON.stringify(globalName)}] = ${globalName};`, context);
  } catch (err) {
    if (err.code === 'ERR_SCRIPT_EXECUTION_INTERRUPTED' || err.message.includes('is not defined')) {
      throw new Error(`${path} did not define ${globalName}`);
    }
    throw err;
  }

  const value = context[globalName];
  if (!value) throw new Error(`${path} did not define ${globalName}`);
  return value;
}
