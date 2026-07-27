// content/modal.js
// The extension's entire preview UI. Owns no sorting logic — renders state and
// emits callbacks. Deliberately not anchored to any YouTube element.

const WLModal = {
  IN_PROGRESS_LABEL: '▶ In Progress',

  _root: null,
  _lastFocused: null,
  _handlers: {},
  _keyHandler: null,

  /**
   * Collapse a flat sort order into consecutive runs sharing a cluster.
   * A video with no `cluster` property at all (duration mode) yields a group
   * named null, which renders without a heading.
   */
  toGroups(sortOrder) {
    const groups = [];
    let current = null;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL
        : video.cluster === undefined ? null
        : video.cluster;

      if (!current || current.name !== name) {
        current = { name, videos: [] };
        groups.push(current);
      }
      current.videos.push(video);
    }
    return groups;
  },

  formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  },

  metaFor(video) {
    if (video.unavailable) return 'unavailable';
    if (video.cluster === null) {
      const pct = Number(video.percentWatched) || 0;
      return `${this.formatDuration(video.duration * (1 - pct / 100))} left`;
    }
    return this.formatDuration(video.duration);
  },

  // ── Trigger ────────────────────────────────────────────────────────────

  /**
   * Idempotent: safe to call on every navigation.
   * @returns {boolean} true when it created the element, false when one already existed.
   */
  mountTrigger({ onOpen }) {
    if (document.querySelector('#wl-trigger')) return false;

    const button = document.createElement('button');
    button.id = 'wl-trigger';
    button.className = 'wl-trigger';
    button.type = 'button';
    button.setAttribute('aria-label', 'Organize this playlist');
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>Organize`;
    button.addEventListener('click', () => onOpen());

    document.body.appendChild(button);
    return true;
  },

  removeTrigger() {
    document.querySelector('#wl-trigger')?.remove();
  },

  /** Diagnostic: is the trigger present, and did our stylesheet actually apply? */
  verifyTrigger() {
    const el = document.querySelector('#wl-trigger');
    if (!el) return { present: false };

    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    return {
      present: true,
      connected: el.isConnected,
      position: style ? style.position : 'unknown',
      zIndex: style ? style.zIndex : 'unknown',
      visible: style ? style.display !== 'none' && style.visibility !== 'hidden' : 'unknown',
    };
  },

  // ── Modal shell ────────────────────────────────────────────────────────

  open(handlers = {}) {
    this.close();
    this._handlers = handlers;
    this._lastFocused = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'wl-modal-backdrop';
    backdrop.innerHTML = `
      <div class="wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-modal-title">
        <div class="wl-modal-header">
          <h2 class="wl-modal-title" id="wl-modal-title">Organize playlist</h2>
          <span class="wl-modal-status" id="wl-modal-status"></span>
        </div>
        <div class="wl-modal-body" id="wl-modal-body"></div>
        <div class="wl-modal-footer" id="wl-modal-footer"></div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this._root = backdrop;

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this._cancel();
    });

    this._keyHandler = (event) => {
      if (event.key === 'Escape') { this._cancel(); return; }
      if (event.key === 'Tab') this._trapFocus(event);
    };
    document.addEventListener('keydown', this._keyHandler, true);

    this.showModes();
  },

  _cancel() {
    this.close();
    this._handlers.onCancel?.();
  },

  /** Keep Tab inside the dialog — required for WCAG 2.1 AA. */
  _trapFocus(event) {
    const focusable = this._root.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  _body() { return this._root?.querySelector('#wl-modal-body'); },
  _footer() { return this._root?.querySelector('#wl-modal-footer'); },

  setStatus(text) {
    const status = this._root?.querySelector('#wl-modal-status');
    if (status) status.textContent = text;
  },

  // ── States ─────────────────────────────────────────────────────────────

  showModes() {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    this.setStatus('');
    body.textContent = '';
    footer.textContent = '';

    const wrap = document.createElement('div');
    wrap.className = 'wl-mode-choice';

    const ai = document.createElement('button');
    ai.className = 'wl-mode-btn';
    ai.type = 'button';
    ai.innerHTML = `Analyze &amp; sort<small>Groups videos by topic using Claude. Needs an API key. Takes a few seconds.</small>`;
    ai.addEventListener('click', () => this._handlers.onSort?.('ai'));

    const duration = document.createElement('button');
    duration.className = 'wl-mode-btn';
    duration.type = 'button';
    duration.innerHTML = `Sort by duration<small>Shortest first. Instant, no API key needed.</small>`;
    duration.addEventListener('click', () => this._handlers.onSort?.('duration'));

    wrap.append(ai, duration);
    body.appendChild(wrap);

    // Only offered when there is something to hide. WLHeadings loads after this
    // file, but this runs at click time, long after every content script is in.
    if (WLHeadings.present()) {
      const hide = document.createElement('button');
      hide.className = 'wl-modal-btn';
      hide.type = 'button';
      hide.textContent = 'Hide group headings';
      hide.addEventListener('click', () => this._handlers.onHideHeadings?.());
      footer.appendChild(hide);
    }

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => this._cancel());
    footer.appendChild(cancel);

    ai.focus();
  },

  showBusy(text) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    body.textContent = '';
    footer.textContent = '';

    const label = document.createElement('p');
    label.textContent = text;

    const bar = document.createElement('div');
    bar.className = 'wl-progress-bar';
    bar.innerHTML = `<div class="wl-progress-fill"></div>`;

    body.append(label, bar);

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._cancel());
    footer.appendChild(cancel);
    cancel.focus();
  },

  showPreview(sortOrder) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    this.setStatus('');
    body.textContent = '';
    footer.textContent = '';

    for (const group of this.toGroups(sortOrder)) {
      if (group.name !== null) {
        const heading = document.createElement('h3');
        heading.className = group.name === this.IN_PROGRESS_LABEL
          ? 'wl-group-heading wl-in-progress'
          : 'wl-group-heading';
        heading.textContent = group.name;
        body.appendChild(heading);
      }
      for (const video of group.videos) body.appendChild(this._renderItem(video));
    }

    const apply = document.createElement('button');
    apply.className = 'wl-modal-btn wl-primary';
    apply.type = 'button';
    apply.textContent = 'Apply Sort';
    apply.addEventListener('click', () => this._handlers.onApply?.());

    const cancel = document.createElement('button');
    cancel.className = 'wl-modal-btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._cancel());

    footer.append(apply, cancel);
    apply.focus();
  },

  _renderItem(video) {
    const row = document.createElement('div');
    row.className = video.unavailable ? 'wl-modal-item wl-unavailable' : 'wl-modal-item';

    const title = document.createElement('span');
    title.className = 'wl-item-title';
    title.textContent = video.title;

    const meta = document.createElement('span');
    meta.className = 'wl-item-meta';
    meta.textContent = this.metaFor(video);

    row.append(title, meta);

    // Offer the toggle only where it can help: videos YouTube considers watched.
    if (!video.unavailable && video.percentWatched > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'wl-unwatch-btn';
      toggle.type = 'button';
      toggle.textContent = 'Unwatched';
      toggle.setAttribute('aria-pressed', String(video.cluster !== null));
      toggle.setAttribute('aria-label', `Treat "${video.title}" as unwatched`);
      toggle.addEventListener('click', () => this._handlers.onToggleUnwatched?.(video.id));
      row.appendChild(toggle);
    }
    return row;
  },

  showError(message) {
    const body = this._body();
    const footer = this._footer();
    if (!body) return;

    body.textContent = '';
    footer.textContent = '';

    const error = document.createElement('p');
    error.className = 'wl-modal-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    body.appendChild(error);

    const back = document.createElement('button');
    back.className = 'wl-modal-btn';
    back.type = 'button';
    back.textContent = 'Try Again';
    back.addEventListener('click', () => this.showModes());

    const close = document.createElement('button');
    close.className = 'wl-modal-btn';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this._cancel());

    footer.append(back, close);
    back.focus();
  },

  close() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this._root?.remove();
    this._root = null;

    // The element that had focus when the modal opened may have since been
    // removed from the DOM — routine on an SPA like YouTube that re-renders
    // its header constantly. Focusing a detached node is a silent no-op, so
    // fall back to the trigger (where the user came from) rather than
    // stranding focus on <body>.
    const restoreTarget = this._lastFocused?.isConnected
      ? this._lastFocused
      : document.querySelector('#wl-trigger');
    restoreTarget?.focus?.();
    this._lastFocused = null;
  },
};
