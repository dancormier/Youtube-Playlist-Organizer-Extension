// content/scraper.js
// Depends on: content/selectors.js (loaded before this script via manifest)

const WLScraper = {
  async scrollToLoadAll() {
    let lastHeight = 0;
    let retries = 0;
    const maxRetries = 20;

    while (retries < maxRetries) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight === lastHeight) {
        retries++;
        if (retries >= 3) break;
      } else {
        retries = 0;
        lastHeight = newHeight;
      }
    }
    window.scrollTo(0, 0);
  },

  parseDuration(durationStr) {
    const parts = durationStr.trim().split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  },

  getProgress(item) {
    const bar = item.querySelector(SELECTORS.PROGRESS_BAR);
    if (!bar) return 0;
    const style = bar.getAttribute('style') || '';
    const match = style.match(/width:\s*([\d.]+)%/);
    return match ? parseFloat(match[1]) / 100 : 0;
  },

  extractVideoId(href) {
    try {
      const url = new URL(href, 'https://www.youtube.com');
      return url.searchParams.get('v') || '';
    } catch {
      return '';
    }
  },

  async scrapeAll() {
    await this.scrollToLoadAll();

    const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);
    const videos = [];

    for (const item of items) {
      const titleEl = item.querySelector(SELECTORS.VIDEO_TITLE);
      const channelEl = item.querySelector(SELECTORS.CHANNEL_NAME);
      const thumbnailEl = item.querySelector(SELECTORS.THUMBNAIL);
      const linkEl = item.querySelector(SELECTORS.VIDEO_LINK);
      const durationEl = item.querySelector(SELECTORS.DURATION);

      if (!titleEl || !linkEl) continue;

      const href = linkEl.getAttribute('href') || '';
      const id = this.extractVideoId(href);
      if (!id) continue;

      videos.push({
        id,
        title: titleEl.textContent.trim(),
        channel: channelEl ? channelEl.textContent.trim() : 'Unknown',
        thumbnailUrl: thumbnailEl ? thumbnailEl.getAttribute('src') || '' : '',
        videoUrl: `https://www.youtube.com/watch?v=${id}`,
        duration: durationEl ? this.parseDuration(durationEl.textContent) : 0,
        progress: this.getProgress(item),
      });
    }

    return videos;
  },
};
