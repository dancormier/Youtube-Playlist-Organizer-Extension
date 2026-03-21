# YouTube Watch Later Organizer — Design Spec

## Overview

A Chrome extension that automatically organizes the YouTube Watch Later playlist by scraping the page, using Claude AI to cluster videos by topic, and reordering them in place on the actual YouTube page.

## Problem

YouTube's Watch Later list is an unsorted pile. Users want videos automatically grouped by topic without manual effort.

## Core Interaction Flow

1. User visits their YouTube Watch Later page
2. User clicks the extension icon → popup shows "Analyze & Sort" button
3. Extension scrapes all video data from the page (auto-scrolls to load all videos first)
4. Background worker sends video metadata to Claude API for topic clustering
5. Popup displays the proposed sort order for review:
   - **In-progress videos** at the top, sorted by watch progress descending (most watched first)
   - **Topic clusters** below (e.g., Media Criticism, Politics, Comedy, Music, History)
   - **Within clusters**, videos sorted by duration ascending (shortest first)
6. User clicks "Apply Sort" → content script reorders videos on the YouTube page
7. On hover, each video row with watch progress shows an "Unwatch" button to clear progress

## Architecture

### Components

1. **Content Script** — Injected into the YouTube Watch Later page. Handles scraping, reordering, and injecting the "Unwatch" hover button.
2. **Background Service Worker** — Coordinates scraping, Claude API calls, and storage.
3. **Popup UI** — Control panel with three states: idle, preview, sorting.
4. **Chrome Storage** — Persists API key (sync), cached video data, and sort state (local).

### Data Flow

```
YouTube WL Page → Content Script (scrape) → Background Worker → Claude API
                                                    ↓
                                             Proposed sort order
                                                    ↓
                                             Popup (preview + approve)
                                                    ↓
                                        Content Script (reorder via menu actions)
```

## Content Script — Scraping

Extracts from each video row on the Watch Later page:

- **Title** — from the video title element
- **Channel name** — from the channel link
- **Thumbnail URL** — from the `img` tag
- **Video URL / ID** — from the link href
- **Duration** — from the timestamp overlay
- **Watch progress** — from the red progress bar width (percentage of total duration)

YouTube lazy-loads videos on scroll. The content script auto-scrolls to the bottom of the page to ensure all videos are loaded before scraping. For the expected list size (<50 videos), this should complete quickly.

### Edge Cases

- **Removed/unavailable videos** — Detect dead links and private videos. Skip during reordering, flag in the preview.
- **YouTube DOM changes** — All CSS selectors stored as constants in a single file for easy maintenance.

## Content Script — Reordering

After the user approves the sort:

1. Compute the target order (array of video IDs)
2. For each video, starting from the last position and working backward: open the three-dot menu → click "Move to top"
3. Small delays between actions (e.g., 300-500ms) to avoid rate-limiting or DOM thrashing
4. Progress reported to the popup ("Sorting... 15/42")

Working backward through the target order means each "Move to top" builds the final sequence from bottom to top.

### Why "Move to top" instead of drag-and-drop

YouTube's drag-and-drop reordering is notoriously fragile — even for humans. Automating drag events is unreliable across browsers and screen sizes. The three-dot menu's "Move to top" action is a discrete click target that triggers YouTube's own reorder API, making it far more reliable.

## Claude API Categorization

### Input

A JSON array of video objects sent to Claude — title, channel name, and duration only. No thumbnails or URLs (minimizes tokens, avoids sending unnecessary data externally).

### Prompt Behavior

The prompt asks Claude to:
1. Identify broad topic clusters from the video list (e.g., "Media Criticism", "Politics", "Comedy", "Music", "History", "Tech")
2. Assign each video to exactly one cluster
3. Return structured JSON

### Response Format

```json
{
  "clusters": [
    {
      "name": "Media Criticism",
      "videoIds": ["abc123", "def456"]
    },
    {
      "name": "History",
      "videoIds": ["ghi789"]
    }
  ]
}
```

### Sorting Logic (Applied After Categorization)

1. **Phase 1 — In-progress videos:** All videos with watch progress > 0%, sorted by progress descending (most watched first). These appear at the very top, unclustered.
2. **Phase 2 — Clustered unwatched videos:** Remaining videos grouped by cluster. Within each cluster, sorted by duration ascending (shortest first).

### Cost

For <50 videos, the prompt + response is roughly 1-2K tokens — fractions of a cent per sort.

## Popup UI

Three states, minimal design:

### 1. Idle State
- Extension name
- Single "Analyze & Sort" button
- Hint text: "Visit your Watch Later page first"
- Settings gear icon for API key management

### 2. Preview State
- "Proposed Sort Order" header
- In-progress section (red accent) showing video titles and progress percentages
- Topic cluster sections (blue accent) showing video titles and durations
- "Apply Sort" and "Cancel" buttons

### 3. Sorting State
- Progress bar with count ("24 / 42 videos moved")
- Non-interactive during sort

### Settings
- Accessed via gear icon
- API key entry field (stored in Chrome Storage Sync)

## Unwatch Feature

On the YouTube Watch Later page, when hovering over a video row that has a red progress bar:

- An "Unwatch" button appears on the thumbnail, overlaying the progress bar area
- Clicking it fires a request to YouTube's internal history removal or position reset endpoint to clear the watch progress
- The red progress bar disappears from the thumbnail after clearing
- If the sort has already been applied, the video stays in its current position until the next sort

### Implementation Note

Two candidate endpoints for clearing progress:
- `history/remove` — Clears progress but also removes from History page
- `set_video_position` (position=0) — Resets progress without affecting History

The more reliable and least destructive option will be determined during implementation.

## Tech Stack

- **Vanilla JavaScript** — No framework. Scope doesn't justify one.
- **Chrome Manifest V3** — Required for new Chrome extensions.
- **Chrome Storage Sync** — API key persistence across devices.
- **Chrome Storage Local** — Cached video data and sort state.
- **No external dependencies** — Just vanilla JS and Chrome APIs.

## Project Structure

```
youtube-wl-organizer/
├── manifest.json           # Chrome extension manifest (V3)
├── popup/
│   ├── popup.html          # Popup markup
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic (preview, apply, settings)
├── content/
│   ├── scraper.js          # Scrapes video data from WL page
│   ├── reorder.js          # Executes sort via menu actions
│   └── unwatch.js          # Injects hover "Unwatch" buttons
├── background/
│   └── service-worker.js   # Coordinates scraping, API calls, storage
├── lib/
│   └── claude-api.js       # Claude API client
├── icons/                  # Extension icons (16, 48, 128)
└── styles/
    └── content.css         # Styles for injected UI (Unwatch button)
```

## Assumptions & Constraints

- Target list size: <50 videos
- User must visit the Watch Later page to trigger scraping (no background sync)
- YouTube DOM scraping may break on YouTube updates — selectors centralized for easy fixes
- Requires a Claude API key (user provides their own)
- Chrome only (Manifest V3)
