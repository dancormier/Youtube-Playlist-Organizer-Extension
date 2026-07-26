// content/panel.js
// Depends on: content/selectors.js, content/innertube.js, content/playlist.js, content/enrich.js

const WLPanel = {
  panel: null,
  currentSortOrder: [],
  // Monotonic run token. Each runSort() call takes ownership by bumping this and
  // capturing the new value; every async checkpoint inside that run compares its
  // captured id back against the live counter. Cancelling, starting a different
  // mode, or navigating away all bump the counter, so a stale run's checkpoints
  // see a mismatch and stop rendering into a panel they no longer own. A single
  // boolean couldn't express this: resetting it for one run silently un-cancels
  // any other in-flight run.
  _runId: 0,

  inject() {
    if (document.querySelector('#wl-organizer-panel')) return;

    const anchorResult = this.findAnchor();
    if (!anchorResult) return;

    const panel = document.createElement('div');
    panel.id = 'wl-organizer-panel';
    panel.innerHTML = `
      <!-- Idle state -->
      <div id="wl-state-idle">
        <div class="wl-idle-actions">
          <button class="wl-yt-btn wl-btn-filled" id="wl-analyze-btn"><svg class="wl-btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>Analyze &amp; sort</button>
          <button class="wl-yt-btn" id="wl-duration-btn">Sort by duration</button>
        </div>
        <p id="wl-idle-message" class="wl-text-secondary wl-hidden"></p>
      </div>

      <!-- Analyzing state -->
      <div id="wl-state-analyzing" class="wl-hidden">
        <p class="wl-text" id="wl-analyze-status">Analyzing videos...</p>
        <div class="wl-progress-bar"><div class="wl-progress-fill wl-indeterminate" id="wl-analyze-progress"></div></div>
        <button class="wl-yt-btn wl-cancel-inline" id="wl-analyze-cancel-btn">Cancel</button>
      </div>

      <!-- Preview state -->
      <div id="wl-state-preview" class="wl-hidden">
        <div class="wl-expanded">
          <h3 class="wl-heading">Proposed Sort Order</h3>
          <div id="wl-preview-list"></div>
          <div class="wl-btn-row">
            <button class="wl-yt-btn wl-btn-filled" id="wl-apply-btn">Apply Sort</button>
            <button class="wl-yt-btn" id="wl-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Sorting state -->
      <div id="wl-state-sorting" class="wl-hidden">
        <p class="wl-text">Sorting your Watch Later...</p>
        <div class="wl-progress-bar"><div class="wl-progress-fill" id="wl-sort-progress"></div></div>
        <p id="wl-sort-count" class="wl-text-count">0 / 0 videos moved</p>
      </div>

      <!-- Error state -->
      <div id="wl-state-error" class="wl-hidden">
        <p id="wl-error-msg" class="wl-text-error"></p>
        <button class="wl-yt-btn" id="wl-retry-btn">Try Again</button>
      </div>
    `;

    if (anchorResult.position === 'inside') {
      anchorResult.el.appendChild(panel);
    } else {
      anchorResult.el.parentNode.insertBefore(panel, anchorResult.el.nextSibling);
    }
    // Tag the panel with the playlist it was built for. checkAndInject() uses this
    // to self-heal when navigation reset was skipped (e.g. yt-navigate-finish firing
    // before location.href updates) rather than depending on lastUrl tracking alone.
    panel.dataset.wlPlaylist = new URL(location.href).searchParams.get('list') || '';
    this.panel = panel;
    this.bindEvents();
  },

  $(sel) {
    return this.panel.querySelector(sel);
  },

  showState(name) {
    const states = ['idle', 'analyzing', 'preview', 'sorting', 'error'];
    for (const s of states) {
      const el = this.$(`#wl-state-${s}`);
      if (el) el.classList.toggle('wl-hidden', s !== name);
    }
  },

  bindEvents() {
    // Analyze / sort mode selection
    this.$('#wl-analyze-btn').addEventListener('click', () => this.runSort('ai'));
    this.$('#wl-duration-btn').addEventListener('click', () => this.runSort('duration'));

    // Cancel analyze
    this.$('#wl-analyze-cancel-btn').addEventListener('click', () => {
      this._runId++;
      this.showState('idle');
    });

    // Apply sort
    this.$('#wl-apply-btn').addEventListener('click', () => this.applySort());

    // Cancel preview
    this.$('#wl-cancel-btn').addEventListener('click', () => {
      this.currentSortOrder = [];
      this.showState('idle');
    });

    // Retry
    this.$('#wl-retry-btn').addEventListener('click', () => this.showState('idle'));
  },

  async applySort() {
    this.showState('sorting');

    const playlistId = new URL(location.href).searchParams.get('list');
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    this.$('#wl-sort-count').textContent = `Applying ${orderedSetVideoIds.length} moves...`;
    this.$('#wl-sort-progress').style.width = '50%';

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
    } catch (err) {
      this.showError(err.message);
      return;
    }

    this.$('#wl-sort-progress').style.width = '100%';

    if (result.applied) {
      this.showIdleWithMessage(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`);
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened. Pause briefly so the
      // confirmation is readable, then reload.
      setTimeout(() => location.reload(), 1200);
    } else {
      this.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
    }
  },

  /**
   * @param {'ai'|'duration'} mode
   * 'duration' sorts locally and never calls Claude — no API key needed, and it
   * skips enrichment entirely since nothing consumes the metadata.
   */
  async runSort(mode) {
    const runId = ++this._runId;
    this.showState('analyzing');
    this.$('#wl-analyze-status').textContent = 'Scanning videos...';

    try {
      const playlistId = new URL(location.href).searchParams.get('list');
      if (!playlistId) {
        this.showError('No playlist found in the URL.');
        return;
      }

      const videos = await WLPlaylist.read(playlistId);
      if (runId !== this._runId) return;

      if (!videos || videos.length === 0) {
        this.showError('No videos found on this playlist.');
        return;
      }

      let result;
      if (mode === 'ai') {
        this.$('#wl-analyze-status').textContent = 'Fetching video details...';
        await WLEnrich.enrich(videos);
        if (runId !== this._runId) return;

        this.$('#wl-analyze-status').textContent = 'Categorizing with AI...';
        result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos, playlistId });
      } else {
        this.$('#wl-analyze-status').textContent = 'Sorting by duration...';
        result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos });
      }
      if (runId !== this._runId) return;

      if (!result.success) {
        this.showError(result.error);
        return;
      }

      this.renderPreview(result.sortOrder);
      this.showState('preview');
    } catch (err) {
      // A superseded run (cancelled, mode-switched, or navigated away from) must not
      // paint an error over whatever the current run has already rendered.
      if (runId === this._runId) this.showError(err.message);
    }
  },

  renderPreview(sortOrder) {
    this.currentSortOrder = sortOrder;
    const list = this.$('#wl-preview-list');
    list.innerHTML = '';

    let currentCluster = undefined;

    for (const video of sortOrder) {
      const clusterName = video.cluster;

      if (clusterName !== currentCluster) {
        currentCluster = clusterName;
        const label = document.createElement('div');
        label.className = clusterName === null ? 'wl-cluster-label wl-in-progress' : 'wl-cluster-label wl-topic';
        label.textContent = clusterName === null ? '\u25B6 In Progress' : clusterName;
        list.appendChild(label);
      }

      const item = document.createElement('div');
      item.className = 'wl-preview-item';

      const title = document.createElement('span');
      title.className = 'wl-preview-title';
      title.textContent = video.title;

      const meta = document.createElement('span');
      meta.className = 'wl-preview-meta';
      meta.textContent = video.cluster === null
        ? `${this.formatDuration(Math.round(video.duration * (1 - video.percentWatched / 100)))} left`
        : this.formatDuration(video.duration);

      item.appendChild(title);
      item.appendChild(meta);
      list.appendChild(item);
    }
  },

  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  showIdleWithMessage(msg) {
    this.showState('idle');
    const msgEl = this.$('#wl-idle-message');
    msgEl.textContent = msg;
    msgEl.classList.remove('wl-hidden');
    setTimeout(() => { msgEl.classList.add('wl-hidden'); }, 5000);
  },

  showError(msg) {
    this.$('#wl-error-msg').textContent = msg;
    this.showState('error');
  },

  scrollToPanel() {
    if (this.panel) {
      this.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  /**
   * Locate where the panel should mount.
   * Deliberately does NOT check layout: on Watch Later the header exists before
   * it is laid out, and treating a 0x0 rect as "absent" meant the panel never
   * appeared until some unrelated mutation retriggered injection.
   */
  findAnchor() {
    const wlAnchor = document.querySelector(
      '.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer'
    );
    if (wlAnchor) return { el: wlAnchor, position: 'after' };

    const sidebarFlexActions = document.querySelector(
      '.page-header-sidebar yt-flexible-actions-view-model'
    );
    if (sidebarFlexActions) return { el: sidebarFlexActions, position: 'inside' };

    return null;
  },
};

function checkAndInject() {
  if (!location.pathname.startsWith('/playlist')) return false;

  const existing = document.querySelector('#wl-organizer-panel');
  if (existing) {
    // Self-heal against event-ordering: normally resetForNavigation() clears the
    // panel before this runs, but yt-navigate-finish can fire before location.href
    // updates, and a missed reset here would silently bind to the wrong playlist
    // (and skip WLInnerTube.resetConfig(), risking edits sent to a stale account).
    const currentPlaylistId = new URL(location.href).searchParams.get('list') || '';
    if (existing.dataset.wlPlaylist !== currentPlaylistId) {
      resetForNavigation();
    } else {
      return true;
    }
  }

  if (WLPanel.findAnchor()) {
    WLPanel.inject();
    return true;
  }
  return false;
}

/**
 * Poll briefly for the anchor. Mutation events alone are not enough: YouTube can
 * finish rendering in a batch we already processed, and once the page settles no
 * further mutations arrive, so a missed injection is never retried.
 */
function injectWithRetry({ intervalMs = 300, timeoutMs = 15000 } = {}) {
  if (checkAndInject()) return;

  const started = Date.now();
  const timer = setInterval(() => {
    if (checkAndInject()) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - started > timeoutMs) {
      clearInterval(timer);
      console.warn(`[WL Organizer] Gave up waiting for a mount anchor after ${timeoutMs}ms — no anchor found on ${location.href}`);
    }
  }, intervalMs);
}

function resetForNavigation() {
  const oldPanel = document.querySelector('#wl-organizer-panel');
  if (oldPanel) oldPanel.remove();
  WLPanel.panel = null;
  WLPanel.currentSortOrder = [];
  // Invalidate any run still in flight for the old playlist so it cannot render
  // into (or Apply against) the freshly-reset panel once it resolves.
  WLPanel._runId++;
  WLInnerTube.resetConfig();
}

let lastUrl = location.href;

const pageObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
    injectWithRetry();
    return;
  }
  checkAndInject();
});

pageObserver.observe(document.body, { childList: true, subtree: true });

// YouTube fires this after SPA navigation completes — more reliable than
// inferring navigation from mutations alone.
window.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  injectWithRetry();
});

injectWithRetry();
