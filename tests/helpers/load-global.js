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
    // Only convert ReferenceError if it's about the specific global we're looking for.
    // Errors from vm context won't match instanceof ReferenceError, so check err.name.
    // Build a pattern to match exactly: "WLFixture is not defined" (where WLFixture is the globalName).
    const globalPattern = new RegExp(`^${globalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not defined$`);
    if (err.name === 'ReferenceError' && globalPattern.test(err.message)) {
      throw new Error(`${path} did not define ${globalName}`);
    }
    throw err;
  }

  const value = context[globalName];
  if (!value) throw new Error(`${path} did not define ${globalName}`);
  return value;
}
