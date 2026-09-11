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
  // first match. The 2026 chip bar (chip-bar-view-model) keeps its chips in a
  // role=tablist scroll container, each chip in its own wrapper div.
  TRIGGER_HOSTS: [
    'chip-bar-view-model .ytChipBarViewModelChipBarScrollContainer',
    'chip-bar-view-model [role="tablist"]',
    'ytd-feed-filter-chip-bar-renderer #chips-wrapper',
    'yt-chip-cloud-renderer #chips',
  ],
  // The playlist's own sort chip and the menu it opens. A reorder only shows
  // through the Manual view, so WLViewSort switches to it before applying.
  SORT_CHIP: 'chip-bar-view-model button[role="combobox"]',
  SORT_MENU_ITEMS: 'tp-yt-iron-dropdown [role="menuitem"]',
};
