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

  // `includes`, not equality: the chip and the menu items may carry hidden
  // helper text around the label, and no other sort's label contains this word.
  isManual(label) {
    return typeof label === 'string' && label.replace(/\s+/g, ' ').trim().toLowerCase().includes(this.MANUAL_LABEL);
  },

  // Closed dropdowns can keep their items in the DOM; prefer one that is laid out.
  _visible(el) {
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  },

  /** The laid-out "Manual" menu item, or null: a closed dropdown's item would swallow the click. */
  _manualItem() {
    return [...document.querySelectorAll(SELECTORS.SORT_MENU_ITEMS)]
      .find(el => this.isManual(el.textContent) && this._visible(el)) || null;
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
   *   whose menu never offered "Manual" (a non-English UI, or a markup change)
   *   and a click that did not take; 'no-chip' a page without the chip at all
   *   (a markup change). The caller decides whether to go on.
   */
  async ensureManual({ timeoutMs = 5000 } = {}) {
    const chip = this.chip();
    if (!chip) return 'no-chip';
    if (this.isManual(chip.textContent)) return 'manual';

    chip.click();
    const item = await this._waitFor(() => this._manualItem(), 2000);
    if (!item) {
      // Leave the page as we found it: the chip toggles its own menu.
      chip.click();
      return 'failed';
    }

    item.click();
    const switched = await this._waitFor(() => this.isManual(this.current()), timeoutMs);
    return switched ? 'switched' : 'failed';
  },
};
