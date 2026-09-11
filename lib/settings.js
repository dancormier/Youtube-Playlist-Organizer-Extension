// lib/settings.js
// One `settings` key in chrome.storage.sync holds everything the popup edits.
// Shared by the background (via import) and the popup (as a module script).
import { TAXONOMY, OTHER_GROUP, UNAVAILABLE_GROUP } from './taxonomy.js';
import { getProvider, PROVIDERS } from './providers.js';
import { SORT_DEFAULTS, normalizeSortOptions } from './sort.js';

export const SETTINGS_KEY = 'settings';
export const MAX_NEW_CATEGORIES_LIMIT = 10;

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: '',
  taxonomy: [...TAXONOMY],
  maxNewCategories: 2,
  extraInstructions: '',
  sort: { ...SORT_DEFAULTS },
});

const RESERVED = new Set([OTHER_GROUP, UNAVAILABLE_GROUP].map(n => n.toLowerCase()));

function coerceTaxonomy(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const name = String(item ?? '').trim();
    // sort.js folds group names case-insensitively, so two spellings of one
    // category would collapse into a single group anyway.
    const key = name.toLowerCase();
    // "Other" and "Unavailable" are groups the sorter appends itself; listing
    // them as categories would place the same group twice.
    if (!name || seen.has(key) || RESERVED.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.length > 0 ? out : [...TAXONOMY];
}

function coerceMaxNew(raw) {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_SETTINGS.maxNewCategories;
  return Math.min(MAX_NEW_CATEGORIES_LIMIT, Math.max(0, n));
}

export function normalizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const provider = getProvider(source.provider) || getProvider(DEFAULT_SETTINGS.provider) || PROVIDERS[0];
  const baseUrl = String(source.baseUrl ?? '').trim().replace(/\/+$/, '');
  const model = String(source.model ?? '').trim();
  return {
    provider: provider.id,
    apiKey: String(source.apiKey ?? '').trim(),
    baseUrl: baseUrl || provider.baseUrl,
    model: model || provider.defaultModel,
    taxonomy: coerceTaxonomy(source.taxonomy ?? DEFAULT_SETTINGS.taxonomy),
    maxNewCategories: coerceMaxNew(source.maxNewCategories ?? DEFAULT_SETTINGS.maxNewCategories),
    extraInstructions: String(source.extraInstructions ?? '').trim(),
    sort: normalizeSortOptions(source.sort),
  };
}

export async function loadSettings(storage = chrome.storage.sync) {
  const data = await storage.get([SETTINGS_KEY, 'apiKey']);
  if (data[SETTINGS_KEY]) return normalizeSettings(data[SETTINGS_KEY]);

  // Versions before the provider picker stored only a top-level Anthropic key.
  if (typeof data.apiKey === 'string' && data.apiKey) {
    const migrated = normalizeSettings({ provider: 'anthropic', apiKey: data.apiKey });
    await storage.set({ [SETTINGS_KEY]: migrated });
    await storage.remove('apiKey');
    return migrated;
  }

  return normalizeSettings({});
}

export async function saveSettings(partial, storage = chrome.storage.sync) {
  const current = await loadSettings(storage);
  const merged = { ...current, ...partial };
  // A provider switch must not inherit the previous provider's URL or model.
  if (partial.provider && partial.provider !== current.provider) {
    if (!('baseUrl' in partial)) merged.baseUrl = '';
    if (!('model' in partial)) merged.model = '';
  }
  const next = normalizeSettings(merged);
  await storage.set({ [SETTINGS_KEY]: next });
  return next;
}
