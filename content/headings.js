// content/headings.js
// Depends on: content/selectors.js, content/storage.js

const WLHeadings = {
  IN_PROGRESS_LABEL: '▶ In Progress',
  ATTRIBUTE: 'data-wl-heading',

  _observer: null,
  _boundaries: [],
  _debounce: null,

  /** One entry per group, naming the video that starts it. */
  boundariesFrom(sortOrder) {
    const boundaries = [];
    let currentName = undefined;

    for (const video of sortOrder) {
      const name = video.cluster === null ? this.IN_PROGRESS_LABEL : video.cluster;
      if (name !== currentName) {
        boundaries.push({ videoId: video.id, name });
        currentName = name;
      }
    }
    return boundaries;
  },

  /** Order-independent fingerprint of the video set. */
  hashIds(videos) {
    return videos.map(v => v.id).sort().join(',');
  },
};
