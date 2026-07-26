// content/headings.js
// Depends on: content/selectors.js, content/storage.js

const WLHeadings = {
  IN_PROGRESS_LABEL: '▶ In Progress',
  ATTRIBUTE: 'data-wl-heading',

  _observer: null,
  _boundaries: [],
  _debounce: null,

  /** One entry per group, naming the video that starts it and how many it holds. */
  boundariesFrom(sortOrder) {
    const boundaries = [];
    let current = null;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (!current || current.name !== name) {
        current = { videoId: video.id, name, count: 0 };
        boundaries.push(current);
      }
      current.count++;
    }
    return boundaries;
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

  /**
   * Insert a heading before the first item of each group.
   * Idempotent — an existing heading for a group is left alone, so this can be
   * re-run freely as YouTube appends more items.
   */
  inject(boundaries) {
    let placed = 0;

    for (const { videoId, name, count } of boundaries) {
      const item = this._itemFor(videoId);
      if (!item) continue;

      const previous = item.previousElementSibling;
      if (previous && previous.getAttribute?.(this.ATTRIBUTE) === name) {
        placed++;
        continue;
      }

      item.parentNode.insertBefore(this._build(name, count || 0), item);
      placed++;
    }
    return placed;
  },

  clear() {
    for (const heading of document.querySelectorAll(`[${this.ATTRIBUTE}]`)) {
      heading.remove();
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

    const container = document.querySelector(SELECTORS.PLAYLIST_ITEMS)?.parentNode;
    if (!container) return;

    this._observer = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves, or the observer re-triggers forever.
      const ours = mutations.every(m =>
        [...m.addedNodes].every(n => n.nodeType === 1 && n.hasAttribute?.(this.ATTRIBUTE))
      );
      if (ours) return;

      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.inject(this._boundaries), 200);
    });

    this._observer.observe(container, { childList: true });
  },

  stop() {
    this._observer?.disconnect();
    this._observer = null;
    clearTimeout(this._debounce);
    this._debounce = null;
  },
};
