// background/service-worker.js
import { categorizeVideos, listModels } from '../lib/classify.js';
import { buildSortOrder, buildDurationSortOrder } from '../lib/sort.js';
import { loadSettings, normalizeSettings } from '../lib/settings.js';
import { getProvider } from '../lib/providers.js';

// The toolbar icon is per-tab: it turns red on tabs whose content script has
// announced itself (YT_PAGE) and stays gray everywhere else, so no `tabs`
// permission is needed to watch navigation.
const ICON_ACTIVE = { 16: '/icons/active/icon16.png', 48: '/icons/active/icon48.png', 128: '/icons/active/icon128.png' };
const ICON_DEFAULT = { 16: '/icons/icon16.png', 48: '/icons/icon48.png', 128: '/icons/icon128.png' };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    handleAnalyze(message.videos, message.playlistId).then(sendResponse);
    return true;
  }

  if (message.type === 'RESORT') {
    handleResort(message.overrides, message.playlistId).then(sendResponse);
    return true;
  }

  if (message.type === 'SORT_BY_DURATION') {
    sendResponse({ success: true, sortOrder: buildDurationSortOrder(message.videos) });
    return true;
  }

  if (message.type === 'GET_SORT_STATE') {
    chrome.storage.local.get('sortState', (data) => sendResponse(data.sortState || null));
    return true;
  }

  if (message.type === 'YT_PAGE' || message.type === 'YT_LEAVE') {
    const tabId = sender?.tab?.id;
    const path = message.type === 'YT_PAGE' ? ICON_ACTIVE : ICON_DEFAULT;
    if (tabId !== undefined) chrome.action.setIcon({ tabId, path }).catch(() => {});
    return false;
  }

  if (message.type === 'LIST_MODELS') {
    handleListModels(message.settings).then(sendResponse);
    return true;
  }
});

async function handleAnalyze(videos, playlistId) {
  try {
    const settings = await loadSettings();
    const provider = getProvider(settings.provider);
    if (provider.needsKey && !settings.apiKey) {
      return { success: false, error: "No API key configured. Open the extension's settings." };
    }

    const { unwatchedOverrides = [] } = await chrome.storage.local.get('unwatchedOverrides');

    const classifiable = videos.filter(v => !v.unavailable);
    const clusters = await categorizeVideos(settings, classifiable);
    const sortOrder = buildSortOrder(videos, clusters, unwatchedOverrides, settings.taxonomy);

    await chrome.storage.local.set({
      cachedClusters: { playlistId, clusters, videos },
      sortState: { videos, clusters, sortOrder, timestamp: Date.now() },
    });

    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Re-sort using cached clusters. Never calls the model — watch state does not change grouping. */
async function handleResort(overrides, playlistId) {
  try {
    const { cachedClusters } = await chrome.storage.local.get('cachedClusters');
    if (!cachedClusters) {
      return { success: false, error: 'No cached analysis. Run Analyze first.' };
    }
    if (cachedClusters.playlistId !== playlistId) {
      return { success: false, error: 'Cached analysis belongs to a different playlist. Run Analyze again.' };
    }

    const settings = await loadSettings();
    await chrome.storage.local.set({ unwatchedOverrides: overrides });
    const sortOrder = buildSortOrder(cachedClusters.videos, cachedClusters.clusters, overrides, settings.taxonomy);

    await chrome.storage.local.set({
      sortState: { videos: cachedClusters.videos, clusters: cachedClusters.clusters, sortOrder, timestamp: Date.now() },
    });

    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Uses the settings the popup sends, not the saved ones, so a key can be tried before saving. */
async function handleListModels(rawSettings) {
  try {
    const models = await listModels(normalizeSettings(rawSettings));
    return { success: true, models };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
