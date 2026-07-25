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
};
