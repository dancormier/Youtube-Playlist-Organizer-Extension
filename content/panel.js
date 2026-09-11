// content/panel.js
// Depends on: content/selectors.js, content/viewsort.js, content/innertube.js, content/playlist.js, content/enrich.js, content/modal.js, content/storage.js, content/headings.js

const WLPanel = {
  _runId: 0,
  _sortSeq: 0,
  currentSortOrder: [],
  currentPlaylistId: null,
  currentSortOptions: null,
  // The mode of the run that produced currentSortOrder; only 'ai' has a cached
  // analysis for RESORT to work from.
  currentMode: null,
  // 'shown' or 'hidden' while this playlist has stored headings, else null.
  // Drives the Show/Hide headings chip beside Organize.
  _headingsState: null,

  /**
   * Undo is offered only when the stored undo state belongs to this playlist.
   * The storage read is local and fast; a failure just opens without Undo.
   */
  async openModal() {
    const runId = this._runId;
    const playlistId = new URL(location.href).searchParams.get('list');
    let canUndo = false;
    try {
      const undo = await WLStorage.getUndo();
      canUndo = Array.isArray(undo.previous) && undo.playlistId === playlistId;
    } catch (err) {
      console.warn('WLPanel: failed to read the undo state', err);
    }
    // Navigating away during the read must not open a modal on the new page.
    if (runId !== this._runId) return;
    WLModal.open({
      onSort: (mode) => this.runSort(mode),
      onApply: () => this.applySort(),
      onUndo: () => this.undoSort(),
      onCancel: () => { this._runId++; this.currentSortOrder = []; this.currentMode = null; },
      onToggleUnwatched: (videoId) => this.toggleUnwatched(videoId),
      onSortOptionsChange: (sortOptions) => this.changeSortOptions(sortOptions),
    }, { canUndo });
  },

  _setHeadingsState(state) {
    this._headingsState = state;
    WLModal.syncHeadingsToggle(state, { onToggle: () => this.toggleHeadings() });
  },

  // The sort chip's label while the view was Manual, recorded with the group
  // map. Language-independent: whatever the label was, a different one means
  // the user picked another view sort.
  _viewSortLabel: null,

  _viewSortChanged() {
    if (!this._viewSortLabel) return false;
    const label = WLViewSort.current();
    return label !== null && label !== this._viewSortLabel;
  },

  /**
   * A view sort other than Manual reorders the list under the headings, so
   * the grouping no longer describes what is on screen: treat the sort as
   * having undone ours. Called from syncTrigger on every mutation batch, so
   * it is one querySelector when nothing is stored.
   */
  checkViewSort() {
    if (!this._headingsState || !this._viewSortChanged()) return;
    this._dropHeadings();
  },

  _dropHeadings() {
    WLHeadings.stop();
    WLHeadings.clear();
    this._viewSortLabel = null;
    this._setHeadingsState(null);
    WLStorage.setGroupMap({}).catch((err) => {
      console.warn('WLPanel: failed to clear the group map after a view sort change', err);
    });
  },

  /**
   * The chip beside Organize: hide the headings but keep the stored map, or
   * put them back. The `hidden` flag on the map makes the choice survive a
   * reload, where restoreHeadings() reads it.
   */
  async toggleHeadings() {
    const runId = this._runId;
    const playlistId = new URL(location.href).searchParams.get('list');
    let stored;
    try {
      stored = await WLStorage.getGroupMap();
    } catch (err) {
      console.warn('WLPanel: failed to read stored group map', err);
      return;
    }
    if (runId !== this._runId) return;
    if (!stored.boundaries || stored.playlistId !== playlistId) {
      this._setHeadingsState(null);
      return;
    }

    const hidden = this._headingsState === 'shown';
    if (hidden) {
      WLHeadings.stop();
      WLHeadings.clear();
    } else {
      WLHeadings.watch(stored.boundaries);
    }
    this._setHeadingsState(hidden ? 'hidden' : 'shown');
    try {
      await WLStorage.setGroupMap({ ...stored, hidden });
    } catch (err) {
      console.warn('WLPanel: failed to save the headings visibility; it will reset on reload', err);
    }
  },

  /**
   * @param {'ai'|'duration'|'title'|'channel'} mode
   * The non-AI modes sort locally and never call the model — no API key
   * needed, and they skip enrichment since nothing consumes the metadata.
   */
  async runSort(mode) {
    const runId = ++this._runId;
    this.currentMode = mode;

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
        WLModal.showBusy(`Sorting by ${mode}...`);
        result = await chrome.runtime.sendMessage({ type: 'SORT_BY_DURATION', videos, by: mode });
      }
      if (runId !== this._runId) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      this.currentSortOptions = result.sortOptions ?? null;
      WLModal.showPreview(result.sortOrder, this.currentSortOptions);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
    }
  },

  /**
   * Recompute against cached clusters. Never re-calls Claude.
   *
   * Captures (does not bump) the run token: this belongs to the session already
   * in progress, not a new one, so it must not invalidate a concurrent runSort().
   * The check exists because navigating away (resetForNavigation() bumps _runId)
   * while this is in flight must stop it from painting a stale order over
   * whatever session owns the modal by the time it resolves.
   *
   * Outside AI mode there is nothing to recompute: the background would answer
   * RESORT from the last AI run's cache and repaint a simple-sort preview with
   * that grouping.
   */
  async toggleUnwatched(videoId) {
    if (this.currentMode !== 'ai') return;
    const runId = this._runId;
    WLModal.setStatus('Re-sorting...');

    try {
      const overrides = await WLStorage.toggleOverride(videoId);
      if (runId !== this._runId) return;

      const result = await chrome.runtime.sendMessage({
        type: 'RESORT', overrides, playlistId: this.currentPlaylistId,
        sortOptions: this.currentSortOptions ?? undefined,
      });
      if (runId !== this._runId) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      this.currentSortOptions = result.sortOptions ?? this.currentSortOptions;
      WLModal.showPreview(result.sortOrder, this.currentSortOptions);
    } catch (err) {
      // The modal invokes this fire-and-forget, so an uncaught rejection here
      // is invisible to the user — the everyday trigger is "Extension context
      // invalidated" after an extension reload, which would otherwise leave
      // the modal stuck on "Re-sorting..." forever.
      if (runId === this._runId) WLModal.showError(err.message);
    }
  },

  /**
   * Re-sort the cached analysis with different options and remember them as
   * the default for next time. Same run-token discipline as toggleUnwatched():
   * this belongs to the session that owns the modal and never bumps _runId.
   * The overrides are deliberately not sent — the background keeps the stored
   * ones, so this cannot undo a "treat as unwatched" toggle in flight.
   */
  async changeSortOptions(sortOptions) {
    if (this.currentMode !== 'ai') return;
    const runId = this._runId;
    // Firefox fires `change` per arrow-key step, so replies can arrive out of
    // order; only the newest request may paint or persist.
    const seq = ++this._sortSeq;
    WLModal.setStatus('Re-sorting...');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'RESORT', sortOptions, playlistId: this.currentPlaylistId,
      });
      if (runId !== this._runId || seq !== this._sortSeq) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      this.currentSortOptions = result.sortOptions ?? sortOptions;
      WLModal.showPreview(result.sortOrder, this.currentSortOptions);

      // The preview is already correct; failing to remember the choice for next
      // time is not worth an error state in the modal.
      try {
        await WLStorage.setSortOptions(this.currentSortOptions);
      } catch (err) {
        console.warn('WLPanel: failed to save sort options; they will reset next time', err);
      }
    } catch (err) {
      if (runId === this._runId && seq === this._sortSeq) WLModal.showError(err.message);
    }
  },

  /**
   * Switch the view to Manual, then write `ordered` and wait for it to show.
   * Shared by applySort() and undoSort(). Captures (does not bump) the run
   * token: a superseded write must not announce anything into the modal.
   * @returns {{ result, viewSort, previous } | null} null when superseded or
   *   when the write threw (already shown as an error).
   */
  async _writeOrder(runId, playlistId, ordered) {
    // The reorder only shows through the Manual view (content/viewsort.js).
    // Still cancellable: nothing has been written yet.
    WLModal.showBusy('Checking the playlist sort...');
    let viewSort;
    try {
      viewSort = await WLViewSort.ensureManual();
    } catch (err) {
      console.warn('WLPanel: could not check the playlist sort', err);
      viewSort = 'failed';
    }
    if (runId !== this._runId) return null;

    // The order Undo falls back to, read right before the write: the session's
    // earlier read may predate a view switch or a drag the user made since.
    WLModal.showBusy('Reading playlist...');
    let previous;
    try {
      const videos = await WLPlaylist.read(playlistId);
      previous = videos.map(v => v.setVideoId);
    } catch (err) {
      console.warn('WLPanel: could not read the order before writing; Undo will be unavailable', err);
      previous = null;
    }
    if (runId !== this._runId) return null;

    // Uninterruptible from here: applyOrder() sends the reorder immediately, so
    // "cancelling" would only hide the modal and skip the reload while the
    // playlist changed underneath.
    WLModal.showBusy(`Applying ${ordered.length} moves...`, { cancellable: false });

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, ordered);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
      return null;
    }
    if (runId !== this._runId) return null;
    return { result, viewSort, previous };
  },

  /**
   * The write was sent but never read back, so the playlist's order is
   * unknown; an older undo record would restore the wrong thing.
   */
  async _writeNotApplied(runId, viewSort) {
    try {
      await WLStorage.setUndo({});
    } catch (err) {
      console.warn('WLPanel: failed to clear the undo state', err);
    }
    if (runId !== this._runId) return;
    // Anything but a confirmed Manual view is the likeliest cause, including
    // a chip the selector no longer finds.
    const manualUnconfirmed = viewSort !== 'manual' && viewSort !== 'switched';
    WLModal.showError(manualUnconfirmed
      ? 'Sort was sent but the new order did not appear. This playlist is not on Manual sort: pick Manual in the sort menu above the list, then try again.'
      : 'Sort was sent but the new order did not appear. Reload and check the playlist.');
  },

  /**
   * YouTube's DOM does not reflect the reordered playlist, so a successful
   * write otherwise looks like nothing happened. Ownership is re-checked
   * inside the callback itself, not just when scheduling it — the 1.2s window
   * is long enough for the user to click into a video and navigate away, and
   * without this the timer would reload the page they just opened.
   */
  _announceAndReload(runId, waitedMs) {
    WLModal.showBusy(`Sort complete in ${(waitedMs / 1000).toFixed(1)}s. Refreshing...`, { cancellable: false });
    setTimeout(() => { if (runId === this._runId) location.reload(); }, 1200);
  },

  async applySort() {
    const runId = this._runId;
    const playlistId = this.currentPlaylistId;
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    const written = await this._writeOrder(runId, playlistId, orderedSetVideoIds);
    if (!written) return;
    const { result, viewSort, previous } = written;

    if (!result.applied) {
      await this._writeNotApplied(runId, viewSort);
      return;
    }

    // Persist BEFORE the reload — the reload is what makes headings necessary,
    // and it destroys any in-memory state that isn't written first.
    // Headings are a convenience; the reorder above is the actual work and it
    // already succeeded — so a storage failure here must not block the reload
    // or leave the modal stuck. It gets its own try/catch rather than joining
    // the applyOrder one, and failure is logged but otherwise swallowed.
    // Duration-mode sorts yield an empty boundaries array (no `cluster` key
    // at all on any video — see WLHeadings.boundariesFrom).
    const boundaries = WLHeadings.boundariesFrom(this.currentSortOrder);
    try {
      if (boundaries.length > 0) {
        await WLStorage.setGroupMap({
          playlistId,
          boundaries,
          videoIdsHash: WLHeadings.hashIds(this.currentSortOrder),
          viewSortLabel: WLViewSort.current(),
        });
      } else {
        // The stored map must be CLEARED here, not left alone. Skipping the
        // write is not neutral: a previous AI sort's grouping survives it,
        // and restoreHeadings() then re-injects those headings after the
        // reload, scattered through the new duration order. Its staleness
        // check does not catch this — hashIds is order-independent, so
        // reordering the same set of videos never trips it.
        WLHeadings.stop();
        WLHeadings.clear();
        this._setHeadingsState(null);
        await WLStorage.setGroupMap({});
      }
    } catch (err) {
      console.warn('WLPanel: failed to persist group map; headings may be stale after reload', err);
    }
    // Same reasoning: Undo is a convenience over a write that already landed.
    try {
      await WLStorage.setUndo(previous ? { playlistId, previous, current: orderedSetVideoIds } : {});
    } catch (err) {
      console.warn('WLPanel: failed to persist the undo state', err);
    }
    // Re-check ownership: the awaits above are a window resetForNavigation()'s
    // synchronous _runId bump can land in, same as every other await in this
    // method. Without this, a navigate-away mid-persist would still announce
    // "Sort complete" and reload the page the user already left.
    if (runId !== this._runId) return;

    this._announceAndReload(runId, result.waitedMs);
  },

  /**
   * Put the playlist back in the order it had before the last apply. Headings
   * describe the order that is being undone, so the stored map goes with it.
   * Refuses unless the playlist still reads exactly as that apply left it: an
   * added or removed video means a stale setVideoId list, and a hand
   * reorder since is work Undo must not throw away.
   */
  async undoSort() {
    const runId = this._runId;
    const playlistId = new URL(location.href).searchParams.get('list');
    this.currentPlaylistId = playlistId;

    WLModal.showBusy('Reading playlist...');
    let undo;
    let videos;
    try {
      undo = await WLStorage.getUndo();
      if (runId !== this._runId) return;
      if (!Array.isArray(undo.previous) || undo.playlistId !== playlistId) {
        WLModal.showError('Nothing to undo for this playlist.');
        return;
      }
      videos = await WLPlaylist.read(playlistId);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
      return;
    }
    if (runId !== this._runId) return;

    const unchanged = Array.isArray(undo.current)
      && videos.length === undo.current.length
      && videos.every((v, i) => v.setVideoId === undo.current[i]);
    if (!unchanged) {
      try {
        await WLStorage.setUndo({});
      } catch (err) {
        console.warn('WLPanel: failed to clear a stale undo state', err);
      }
      if (runId === this._runId) {
        WLModal.showError('The playlist has changed since that sort, so it cannot be undone.');
      }
      return;
    }
    const written = await this._writeOrder(runId, playlistId, undo.previous);
    if (!written) return;
    const { result, viewSort } = written;

    if (!result.applied) {
      await this._writeNotApplied(runId, viewSort);
      return;
    }

    try {
      WLHeadings.stop();
      WLHeadings.clear();
      this._setHeadingsState(null);
      await WLStorage.setGroupMap({});
      await WLStorage.setUndo({});
    } catch (err) {
      console.warn('WLPanel: failed to clear state after undo', err);
    }
    if (runId !== this._runId) return;

    this._announceAndReload(runId, result.waitedMs);
  },

  _headingsRestoredFor: null,

  /**
   * Re-apply stored headings after a reload. Discards them when the playlist's
   * contents have changed, since stale groupings are worse than none.
   *
   * Called from syncTrigger(), which fires on every DOM mutation batch, so it
   * must do its work at most once per playlist — hence the guard. Without it
   * this would issue an InnerTube read per mutation. Note the guard is set
   * (above) before any of the awaits below: if a read or storage call fails,
   * it stays set for this playlistId, so restoration does not retry until the
   * next navigation resets it in resetForNavigation(). That is intentional —
   * retrying on every mutation batch is exactly what the guard exists to
   * prevent — but it does mean a transient failure costs the rest of this
   * page load's headings, not just one attempt.
   *
   * syncTrigger() calls this unawaited (fire-and-forget), so every await here
   * must not throw — an unhandled rejection is the only other outcome.
   */
  async restoreHeadings() {
    const runId = this._runId;
    const playlistId = new URL(location.href).searchParams.get('list');
    if (!playlistId || this._headingsRestoredFor === playlistId) return;
    this._headingsRestoredFor = playlistId;

    let stored;
    try {
      stored = await WLStorage.getGroupMap();
    } catch (err) {
      console.warn('WLPanel: failed to read stored group map', err);
      return;
    }
    if (runId !== this._runId) return;
    if (!stored.boundaries || stored.playlistId !== playlistId) return;

    let videos;
    try {
      videos = await WLPlaylist.read(playlistId);
    } catch {
      return; // Offline or API broken — headings simply don't restore.
    }
    if (runId !== this._runId) return;

    if (WLHeadings.hashIds(videos) !== stored.videoIdsHash) {
      try {
        await WLStorage.setGroupMap({});
      } catch (err) {
        console.warn('WLPanel: failed to clear stale group map', err);
      }
      return;
    }
    // Final re-check immediately before re-arming the observer: this is a
    // multi-page network call (WLPlaylist.read), and resetForNavigation() can
    // bump _runId at any point during it. Without this, a late continuation
    // could watch() with the previous playlist's boundaries, or re-attach a
    // document.body observer after navigating to a non-playlist page — one
    // that would then survive the rest of the session.
    if (runId !== this._runId) return;
    this._viewSortLabel = stored.viewSortLabel || null;
    if (this._viewSortChanged()) {
      this._dropHeadings();
      return;
    }
    if (stored.hidden) {
      this._setHeadingsState('hidden');
      return;
    }
    WLHeadings.watch(stored.boundaries);
    this._setHeadingsState('shown');
  },
};

function onPlaylistPage() {
  return location.pathname.startsWith('/playlist') &&
         Boolean(new URL(location.href).searchParams.get('list'));
}

const WL_LOG = '[WL]';

// Tracks whether the previous syncTrigger call found us on a playlist page,
// so the observer path (see below) can tell a steady state from a transition.
// `undefined` initially guarantees the very first call always looks like a
// transition and gets logged.
let lastOnPlaylistPage;

/**
 * The trigger is a fixed-position element we own, so there is no YouTube
 * selector to wait for and nothing to retry — mount it whenever we are on a
 * playlist page, remove it when we are not.
 *
 * The MutationObserver fires continuously for the life of a YouTube tab, on
 * every page, so logging unconditionally here would drown the one-shot paths
 * (load-time, navigation events, the backstop) under a wall of identical
 * "observer" lines — and calling WLModal.verifyTrigger() on every one of
 * those would mean a forced-layout getComputedStyle() read on every DOM
 * mutation while parked on a playlist page. So `source === 'observer'` calls
 * only log when something actually happened: the trigger was (re)created, or
 * the on-playlist-page/not-on-playlist-page state changed since the last
 * call. Everything else (the one-shot event sources, and every console.warn)
 * still logs unconditionally. Do not "fix" this back to logging every call.
 */
function syncTrigger(source) {
  let onPage;
  try {
    onPage = onPlaylistPage();
  } catch (err) {
    console.warn(WL_LOG, 'onPlaylistPage threw', { source, href: location.href }, err);
    return;
  }

  const stateChanged = onPage !== lastOnPlaylistPage;
  lastOnPlaylistPage = onPage;
  const noteworthy = source !== 'observer' || stateChanged;

  if (!onPage) {
    if (noteworthy) {
      console.info(WL_LOG, 'syncTrigger: not a playlist page', { source, href: location.href });
    }
    WLModal.removeTrigger();
    WLModal.close();
    WLHeadings.stop();
    WLHeadings.clear();
    return;
  }

  let created;
  try {
    created = WLModal.mountTrigger({ onOpen: () => WLPanel.openModal() });
  } catch (err) {
    console.warn(WL_LOG, 'mountTrigger threw', { source }, err);
    return;
  }

  if (noteworthy || created) {
    console.info(WL_LOG, 'syncTrigger: playlist page', {
      source,
      href: location.href,
      created,
      state: WLModal.verifyTrigger(),
    });
  }

  WLPanel.checkViewSort();
  WLModal.syncHeadingsToggle(WLPanel._headingsState, { onToggle: () => WLPanel.toggleHeadings() });
  WLPanel.restoreHeadings();
}

function resetForNavigation() {
  WLPanel._runId++;
  WLPanel.currentSortOrder = [];
  WLPanel.currentPlaylistId = null;
  WLPanel.currentSortOptions = null;
  WLPanel.currentMode = null;
  WLModal.close();
  WLInnerTube.resetConfig();
  WLHeadings.stop();
  WLHeadings.clear();
  WLPanel._headingsRestoredFor = null;
  WLPanel._headingsState = null;
  WLPanel._viewSortLabel = null;
}

let lastUrl = location.href;

console.info(WL_LOG, 'content script loaded', {
  href: location.href,
  readyState: document.readyState,
  hasBody: Boolean(document.body),
});

function onPageChange(source) {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetForNavigation();
  }
  syncTrigger(source);
}

const pageObserver = new MutationObserver(() => onPageChange('observer'));

try {
  pageObserver.observe(document.body, { childList: true, subtree: true });
} catch (err) {
  // H1: no body yet. Retry once the document is ready rather than dying here.
  console.warn(WL_LOG, 'observer attach failed; will retry on DOMContentLoaded', err);
  document.addEventListener('DOMContentLoaded', () => {
    try {
      pageObserver.observe(document.body, { childList: true, subtree: true });
      console.info(WL_LOG, 'observer attached on DOMContentLoaded');
    } catch (retryErr) {
      console.warn(WL_LOG, 'observer attach failed again', retryErr);
    }
  });
}

window.addEventListener('yt-navigate-finish', () => onPageChange('yt-navigate-finish'));
document.addEventListener('DOMContentLoaded', () => onPageChange('DOMContentLoaded'));
window.addEventListener('load', () => onPageChange('load'));

onPageChange('load-time');

// A 20s polling backstop used to live here. It was diagnostic scaffolding for
// "the trigger never mounts on page load", whose root cause turned out to be
// Firefox MV3 host permissions being opt-in — not a missed event path. Its
// secondary job (remount if something removes the trigger) is already covered
// by pageObserver, which fires on any mutation and calls syncTrigger. Removed
// 2026-07-27; see ARCHITECTURE.md.
