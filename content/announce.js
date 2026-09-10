// content/announce.js
// Tells the background which tab to colour the toolbar icon on. The icon is
// per-tab, so one message from the page replaces watching every navigation
// through the `tabs` permission. Fire-and-forget: nothing depends on a reply.
function announce(type) {
  try {
    chrome.runtime.sendMessage({ type }).catch(() => {});
  } catch {
    // No background listening (e.g. extension reloading); the icon just stays gray.
  }
}

announce('YT_PAGE');
// Chrome keeps a per-tab icon until the tab closes, so leaving YouTube in the
// same tab has to reset it explicitly.
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => announce('YT_LEAVE'));
}
