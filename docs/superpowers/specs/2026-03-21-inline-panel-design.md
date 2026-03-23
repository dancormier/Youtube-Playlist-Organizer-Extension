# Inline Panel — Design Spec

## Problem

The extension popup disappears when the YouTube page loses focus, resetting state during the analysis/sort process.

## Solution

Move the UI from the extension popup into an injected panel on the Watch Later page itself, below the playlist header.

## Changes

### Remove
- `popup/popup.html`, `popup/popup.css`, `popup/popup.js` — no longer used
- `manifest.json` `default_popup` — removed so icon click triggers `chrome.action.onClicked`

### Add
- `content/panel.js` — Injects a collapsible UI panel below `thumbnail-and-metadata-wrapper` on the Watch Later page. Same states as the popup: idle, analyzing, preview, sorting, done, error, plus inline settings for API key.
- `styles/panel.css` — Styles for the injected panel. Dark theme, inline with YouTube page.

### Modify
- `manifest.json` — Remove `default_popup`, add `panel.js` and `panel.css` to content scripts
- `background/service-worker.js` — Add `chrome.action.onClicked` listener that sends a message to the content script to scroll to and expand the panel

### Unchanged
- `content/scraper.js`, `content/reorder.js`, `content/unwatch.js`, `content/selectors.js`
- `lib/sort.js`, `lib/claude-api.js`
- Message flow between content scripts and service worker

## Panel Behavior

- Injected below `thumbnail-and-metadata-wrapper` element
- Compact header bar ("WL Organizer" + gear icon) — click to expand/collapse
- Starts expanded on page load
- Clicking the extension toolbar icon scrolls to the panel and expands it
- Settings (API key) accessible via gear icon within the panel
- All state persists as long as the YouTube page is open
