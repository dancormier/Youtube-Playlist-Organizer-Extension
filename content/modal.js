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
};
