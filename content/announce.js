// content/announce.js
// Tells the background which tab to colour the toolbar icon on. The icon is
// per-tab, so one message from the page replaces watching every navigation
// through the `tabs` permission. Fire-and-forget: nothing depends on a reply.
try {
  chrome.runtime.sendMessage({ type: 'YT_PAGE' }).catch(() => {});
} catch {
  // No background listening (e.g. extension reloading); the icon just stays gray.
}
