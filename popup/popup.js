// popup/popup.js — settings UI. A module script so it can share lib/ with the
// background; build.sh copies lib/ into both dist layouts for this reason.
import { PROVIDERS, MODEL_GUIDANCE, getProvider, pickRecommended } from '../lib/providers.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings.js';
import { SORT_CHOICES } from '../lib/sort.js';

const $ = (sel) => document.querySelector(sel);

// --- Host permission -------------------------------------------------------
// Firefox MV3 treats declared `host_permissions` as opt-in: they are NOT
// granted at install, and the declared content script does not inject until
// the user allows the site. That is why the Organize button appeared only
// after clicking the toolbar button, which grants temporary access via
// `activeTab`. Chrome grants host_permissions at install, so `contains()`
// returns true there and this banner never renders.
const YT_PERMS = { origins: ['https://www.youtube.com/*'] };

function showBanner(text, showButton) {
  $('#perm-text').textContent = text;
  $('#grant-btn').hidden = !showButton;
  $('#perm-banner').hidden = false;
}

if (chrome.permissions) {
  chrome.permissions.contains(YT_PERMS, (granted) => {
    if (!granted) $('#perm-banner').hidden = false;
  });

  // `permissions.request()` must be called from a user input handler, so it
  // cannot be fired automatically when the popup opens.
  $('#grant-btn').addEventListener('click', () => {
    chrome.permissions.request(YT_PERMS, (granted) => {
      if (granted) {
        // The grant does not retroactively inject into tabs that are already
        // open, so a reload is genuinely required.
        showBanner('Granted. Reload any open YouTube tabs.', false);
      } else {
        showBanner('Not granted. The Organize button will not appear until you allow access.', true);
      }
    });
  });
}

// --- Settings form ---------------------------------------------------------
const els = {
  provider: $('#provider'),
  keyField: $('#key-field'),
  keyLink: $('#key-link'),
  apiKey: $('#api-key'),
  baseUrlField: $('#base-url-field'),
  baseUrl: $('#base-url'),
  modelSelect: $('#model-select'),
  modelText: $('#model-text'),
  loadModels: $('#load-models-btn'),
  guidance: $('#model-guidance'),
  hint: $('#provider-hint'),
  taxonomy: $('#taxonomy'),
  resetTaxonomy: $('#reset-taxonomy-btn'),
  maxNew: $('#max-new'),
  extra: $('#extra'),
  sort: {
    withinGroup: $('#sort-within-group'),
    groupOrder: $('#sort-group-order'),
  },
  // Two-valued, so a checkbox: checked is 'top', unchecked is 'within'.
  sortInProgress: $('#sort-in-progress'),
  save: $('#save-btn'),
  status: $('#status'),
};

const SHOW_URL_FOR = new Set(['custom', 'ollama']);
let statusTimer = null;

function setStatus(text, { sticky = false, error = false } = {}) {
  clearTimeout(statusTimer);
  els.status.textContent = text;
  els.status.classList.toggle('error', error);
  if (!sticky && text) statusTimer = setTimeout(() => { els.status.textContent = ''; }, 2000);
}

function selectedProvider() {
  return getProvider(els.provider.value) || PROVIDERS[0];
}

function currentModel() {
  return (els.modelText.hidden ? els.modelSelect.value : els.modelText.value).trim();
}

/** Fill the model select with `models`, keeping `current` selectable even if the API did not list it. */
function fillModels(models, current, recommended) {
  els.modelSelect.replaceChildren();
  const ids = [...models];
  if (current && !ids.includes(current)) ids.unshift(current);
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id === recommended ? `${id} (recommended)` : id;
    els.modelSelect.append(opt);
  }
  els.modelSelect.value = current || recommended || ids[0] || '';
  els.modelSelect.hidden = false;
  els.modelText.hidden = true;
}

/** Text-entry fallback for when the provider cannot list models. */
function useModelText(current) {
  els.modelText.value = current;
  els.modelText.hidden = false;
  els.modelSelect.hidden = true;
}

function formSettings() {
  const provider = selectedProvider();
  return {
    provider: provider.id,
    apiKey: els.apiKey.value.trim(),
    baseUrl: SHOW_URL_FOR.has(provider.id) ? els.baseUrl.value.trim() : '',
    model: currentModel(),
    taxonomy: els.taxonomy.value.split('\n'),
    maxNewCategories: els.maxNew.value,
    extraInstructions: els.extra.value,
    sort: {
      ...Object.fromEntries(Object.entries(els.sort).map(([key, el]) => [key, el.value])),
      inProgress: els.sortInProgress.checked ? 'top' : 'within',
    },
  };
}

function renderProviderFields(provider) {
  els.keyField.hidden = !provider.needsKey;
  els.keyLink.hidden = !provider.docsUrl;
  if (provider.docsUrl) els.keyLink.href = provider.docsUrl;
  els.baseUrlField.hidden = !SHOW_URL_FOR.has(provider.id);
  els.hint.textContent = provider.hint;
}

function render(settings) {
  els.provider.value = settings.provider;
  const provider = selectedProvider();
  renderProviderFields(provider);
  els.apiKey.value = settings.apiKey;
  els.baseUrl.value = settings.baseUrl;
  // Until the user loads the list, the select just shows the one saved model.
  fillModels(settings.model ? [settings.model] : [], settings.model, null);
  if (!settings.model) useModelText('');
  els.taxonomy.value = settings.taxonomy.join('\n');
  els.maxNew.value = settings.maxNewCategories;
  els.extra.value = settings.extraInstructions;
  for (const [key, el] of Object.entries(els.sort)) el.value = settings.sort[key];
  els.sortInProgress.checked = settings.sort.inProgress === 'top';
}

for (const p of PROVIDERS) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.label;
  els.provider.append(opt);
}
for (const [key, el] of Object.entries(els.sort)) {
  for (const { value, label } of SORT_CHOICES[key]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    el.append(opt);
  }
}
els.guidance.textContent = MODEL_GUIDANCE;

els.provider.addEventListener('change', () => {
  const provider = selectedProvider();
  renderProviderFields(provider);
  // A different provider means a different URL space and model namespace, so
  // the previous values would only ever be wrong.
  els.baseUrl.value = provider.baseUrl;
  els.baseUrl.placeholder = provider.id === 'custom' ? 'https://host/v1' : provider.baseUrl;
  if (provider.defaultModel) fillModels([provider.defaultModel], provider.defaultModel, provider.defaultModel);
  else useModelText('');
  setStatus('');
});

els.loadModels.addEventListener('click', async () => {
  const provider = selectedProvider();
  const before = currentModel();
  els.loadModels.disabled = true;
  setStatus('Loading models…', { sticky: true });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LIST_MODELS', settings: formSettings() });
    if (!response?.success) throw new Error(response?.error || 'No response from the background script.');
    if (response.models.length === 0) throw new Error('The provider returned no models.');
    const recommended = pickRecommended(response.models, provider);
    fillModels(response.models, before, recommended);
    if (!before && recommended) els.modelSelect.value = recommended;
    setStatus(`${response.models.length} models loaded.`);
  } catch (err) {
    useModelText(before);
    setStatus(`Could not load models: ${err.message} Type a model id instead.`, { sticky: true, error: true });
  } finally {
    els.loadModels.disabled = false;
  }
});

els.resetTaxonomy.addEventListener('click', () => {
  els.taxonomy.value = DEFAULT_SETTINGS.taxonomy.join('\n');
});

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const draft = formSettings();
  const provider = selectedProvider();
  if (provider.needsKey && !draft.apiKey) {
    setStatus('Enter an API key first.', { sticky: true, error: true });
    return;
  }
  if (provider.id === 'custom' && !draft.baseUrl) {
    setStatus('Enter the base URL of your OpenAI-compatible server.', { sticky: true, error: true });
    return;
  }
  if (!draft.model) {
    setStatus('Choose or type a model.', { sticky: true, error: true });
    return;
  }
  try {
    const saved = await saveSettings(draft);
    render(saved);
    setStatus('Saved.');
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, { sticky: true, error: true });
  }
});

loadSettings().then(render).catch((err) => {
  render({ ...DEFAULT_SETTINGS });
  setStatus(`Could not load settings: ${err.message}`, { sticky: true, error: true });
});
