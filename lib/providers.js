// lib/providers.js
// Every provider is either Anthropic's Messages API or something that speaks
// the OpenAI chat-completions shape. `kind` picks the request builder in
// classify.js; everything else here is presentation for the popup.

export const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    defaultModel: 'claude-haiku-4-5-20251001',
    hint: 'Haiku is the small, cheap tier and is plenty for labelling titles.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    defaultModel: 'gpt-5-mini',
    hint: 'A "mini" or "nano" model keeps each run at a fraction of a cent.',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    hint: 'Uses Google\'s OpenAI-compatible endpoint; a "flash" model is the right tier.',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    defaultModel: 'anthropic/claude-haiku-4.5',
    hint: 'One key for many vendors; model ids are prefixed with the vendor name.',
    docsUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    defaultModel: 'llama3.2',
    hint: 'Runs on your machine; set OLLAMA_ORIGINS so the browser is allowed to call it.',
    docsUrl: 'https://ollama.com/download',
  },
  {
    id: 'custom',
    label: 'OpenAI-compatible (custom URL)',
    kind: 'openai',
    baseUrl: '',
    needsKey: true,
    defaultModel: '',
    hint: 'Any server that speaks the OpenAI chat-completions API; enter its base URL.',
    docsUrl: '',
  },
];

export const MODEL_GUIDANCE =
  "This task is labelling titles, so the provider's smallest current model is enough. " +
  "Pick the cheapest 'mini', 'flash', 'haiku' or similar tier; larger models cost more " +
  'and are not noticeably better here.';

export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

const SMALL_TIER = /haiku|mini|flash|nano|small|lite|8b|3b/i;

export function pickRecommended(models, provider) {
  if (!Array.isArray(models) || models.length === 0) return null;
  if (provider?.defaultModel && models.includes(provider.defaultModel)) return provider.defaultModel;
  return models.find(id => SMALL_TIER.test(id)) || models[0];
}
