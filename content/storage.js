// content/storage.js
// Typed wrapper over chrome.storage.local.
//
// Overrides are intentionally global rather than per-playlist: an override says
// "YouTube's watch data for this video is wrong", which is true regardless of
// which list you are viewing it from.

const WLStorage = {
  async getOverrides() {
    const data = await chrome.storage.local.get('unwatchedOverrides');
    return data.unwatchedOverrides || [];
  },

  async toggleOverride(videoId) {
    const current = await this.getOverrides();
    const next = current.includes(videoId)
      ? current.filter(id => id !== videoId)
      : [...current, videoId];

    await chrome.storage.local.set({ unwatchedOverrides: next });
    return next;
  },

  async getGroupMap() {
    const data = await chrome.storage.local.get('groupMap');
    return data.groupMap || {};
  },

  async setGroupMap(map) {
    await chrome.storage.local.set({ groupMap: map });
  },
};
