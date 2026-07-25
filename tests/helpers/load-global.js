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

  let value = context[globalName];
  if (!value) throw new Error(`${path} did not define ${globalName}`);

  // Wrap methods to convert arrays from VM context to regular arrays
  // This ensures arrays are compatible with deepEqual in strict mode
  const handler = {
    get(target, prop) {
      const val = target[prop];
      if (typeof val === 'function') {
        return function(...args) {
          const result = val.apply(target, args);
          // Handle both sync and async returns
          if (result instanceof Promise) {
            return result.then(r => convertArrays(r));
          }
          return convertArrays(result);
        };
      }
      return val;
    }
  };

  function convertArrays(val, isTopLevel = true) {
    // Convert VM arrays to regular arrays (recursively for nested arrays)
    if (Array.isArray(val) && val.constructor !== Array) {
      // Use spread operator to create a new array in the global context
      const converted = [...val].map(item => {
        // Don't wrap items inside the array, just convert them
        if (Array.isArray(item) && item.constructor !== Array) {
          return [...item];
        }
        return item;
      });

      // Only wrap top-level arrays in Proxy to handle method calls
      if (isTopLevel) {
        return new Proxy(converted, {
          get(target, prop) {
            // Don't wrap built-in properties like constructor, Symbol.*, etc.
            if (prop === 'constructor' || typeof prop === 'symbol') {
              return target[prop];
            }
            const method = target[prop];
            if (typeof method === 'function') {
              return function(...args) {
                const result = method.apply(target, args);
                // Convert result arrays, but don't wrap in Proxy
                if (Array.isArray(result) && result.constructor !== Array) {
                  return [...result];
                }
                return result;
              };
            }
            return method;
          }
        });
      }
      return converted;
    }
    // Return as-is if it's already a regular array or not an array
    return val;
  }

  return new Proxy(value, handler);
}
