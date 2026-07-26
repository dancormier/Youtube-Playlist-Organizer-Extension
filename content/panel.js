// content/panel.js
// Depends on: content/selectors.js, content/innertube.js, content/playlist.js, content/enrich.js, content/modal.js, content/storage.js

const WLPanel = {
  _runId: 0,
  currentSortOrder: [],
  currentPlaylistId: null,

  openModal() {
    WLModal.open({
      onSort: (mode) => this.runSort(mode),
      onApply: () => this.applySort(),
      onCancel: () => { this._runId++; this.currentSortOrder = []; },
      onToggleUnwatched: (videoId) => this.toggleUnwatched(videoId),
    });
  },

  /**
   * @param {'ai'|'duration'} mode
   * 'duration' sorts locally and never calls Claude — no API key needed, and it
   * skips enrichment since nothing consumes the metadata.
   */
  async runSort(mode) {
    const runId = ++this._runId;

    try {
      const playlistId = new URL(location.href).searchParams.get('list');
      if (!playlistId) { WLModal.showError('No playlist found in the URL.'); return; }
      this.currentPlaylistId = playlistId;

      WLModal.showBusy('Reading playlist...');
      const videos = await WLPlaylist.read(playlistId);
      if (runId !== this._runId) return;

      if (!videos || videos.length === 0) {
        WLModal.showError('No videos found on this playlist.');
        return;
      }

      let result;
      if (mode === 'ai') {
        WLModal.showBusy('Fetching video details...');
        await WLEnrich.enrich(videos);
        if (runId !== this._runId) return;

        WLModal.showBusy('Categorizing with AI...');
        result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos, playlistId });
      } else {
        WLModal.showBusy('Sorting by duration...');
        result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos });
      }
      if (runId !== this._runId) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      WLModal.showPreview(result.sortOrder);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
    }
  },

  /** Recompute against cached clusters. Never re-calls Claude. */
  async toggleUnwatched(videoId) {
    WLModal.setStatus('Re-sorting...');

    const overrides = await WLStorage.toggleOverride(videoId);
    const result = await chrome.runtime.sendMessage({
      type: 'RESORT', overrides, playlistId: this.currentPlaylistId,
    });

    if (!result.success) { WLModal.showError(result.error); return; }

    this.currentSortOrder = result.sortOrder;
    WLModal.showPreview(result.sortOrder);
  },

  async applySort() {
    const playlistId = this.currentPlaylistId;
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    WLModal.showBusy(`Applying ${orderedSetVideoIds.length} moves...`);

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
    } catch (err) {
      WLModal.showError(err.message);
      return;
    }

    if (result.applied) {
      WLModal.showBusy(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened.
      setTimeout(() => location.reload(), 1200);
    } else {
      WLModal.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
    }
  },
};

function onPlaylistPage() {
  return location.pathname.startsWith('/playlist') &&
         Boolean(new URL(location.href).searchParams.get('list'));
}

/**
 * The trigger is a fixed-position element we own, so there is no YouTube
 * selector to wait for and nothing to retry — mount it whenever we are on a
 * playlist page, remove it when we are not.
 */
function syncTrigger() {
  if (onPlaylistPage()) {
    WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
  } else {
    WLModal.removeTrigger();
    WLModal.close();
  }
}

function resetForNavigation() {
  WLPanel._runId++;
  WLPanel.currentSortOrder = [];
  WLModal.close();
  WLInnerTube.resetConfig();
}

let lastUrl = location.href;

const pageObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger();
});

pageObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger();
});

syncTrigger();
