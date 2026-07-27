// content/panel.js
// Depends on: content/selectors.js, content/innertube.js, content/playlist.js, content/enrich.js, content/modal.js, content/storage.js, content/headings.js

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
      onHideHeadings: () => this.hideHeadings(),
    });
  },

  /**
   * Remove the headings and stop them coming back. Clearing the stored group
   * map is the part that makes this stick — without it, restoreHeadings()
   * re-injects everything on the next page load.
   */
  async hideHeadings() {
    WLHeadings.stop();
    WLHeadings.clear();
    WLModal.close();
    try {
      await WLStorage.setGroupMap({});
    } catch (err) {
      console.warn('WLPanel: failed to clear the stored group map; headings will return on reload', err);
    }
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

  /**
   * Recompute against cached clusters. Never re-calls Claude.
   *
   * Captures (does not bump) the run token: this belongs to the session already
   * in progress, not a new one, so it must not invalidate a concurrent runSort().
   * The check exists because navigating away (resetForNavigation() bumps _runId)
   * while this is in flight must stop it from painting a stale order over
   * whatever session owns the modal by the time it resolves.
   */
  async toggleUnwatched(videoId) {
    const runId = this._runId;
    WLModal.setStatus('Re-sorting...');

    try {
      const overrides = await WLStorage.toggleOverride(videoId);
      if (runId !== this._runId) return;

      const result = await chrome.runtime.sendMessage({
        type: 'RESORT', overrides, playlistId: this.currentPlaylistId,
      });
      if (runId !== this._runId) return;

      if (!result.success) { WLModal.showError(result.error); return; }

      this.currentSortOrder = result.sortOrder;
      WLModal.showPreview(result.sortOrder);
    } catch (err) {
      // The modal invokes this fire-and-forget, so an uncaught rejection here
      // is invisible to the user — the everyday trigger is "Extension context
      // invalidated" after an extension reload, which would otherwise leave
      // the modal stuck on "Re-sorting..." forever.
      if (runId === this._runId) WLModal.showError(err.message);
    }
  },

  /**
   * Captures (does not bump) the run token, for the same reason as
   * toggleUnwatched(): a superseded apply must not reload the page — or even
   * announce success into the modal — out from under a newer session.
   */
  async applySort() {
    const runId = this._runId;
    const playlistId = this.currentPlaylistId;
    const orderedSetVideoIds = this.currentSortOrder.map(v => v.setVideoId);

    // Uninterruptible from here: applyOrder() sends the reorder immediately, so
    // "cancelling" would only hide the modal and skip the reload while the
    // playlist changed underneath.
    WLModal.showBusy(`Applying ${orderedSetVideoIds.length} moves...`, { cancellable: false });

    let result;
    try {
      result = await WLPlaylist.applyOrder(playlistId, orderedSetVideoIds);
    } catch (err) {
      if (runId === this._runId) WLModal.showError(err.message);
      return;
    }
    if (runId !== this._runId) return;

    if (result.applied) {
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
          await WLStorage.setGroupMap({});
        }
      } catch (err) {
        console.warn('WLPanel: failed to persist group map; headings may be stale after reload', err);
      }
      // Re-check ownership: the await above is a window resetForNavigation()'s
      // synchronous _runId bump can land in, same as every other await in this
      // method. Without this, a navigate-away mid-persist would still announce
      // "Sort complete" and reload the page the user already left.
      if (runId !== this._runId) return;

      WLModal.showBusy(`Sort complete in ${(result.waitedMs / 1000).toFixed(1)}s. Refreshing...`, { cancellable: false });
      // YouTube's DOM does not reflect the reordered playlist, so a successful
      // sort otherwise looks like nothing happened. Re-check ownership inside
      // the callback itself, not just when scheduling it — the 1.2s window is
      // long enough for the user to click into a video and navigate away, and
      // without this the timer would reload the page they just opened.
      setTimeout(() => { if (runId === this._runId) location.reload(); }, 1200);
    } else {
      WLModal.showError('Sort was sent but the new order did not appear. Reload and check the playlist.');
    }
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
    WLHeadings.watch(stored.boundaries);
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

  WLPanel.restoreHeadings();
}

function resetForNavigation() {
  WLPanel._runId++;
  WLPanel.currentSortOrder = [];
  WLPanel.currentPlaylistId = null;
  WLModal.close();
  WLInnerTube.resetConfig();
  WLHeadings.stop();
  WLHeadings.clear();
  WLPanel._headingsRestoredFor = null;
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
// 2026-07-27; see docs/HANDOFF.md.
