// content/storage.js
// Typed wrapper over chrome.storage.local.
//
// Overrides are intentionally global rather than per-playlist: an override says
// "YouTube's watch data for this video is wrong", which is true regardless of
// which list you are viewing it from.

const WLStorage = {
  _queue: Promise.resolve(),

  async getOverrides() {
    const data = await chrome.storage.local.get('unwatchedOverrides');
    return data.unwatchedOverrides || [];
  },

  toggleOverride(videoId) {
    this._queue = this._queue.then(async () => {
      const current = await this.getOverrides();
      const next = current.includes(videoId)
        ? current.filter(id => id !== videoId)
        : [...current, videoId];

      await chrome.storage.local.set({ unwatchedOverrides: next });
      return next;
    }).catch((err) => {
      // Reset queue on error so subsequent mutations can proceed
      this._queue = Promise.resolve();
      throw err;
    });
    return this._queue;
  },

  async getGroupMap() {
    const data = await chrome.storage.local.get('groupMap');
    return data.groupMap || {};
  },

  setGroupMap(map) {
    this._queue = this._queue.then(async () => {
      await chrome.storage.local.set({ groupMap: map });
    }).catch((err) => {
      // Reset queue on error so subsequent mutations can proceed
      this._queue = Promise.resolve();
      throw err;
    });
    return this._queue;
  },
};
