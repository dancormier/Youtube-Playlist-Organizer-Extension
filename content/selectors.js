// content/selectors.js
// All YouTube DOM selectors centralized here.
// When YouTube changes their markup, update only this file.
const SELECTORS = {
  PLAYLIST_ITEMS: 'ytd-playlist-video-renderer',
  VIDEO_TITLE: '#video-title',
  CHANNEL_NAME: 'ytd-channel-name a',
  THUMBNAIL: 'img.yt-core-image',
  VIDEO_LINK: 'a#video-title',
  DURATION: 'span.ytd-thumbnail-overlay-time-status-renderer',
  PROGRESS_BAR: '#progress',
  MENU_BUTTON: 'button.yt-icon-button[aria-label="Action menu"]',
  MOVE_TO_TOP: 'tp-yt-paper-listbox ytd-menu-service-item-renderer',
};
