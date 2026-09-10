// content/selectors.js
// YouTube DOM selectors. Only what the UI still needs — reordering no longer
// touches the DOM, so the action-menu selectors are gone.
const SELECTORS = {
  PLAYLIST_ITEMS: 'ytd-playlist-video-renderer',
  VIDEO_TITLE: '#video-title',
  VIDEO_LINK: 'a#video-title',
  // Where the Organize button lives, first match wins: the playlist's own
  // filter-chip row (Manual ▾ / All / Videos / Shorts). None present → floating.
  TRIGGER_HOSTS: [
    'ytd-playlist-video-list-renderer ytd-feed-filter-chip-bar-renderer #chips-wrapper',
    'ytd-playlist-video-list-renderer yt-chip-cloud-renderer #chips',
    'ytd-feed-filter-chip-bar-renderer #chips-wrapper',
    'ytd-playlist-video-list-renderer #header',
  ],
};
