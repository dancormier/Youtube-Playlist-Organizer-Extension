// content/headings.js
// Depends on: content/selectors.js, content/storage.js

const WLHeadings = {
  IN_PROGRESS_LABEL: '▶ In Progress',
  ATTRIBUTE: 'data-wl-heading',
  ANCHOR_CLASS: 'wl-group-anchor',

  _observer: null,
  _boundaries: [],
  _debounce: null,

  /**
   * One entry per group, naming the video that starts it and how many it holds.
   * A video with no `cluster` property at all (duration mode — see
   * lib/sort.js's buildDurationSortOrder) gets no heading, mirroring
   * WLModal.toGroups's handling of the same case.
   */
  boundariesFrom(sortOrder) {
    const boundaries = [];
    let current = null;

    for (const video of sortOrder) {
      if (!('cluster' in video)) continue;
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (!current || current.name !== name) {
        current = { videoId: video.id, name, count: 0 };
        boundaries.push(current);
      }
      current.count++;
    }
    return boundaries;
  },

  /** True when any of our headings are currently in the page. */
  present() {
    return document.querySelectorAll(`[${this.ATTRIBUTE}]`).length > 0;
  },

  /** Order-independent fingerprint of the video set. */
  hashIds(videos) {
    return videos.map(v => v.id).sort().join(',');
  },

  _itemFor(videoId) {
    for (const item of document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS)) {
      const link = item.querySelector(SELECTORS.VIDEO_LINK);
      if (link && (link.getAttribute('href') || '').includes(videoId)) return item;
    }
    return null;
  },

  _build(name, count) {
    const heading = document.createElement('h2');
    heading.className = name === this.IN_PROGRESS_LABEL
      ? 'wl-playlist-heading wl-in-progress'
      : 'wl-playlist-heading';
    heading.setAttribute(this.ATTRIBUTE, name);

    const label = document.createElement('span');
    label.textContent = name;
    heading.appendChild(label);

    if (count > 0) {
      const counter = document.createElement('span');
      counter.className = 'wl-heading-count';
      counter.textContent = `${count} video${count === 1 ? '' : 's'}`;
      heading.appendChild(counter);
    }
    return heading;
  },

  /** The already-injected heading for a group, wherever it currently sits, or null. */
  _headingFor(name) {
    for (const heading of document.querySelectorAll(`[${this.ATTRIBUTE}]`)) {
      if (heading.getAttribute(this.ATTRIBUTE) === name) return heading;
    }
    return null;
  },

  /**
   * Put each group's heading INSIDE that group's first item, never beside it.
   *
   * Headings used to be siblings of ytd-playlist-video-renderer inside
   * DIV#contents. That broke YouTube's drag-to-reorder: handleDragMove_ caches
   * one rect per child of the sortable container and indexes it by child
   * position, so a foreign sibling made an index resolve to undefined and threw
   * `can't access property "top"` on every mousemove. Measured 2026-07-27.
   * Polymer also wiped the foreign siblings on its own re-render mid-drag.
   *
   * The renderer has no shadow root, so a light-DOM child renders normally. It
   * is absolutely positioned into a margin-top gap on the anchor item (see
   * styles/headings.css), which keeps it out of the item's internal flex row.
   *
   * Idempotent by identity, not position — if a group's heading already exists
   * anywhere in the list it is moved into place rather than duplicated, so this
   * self-heals after a re-render and can be re-run freely as YouTube appends
   * more items. appendChild() moves an existing node rather than copying it.
   */
  inject(boundaries) {
    let placed = 0;

    for (const { videoId, name, count } of boundaries) {
      const item = this._itemFor(videoId);
      if (!item) continue;

      const existing = this._headingFor(name);
      const heading = existing || this._build(name, count || 0);
      if (heading.parentNode !== item) item.appendChild(heading);
      item.classList.add(this.ANCHOR_CLASS);
      placed++;
    }
    return placed;
  },

  /**
   * Remove every injected heading and cancel any debounced re-injection in
   * flight. Cancelling the debounce matters: without it, a mutation that landed
   * just before clear() runs could fire its queued inject() afterward and put
   * the headings straight back with stale boundaries. Safe to call whether or
   * not watch() has an observer running — leaves that alone; use stop() for that.
   */
  clear() {
    clearTimeout(this._debounce);
    this._debounce = null;
    this._boundaries = [];

    for (const heading of document.querySelectorAll(`[${this.ATTRIBUTE}]`)) {
      heading.remove();
    }
    // The anchor class carries the margin-top that opened the gap for the
    // heading. Leaving it behind would strand that gap on an item with nothing
    // in it — visible as a blank band in the list.
    for (const item of document.querySelectorAll(`.${this.ANCHOR_CLASS}`)) {
      item.classList.remove(this.ANCHOR_CLASS);
    }
  },

  /**
   * Inject now, then keep injecting as YouTube lazily appends items.
   * Debounced because a playlist render fires many mutations in a burst.
   */
  watch(boundaries) {
    this._boundaries = boundaries;
    this.stop();
    this.inject(boundaries);

    this._observer = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves, or the observer re-triggers forever.
      // A batch counts as "ours" only if it added at least one node, removed
      // none, and every added node is one of our own headings — `.every()` on
      // an empty addedNodes list (a removal-only batch) is vacuously true, so
      // that case must be excluded explicitly or removals are silently ignored.
      const ours = mutations.every(m =>
        m.addedNodes.length > 0 &&
        m.removedNodes.length === 0 &&
        [...m.addedNodes].every(n => n.nodeType === 1 && n.hasAttribute?.(this.ATTRIBUTE))
      );
      if (ours) return;

      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.inject(this._boundaries), 200);
    });

    // Observe from document.body, not a resolved playlist container: on first
    // load the playlist hasn't rendered yet, so querying for its container
    // would find nothing and silently skip attaching the observer entirely.
    this._observer.observe(document.body, { childList: true, subtree: true });
  },

  stop() {
    this._observer?.disconnect();
    this._observer = null;
    clearTimeout(this._debounce);
    this._debounce = null;
  },
};
