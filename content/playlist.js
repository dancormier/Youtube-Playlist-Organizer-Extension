// content/playlist.js
// Depends on: content/innertube.js (loaded first via manifest)

const WLPlaylist = {
  browseIdFor(playlistId) {
    return playlistId === 'WL' ? 'VLWL' : `VL${playlistId}`;
  },

  /** First text run anywhere under `field`, or null. */
  _text(field) {
    if (!field) return null;
    const runs = WLInnerTube.findAll(field, 'text');
    return runs.length ? String(runs[0]) : null;
  },

  /**
   * Turn a playlistVideoRenderer into a Video.
   * Returns null when there is no setVideoId — reorder is impossible without it.
   */
  normalize(renderer) {
    if (!renderer || !renderer.setVideoId) return null;

    const title = this._text(renderer.title);
    const resume = WLInnerTube.findAll(renderer, 'percentDurationWatched');

    return {
      id: renderer.videoId || '',
      setVideoId: renderer.setVideoId,
      title: title || '[Unavailable]',
      channel: this._text(renderer.shortBylineText) || 'Unknown',
      duration: Number(renderer.lengthSeconds) || 0,
      percentWatched: resume.length ? Number(resume[0]) : 0,
      category: null,
      description: null,
      unavailable: !title,
    };
  },

  async read(playlistId) {
    const pages = await WLInnerTube.pageAll({ browseId: this.browseIdFor(playlistId) });

    const videos = [];
    const seen = new Set();

    for (const page of pages) {
      for (const renderer of WLInnerTube.findAll(page, 'playlistVideoRenderer')) {
        const video = this.normalize(renderer);
        if (!video || seen.has(video.setVideoId)) continue;
        seen.add(video.setVideoId);
        videos.push(video);
      }
    }
    return videos;
  },

  /**
   * Chain each entry after its predecessor. Every action MUST carry an anchor —
   * an action with neither predecessor nor successor is a silent no-op that
   * still returns STATUS_SUCCEEDED.
   */
  buildMoveActions(ordered) {
    if (ordered.length < 2) return [];

    return ordered.map((setVideoId, index) =>
      index === 0
        ? {
            action: 'ACTION_MOVE_VIDEO_BEFORE',
            setVideoId,
            movedSetVideoIdSuccessor: ordered[1],
          }
        : {
            action: 'ACTION_MOVE_VIDEO_AFTER',
            setVideoId,
            movedSetVideoIdPredecessor: ordered[index - 1],
          }
    );
  },

  async _currentOrder(playlistId) {
    const videos = await this.read(playlistId);
    return videos.map(v => v.setVideoId);
  },

  /**
   * Apply an order in one call, then poll until it is visible.
   * Reads are cached server-side, so an immediate read returns stale data.
   */
  async applyOrder(playlistId, ordered, { timeoutMs = 10000, intervalMs = 800 } = {}) {
    const actions = this.buildMoveActions(ordered);
    if (actions.length === 0) return { applied: true, waitedMs: 0 };

    await WLInnerTube.call('browse/edit_playlist', { playlistId, actions });

    const target = ordered.join(',');
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const current = await this._currentOrder(playlistId);
      if (current.join(',') === target) {
        return { applied: true, waitedMs: Date.now() - started };
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return { applied: false, waitedMs: Date.now() - started };
  },
};
