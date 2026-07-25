// background/service-worker.js
import { categorizeVideos } from '../lib/classify.js';
import { buildSortOrder, buildDurationSortOrder } from '../lib/sort.js';

// Switch icon to active (red) on YouTube, default (gray) elsewhere
const ICON_DEFAULT = { 16: '/icons/icon16.png', 48: '/icons/icon48.png', 128: '/icons/icon128.png' };
const ICON_ACTIVE = { 16: '/icons/active/icon16.png', 48: '/icons/active/icon48.png', 128: '/icons/active/icon128.png' };

function updateIcon(tabId, url) {
  const path = (url && url.includes('youtube.com')) ? ICON_ACTIVE : ICON_DEFAULT;
  chrome.action.setIcon({ tabId, path }).catch(() => {});
}

// Update on navigation and tab switch
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIcon(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateIcon(tabId, tab.url);
  } catch {}
});

// Update all existing tabs on service worker startup
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    updateIcon(tab.id, tab.url);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    handleAnalyze(message.videos, message.mode).then(sendResponse);
    return true;
  }

  if (message.type === 'SORT_BY_DURATION') {
    const sortOrder = buildDurationSortOrder(message.videos);
    sendResponse({ success: true, sortOrder });
    return true;
  }

  if (message.type === 'GET_SORT_STATE') {
    chrome.storage.local.get('sortState', (data) => {
      sendResponse(data.sortState || null);
    });
    return true;
  }
});

async function handleAnalyze(videos) {
  try {
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (!apiKey) {
      return { success: false, error: 'No API key configured. Open settings to add your Claude API key.' };
    }

    const unwatched = videos.filter(v => v.progress === 0);
    const clusters = await categorizeVideos(apiKey, unwatched);
    const sortOrder = buildSortOrder(videos, clusters);

    await chrome.storage.local.set({
      sortState: {
        videos,
        clusters,
        sortOrder,
        timestamp: Date.now(),
      },
    });

    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
