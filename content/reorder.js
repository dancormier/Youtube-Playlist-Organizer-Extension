// content/reorder.js
// Depends on: content/selectors.js

const WLReorder = {
  _cancelled: false,

  cancel() {
    this._cancelled = true;
  },

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  findItem(videoId) {
    const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);
    for (const item of items) {
      const link = item.querySelector(SELECTORS.VIDEO_LINK);
      if (!link) continue;
      const href = link.getAttribute('href') || '';
      if (href.includes(videoId)) return item;
    }
    return null;
  },

  async moveToTop(item, videoId) {
    const menuBtn = item.querySelector(SELECTORS.MENU_BUTTON);
    if (!menuBtn) return false;

    menuBtn.click();
    await this.sleep(300);

    const popup = document.querySelector('tp-yt-iron-dropdown[style*="display"]:not([style*="display: none"])') ||
                  document.querySelector('ytd-popup-container tp-yt-paper-listbox');
    const menuContainer = popup || document;
    const menuItems = menuContainer.querySelectorAll(SELECTORS.MOVE_TO_TOP);
    let moveToTopItem = null;
    for (const mi of menuItems) {
      if (mi.textContent.includes('Move to top')) {
        moveToTopItem = mi;
        break;
      }
    }

    if (!moveToTopItem) {
      document.body.click();
      await this.sleep(200);
      return false;
    }

    moveToTopItem.click();
    await this.waitForPosition(videoId, 0, 5000);
    return true;
  },

  /**
   * Wait until a video appears at the expected position in the playlist DOM.
   * Polls every 200ms up to the timeout.
   * @param {string} videoId
   * @param {number} expectedIndex - 0-based position
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async waitForPosition(videoId, expectedIndex, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);
      if (items.length > expectedIndex) {
        const link = items[expectedIndex].querySelector(SELECTORS.VIDEO_LINK);
        if (link && (link.getAttribute('href') || '').includes(videoId)) {
          return true;
        }
      }
      await this.sleep(200);
    }
    return false;
  },

  async reorder(targetOrder, onProgress) {
    this._cancelled = false;
    const total = targetOrder.length;
    let moved = 0;
    const failed = [];

    for (let i = total - 1; i >= 0; i--) {
      if (this._cancelled) {
        return { moved, failed, cancelled: true };
      }

      const videoId = targetOrder[i];
      const item = this.findItem(videoId);

      if (!item) {
        failed.push(videoId);
        continue;
      }

      item.scrollIntoView({ behavior: 'instant', block: 'center' });
      await this.sleep(200);

      if (this._cancelled) {
        return { moved, failed, cancelled: true };
      }

      const success = await this.moveToTop(item, videoId);
      if (success) {
        moved++;
      } else {
        failed.push(videoId);
      }

      onProgress(total - i, total);
    }

    return { moved, failed, cancelled: false };
  },
};
