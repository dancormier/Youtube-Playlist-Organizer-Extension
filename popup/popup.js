// popup/popup.js — Settings only

const $ = (sel) => document.querySelector(sel);

// --- Host permission -------------------------------------------------------
// Firefox MV3 treats declared `host_permissions` as opt-in: they are NOT
// granted at install, and the declared content script does not inject until
// the user allows the site. That is why the Organize button appeared only
// after clicking the toolbar button, which grants temporary access via
// `activeTab`. Chrome grants host_permissions at install, so `contains()`
// returns true there and this banner never renders.
const YT_PERMS = { origins: ['https://www.youtube.com/*'] };

function showBanner(text, showButton) {
  $('#perm-text').textContent = text;
  $('#grant-btn').hidden = !showButton;
  $('#perm-banner').hidden = false;
}

if (chrome.permissions) {
  chrome.permissions.contains(YT_PERMS, (granted) => {
    if (!granted) $('#perm-banner').hidden = false;
  });

  // `permissions.request()` must be called from a user input handler, so it
  // cannot be fired automatically when the popup opens.
  $('#grant-btn').addEventListener('click', () => {
    chrome.permissions.request(YT_PERMS, (granted) => {
      if (granted) {
        // The grant does not retroactively inject into tabs that are already
        // open, so a reload is genuinely required.
        showBanner('Granted. Reload any open YouTube tabs.', false);
      } else {
        showBanner('Not granted. The Organize button will not appear until you allow access.', true);
      }
    });
  });
}

// Load existing key
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) $('#api-key-input').value = apiKey;
});

$('#save-key-btn').addEventListener('click', () => {
  const key = $('#api-key-input').value.trim();
  if (!key) {
    $('#key-status').textContent = 'Please enter a key';
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => {
    $('#key-status').textContent = 'Saved!';
    setTimeout(() => { $('#key-status').textContent = ''; }, 1500);
  });
});
