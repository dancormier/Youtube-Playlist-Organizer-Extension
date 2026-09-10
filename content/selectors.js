// content/selectors.js
// YouTube DOM selectors. Only what the UI still needs — reordering no longer
// touches the DOM, so the action-menu selectors are gone.
const SELECTORS = {
  PLAYLIST_ITEMS: 'ytd-playlist-video-renderer',
  VIDEO_TITLE: '#video-title',
  VIDEO_LINK: 'a#video-title',
  // Where the Organize button lives, first match wins: the playlist's own
  // filter-chip row (Manual ▾ / All / Videos / Shorts). None present → floating.
  // A string selects the host itself; { parentOf } selects the parent of the
  // first match, for rows whose container has no id or tag of its own
  // (the 2026 chip bar: chip-view-model < div < div < chip-bar-view-model).
  TRIGGER_HOSTS: [
    { parentOf: 'chip-bar-view-model chip-view-model' },
    'ytd-feed-filter-chip-bar-renderer #chips-wrapper',
    'yt-chip-cloud-renderer #chips',
  ],
};
