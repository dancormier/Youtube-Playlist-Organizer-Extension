// content/viewsort.js
// Depends on: content/selectors.js
//
// The playlist page's own sort chip ("Manual ▾ / Date added ▾ / …"). The chip
// is a view preference YouTube keeps per playlist, and a reorder only shows
// through the Manual view: with any other sort selected the edit_playlist
// write succeeds, but every read keeps coming back in the view's order, so
// WLPlaylist.applyOrder never sees the new order and times out. No InnerTube
// endpoint for the preference has been identified, so this goes through the
// chip the way a user would.
//
// Labels are localised ("Manual", "Manuell", …), so the menu's FIRST entry is
// what counts as Manual: YouTube lists it first in every language. The sort
// menu is told apart from any other open dropdown by containing the chip's
// own current label. The English word is only a fast path that skips opening
// the menu.

const WLViewSort = {
  MANUAL_LABEL: 'manual',

  chip() {
    return document.querySelector(SELECTORS.SORT_CHIP);
  },

  /** The chip's current label, e.g. "Manual", or null when the page has no chip. */
  current() {
    const chip = this.chip();
    return chip ? (chip.textContent || '').trim() : null;
  },

  _normalize(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
  },

  // `includes`, not equality: the chip and the menu items may carry hidden
  // helper text around the label, and no other sort's label contains this word.
  isManual(label) {
    return typeof label === 'string' && this._normalize(label).toLowerCase().includes(this.MANUAL_LABEL);
  },

  // Closed dropdowns can keep their items in the DOM; only laid-out ones count.
  _visible(el) {
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  },

  /**
   * The open sort menu's entries, or null. Recognised by holding an entry
   * that reads as the chip's current label; a clicked-open item of some other
   * dropdown never does.
   */
  _sortMenu(chipLabel) {
    const items = [...document.querySelectorAll(SELECTORS.SORT_MENU_ITEMS)].filter(el => this._visible(el));
    if (items.length === 0) return null;
    const current = this._normalize(chipLabel);
    return items.some(el => this._normalize(el.textContent) === current) ? items : null;
  },

  async _waitFor(check, timeoutMs, intervalMs = 100) {
    const started = Date.now();
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() - started >= timeoutMs) return null;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },

  /**
   * Switch the page's sort to Manual when it is anything else.
   * @returns {'manual'|'switched'|'no-chip'|'failed'} 'failed' covers a chip
   *   whose menu never opened (a markup change) and a click that did not
   *   take; 'no-chip' a page without the chip at all. The caller decides
   *   whether to go on.
   */
  async ensureManual({ timeoutMs = 5000 } = {}) {
    const chip = this.chip();
    if (!chip) return 'no-chip';
    if (this.isManual(chip.textContent)) return 'manual';

    const before = this.current();
    chip.click();
    const items = await this._waitFor(() => this._sortMenu(before), 2000);
    if (!items) {
      // Leave the page as we found it: the chip toggles its own menu.
      chip.click();
      return 'failed';
    }

    const manual = items[0];
    const manualLabel = this._normalize(manual.textContent);
    if (manualLabel === this._normalize(before)) {
      chip.click();
      return 'manual';
    }
    manual.click();
    const switched = await this._waitFor(() => this._normalize(this.current()) === manualLabel, timeoutMs);
    return switched ? 'switched' : 'failed';
  },
};
