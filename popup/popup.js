// popup/popup.js — Settings only

const $ = (sel) => document.querySelector(sel);

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
