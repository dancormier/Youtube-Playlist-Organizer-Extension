// content/panel.js
// Depends on: content/selectors.js, content/scraper.js

const WLPanel = {
  panel: null,
  currentSortOrder: [],
  lastVideoHash: null,
  _analyseCancelled: false,

  inject() {
    if (document.querySelector('#wl-organizer-panel')) return;

    const anchorResult = findAnchor();
    if (!anchorResult) return;

    const panel = document.createElement('div');
    panel.id = 'wl-organizer-panel';
    panel.innerHTML = `
      <!-- Idle state: just a button -->
      <div id="wl-state-idle">
        <button class="wl-yt-btn" id="wl-analyze-btn"><svg class="wl-btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>Analyze & sort</button>
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
        <button class="wl-yt-btn wl-cancel-inline" id="wl-sort-cancel-btn">Cancel</button>
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

  /**
   * Hash video IDs to detect list changes.
   */
  hashVideoIds(videos) {
    return videos.map(v => v.id).sort().join(',');
  },

  bindEvents() {
    // Analyze
    this.$('#wl-analyze-btn').addEventListener('click', async () => {
      this._analyseCancelled = false;
      this.showState('analyzing');
      this.$('#wl-analyze-status').textContent = 'Scanning videos...';

      const isWatchLater = location.search.includes('list=WL');

      try {
        const videos = await WLScraper.scrapeAll();
        if (this._analyseCancelled) return;

        if (!videos || videos.length === 0) {
          this.showError('No videos found on this playlist.');
          return;
        }

        // Check if list has changed since last analysis
        const hash = this.hashVideoIds(videos);
        if (hash === this.lastVideoHash && this.currentSortOrder.length > 0) {
          this.$('#wl-analyze-status').textContent = 'List unchanged — using cached results.';
          await new Promise(r => setTimeout(r, 800));
          if (this._analyseCancelled) return;
          this.renderPreview(this.currentSortOrder);
          this.showState('preview');
          return;
        }

        let result;
        if (isWatchLater) {
          this.$('#wl-analyze-status').textContent = 'Categorizing with AI...';
          result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos });
        } else {
          this.$('#wl-analyze-status').textContent = 'Sorting by duration...';
          result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos });
        }
        if (this._analyseCancelled) return;

        if (!result.success) {
          this.showError(result.error);
          return;
        }

        this.lastVideoHash = hash;
        this.renderPreview(result.sortOrder);
        this.showState('preview');
      } catch (err) {
        if (!this._analyseCancelled) this.showError(err.message);
      }
    });

    // Cancel analyze
    this.$('#wl-analyze-cancel-btn').addEventListener('click', () => {
      this._analyseCancelled = true;
      this.showState('idle');
    });

    // Apply sort
    this.$('#wl-apply-btn').addEventListener('click', async () => {
      this.showState('sorting');
      const targetOrder = this.currentSortOrder.map(v => v.id);

      const result = await WLReorder.reorder(targetOrder, (current, total) => {
        const pct = (current / total) * 100;
        this.$('#wl-sort-progress').style.width = `${pct}%`;
        this.$('#wl-sort-count').textContent = `${current} / ${total} videos moved`;
      });

      if (result.cancelled) {
        this.showIdleWithMessage('Sort cancelled.');
        return;
      }

      if (result && result.moved > 0) {
        let msg = 'Sort complete.';
        if (result.failed.length > 0) {
          msg += ` ${result.failed.length} video${result.failed.length > 1 ? 's' : ''} could not be found.`;
        }
        this.showIdleWithMessage(msg);
      } else {
        this.showError('Sort failed. Try refreshing the page and sorting again.');
      }
    });

    // Cancel sort
    this.$('#wl-sort-cancel-btn').addEventListener('click', () => {
      WLReorder.cancel();
    });

    // Cancel preview
    this.$('#wl-cancel-btn').addEventListener('click', () => {
      this.currentSortOrder = [];
      this.lastVideoHash = null;
      this.showState('idle');
    });

    // Retry
    this.$('#wl-retry-btn').addEventListener('click', () => this.showState('idle'));
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
        ? `${this.formatDuration(Math.round(video.duration * (1 - video.progress)))} left`
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
};

// Inject panel when page is ready
function findAnchor() {
  // Watch Later page
  const wlAnchor = document.querySelector('.thumbnail-and-metadata-wrapper.style-scope.ytd-playlist-header-renderer');
  if (wlAnchor) {
    const rect = wlAnchor.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { el: wlAnchor, position: 'after' };
  }

  // Regular playlists — append inside the sidebar header's flexible actions
  const sidebarFlexActions = document.querySelector('.page-header-sidebar yt-flexible-actions-view-model');
  if (sidebarFlexActions) return { el: sidebarFlexActions, position: 'inside' };

  return null;
}

// Handle YouTube SPA navigation — re-inject panel when URL changes
let lastUrl = location.href;

function checkAndInject() {
  if (!location.pathname.startsWith('/playlist')) return;
  if (!document.querySelector('#wl-organizer-panel')) {
    const anchor = findAnchor();
    if (anchor) {
      WLPanel.inject();
    }
  }
}

// Observe DOM changes to detect both initial render and SPA navigations
const pageObserver = new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    // URL changed — remove old panel if present, reset state
    const oldPanel = document.querySelector('#wl-organizer-panel');
    if (oldPanel) oldPanel.remove();
    WLPanel.panel = null;
    WLPanel.currentSortOrder = [];
    WLPanel.lastVideoHash = null;
  }
  checkAndInject();
});

pageObserver.observe(document.body, { childList: true, subtree: true });
checkAndInject();
