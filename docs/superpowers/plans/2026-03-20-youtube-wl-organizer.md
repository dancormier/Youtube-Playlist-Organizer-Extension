# YouTube Watch Later Organizer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that scrapes the YouTube Watch Later page, uses Claude AI to cluster videos by topic, and reorders them in place with a single click.

**Architecture:** Content script scrapes video data and performs reordering via YouTube's "Move to top" menu action. Background service worker coordinates scraping, Claude API calls, and Chrome Storage. Popup provides a minimal control panel (analyze → preview → apply).

**Tech Stack:** Vanilla JavaScript, Chrome Manifest V3, Chrome Storage API, Claude API (Haiku for cost efficiency)

**Spec:** `docs/superpowers/specs/2026-03-20-youtube-wl-organizer-design.md`

**Testing:** Node.js built-in test runner (`node:test`) for pure logic modules. DOM-dependent code kept thin and tested manually via extension loading.

---

### Task 1: Project Scaffold & Manifest

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `icons/icon16.png`
- Create: `icons/icon48.png`
- Create: `icons/icon128.png`

- [ ] **Step 0: Create package.json**

```json
{
  "private": true,
  "type": "module"
}
```

This enables ES module `import` syntax for both tests (`node:test`) and source files.

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "YouTube Watch Later Organizer",
  "version": "0.1.0",
  "description": "Automatically organize your YouTube Watch Later playlist using AI",
  "permissions": ["storage", "activeTab", "tabs"],
  "host_permissions": ["https://www.youtube.com/*"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/playlist?list=WL*"],
      "js": ["content/selectors.js", "content/scraper.js", "content/reorder.js", "content/unwatch.js"],
      "css": ["styles/content.css"]
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create placeholder icons**

Generate simple colored square PNGs at 16x16, 48x48, and 128x128 using an HTML canvas script or download placeholders. These are temporary — just need something so Chrome doesn't error.

```bash
# Use ImageMagick if available, otherwise create a simple script
convert -size 16x16 xc:#ff4444 icons/icon16.png
convert -size 48x48 xc:#ff4444 icons/icon48.png
convert -size 128x128 xc:#ff4444 icons/icon128.png
```

If ImageMagick isn't available, create a small Node script to generate them, or use any solid-color PNG files.

- [ ] **Step 3: Create stub files so the extension loads**

Create empty stubs for all files referenced in the manifest so Chrome can load the extension without errors:

- `background/service-worker.js` — `// Service worker stub`
- `content/selectors.js` — `// Selectors stub`
- `content/scraper.js` — `// Scraper stub`
- `content/reorder.js` — `// Reorder stub`
- `content/unwatch.js` — `// Unwatch stub`
- `styles/content.css` — `/* Content styles stub */`
- `popup/popup.html` — minimal HTML with `<html><body><p>Loading...</p></body></html>`
- `popup/popup.css` — `/* Popup styles stub */`
- `popup/popup.js` — `// Popup stub`

- [ ] **Step 4: Verify extension loads in Chrome**

Run: Load the extension in Chrome via `chrome://extensions` → "Load unpacked" → select project root.
Expected: Extension appears in toolbar with red icon, popup shows "Loading...", no console errors.

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json icons/ background/ content/ styles/ popup/
git commit -m "feat: scaffold Chrome extension with manifest and stubs"
```

---

### Task 2: DOM Selectors Constants

**Files:**
- Create: `content/selectors.js`
- Create: `tests/selectors.test.js`

All YouTube DOM selectors live in one file. When YouTube changes their markup, only this file needs updating.

- [ ] **Step 1: Write the test**

```js
// tests/selectors.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We can't import directly (no module system in content scripts),
// so we test the selector file by evaluating it
import { readFileSync } from 'node:fs';

describe('selectors', () => {
  it('exports all required selectors', () => {
    const code = readFileSync('content/selectors.js', 'utf8');
    const required = [
      'PLAYLIST_ITEMS',
      'VIDEO_TITLE',
      'CHANNEL_NAME',
      'THUMBNAIL',
      'VIDEO_LINK',
      'DURATION',
      'PROGRESS_BAR',
      'MENU_BUTTON',
      'MOVE_TO_TOP',
    ];
    for (const name of required) {
      assert.ok(code.includes(name), `Missing selector: ${name}`);
    }
  });

  it('selectors are non-empty strings', () => {
    const code = readFileSync('content/selectors.js', 'utf8');
    // Extract all SELECTORS.X = 'value' patterns
    const matches = code.matchAll(/SELECTORS\.(\w+)\s*=\s*'([^']*)'/g);
    for (const [, name, value] of matches) {
      assert.ok(value.length > 0, `Empty selector: ${name}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/selectors.test.js`
Expected: FAIL — selectors.js is a stub.

- [ ] **Step 3: Implement selectors.js**

```js
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
```

Note: These selectors are best-effort based on YouTube's current DOM. They will be validated and adjusted during Task 4 (scraper) when testing against the live page.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/selectors.test.js`
Expected: PASS — all selectors defined and non-empty.

- [ ] **Step 5: Commit**

```bash
git add content/selectors.js tests/selectors.test.js
git commit -m "feat: add centralized DOM selectors for YouTube Watch Later page"
```

---

### Task 3: Sorting Logic (Pure Functions)

**Files:**
- Create: `lib/sort.js`
- Create: `tests/sort.test.js`

This is the core sorting algorithm — pure functions, no DOM, fully testable.

- [ ] **Step 1: Write the failing tests**

```js
// tests/sort.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSortOrder } from '../lib/sort.js';

describe('buildSortOrder', () => {
  const videos = [
    { id: 'v1', title: 'Roman Empire', channel: 'History Guy', duration: 1200, progress: 0.72 },
    { id: 'v2', title: 'Perfect Pasta', channel: 'Chef', duration: 600, progress: 0.35 },
    { id: 'v3', title: 'Constantinople', channel: 'History Guy', duration: 754, progress: 0 },
    { id: 'v4', title: 'Viking Age', channel: 'Timeline', duration: 2721, progress: 0 },
    { id: 'v5', title: 'Stand-up Highlights', channel: 'Comedy Central', duration: 495, progress: 0 },
    { id: 'v6', title: 'Sketch Comedy', channel: 'SNL', duration: 1327, progress: 0 },
    { id: 'v7', title: 'Film Analysis', channel: 'Every Frame', duration: 900, progress: 0 },
  ];

  const clusters = {
    clusters: [
      { name: 'History', videoIds: ['v3', 'v4'] },
      { name: 'Comedy', videoIds: ['v5', 'v6'] },
      { name: 'Media Criticism', videoIds: ['v7'] },
    ]
  };

  it('puts in-progress videos first, sorted by progress descending', () => {
    const result = buildSortOrder(videos, clusters);
    assert.equal(result[0].id, 'v1'); // 72%
    assert.equal(result[1].id, 'v2'); // 35%
  });

  it('groups remaining videos by cluster', () => {
    const result = buildSortOrder(videos, clusters);
    const afterProgress = result.slice(2);
    // Find cluster boundaries
    const historyIdx = afterProgress.findIndex(v => v.id === 'v3');
    const otherHistoryIdx = afterProgress.findIndex(v => v.id === 'v4');
    assert.ok(Math.abs(historyIdx - otherHistoryIdx) === 1, 'History videos should be adjacent');
  });

  it('sorts within clusters by duration ascending', () => {
    const result = buildSortOrder(videos, clusters);
    const afterProgress = result.slice(2);
    const historyVideos = afterProgress.filter(v => ['v3', 'v4'].includes(v.id));
    assert.equal(historyVideos[0].id, 'v3'); // 754s
    assert.equal(historyVideos[1].id, 'v4'); // 2721s
  });

  it('includes cluster name in the result', () => {
    const result = buildSortOrder(videos, clusters);
    const v3 = result.find(v => v.id === 'v3');
    assert.equal(v3.cluster, 'History');
  });

  it('marks in-progress videos with no cluster', () => {
    const result = buildSortOrder(videos, clusters);
    assert.equal(result[0].cluster, null);
    assert.equal(result[1].cluster, null);
  });

  it('handles videos not assigned to any cluster', () => {
    const sparseCluster = { clusters: [{ name: 'History', videoIds: ['v3'] }] };
    const smallList = [
      { id: 'v3', title: 'Constantinople', channel: 'History Guy', duration: 754, progress: 0 },
      { id: 'v5', title: 'Stand-up', channel: 'Comedy Central', duration: 495, progress: 0 },
    ];
    const result = buildSortOrder(smallList, sparseCluster);
    assert.equal(result.length, 2);
    // Unclustered video should appear in an "Other" cluster at the end
    const v5 = result.find(v => v.id === 'v5');
    assert.equal(v5.cluster, 'Other');
  });

  it('returns empty array for empty input', () => {
    const result = buildSortOrder([], { clusters: [] });
    assert.deepEqual(result, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sort.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sort.js**

```js
// lib/sort.js

/**
 * Build the final sort order from videos and AI cluster assignments.
 *
 * Order:
 * 1. In-progress videos (progress > 0), sorted by progress descending
 * 2. Clustered videos grouped by cluster, sorted by duration ascending within each cluster
 * 3. Videos not assigned to any cluster go into an "Other" group at the end
 *
 * @param {Array<{id: string, title: string, channel: string, duration: number, progress: number}>} videos
 * @param {{clusters: Array<{name: string, videoIds: string[]}>}} clusterResult
 * @returns {Array<{id: string, title: string, channel: string, duration: number, progress: number, cluster: string|null}>}
 */
export function buildSortOrder(videos, clusterResult) {
  if (videos.length === 0) return [];

  // Separate in-progress vs unwatched
  const inProgress = videos
    .filter(v => v.progress > 0)
    .sort((a, b) => b.progress - a.progress)
    .map(v => ({ ...v, cluster: null }));

  const unwatched = videos.filter(v => v.progress === 0);

  // Build a videoId -> cluster name map
  const videoClusterMap = new Map();
  for (const cluster of clusterResult.clusters) {
    for (const videoId of cluster.videoIds) {
      videoClusterMap.set(videoId, cluster.name);
    }
  }

  // Group unwatched videos by cluster
  const groups = new Map();
  for (const video of unwatched) {
    const clusterName = videoClusterMap.get(video.id) || 'Other';
    if (!groups.has(clusterName)) groups.set(clusterName, []);
    groups.get(clusterName).push({ ...video, cluster: clusterName });
  }

  // Sort within each group by duration ascending
  for (const group of groups.values()) {
    group.sort((a, b) => a.duration - b.duration);
  }

  // Flatten cluster groups (preserve cluster order from AI, "Other" last)
  const clusterOrder = clusterResult.clusters.map(c => c.name);
  const sorted = [];
  for (const name of clusterOrder) {
    if (groups.has(name)) {
      sorted.push(...groups.get(name));
      groups.delete(name);
    }
  }
  // Append any remaining groups (e.g., "Other")
  for (const group of groups.values()) {
    sorted.push(...group);
  }

  return [...inProgress, ...sorted];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sort.test.js`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sort.js tests/sort.test.js
git commit -m "feat: add sorting logic — in-progress first, then AI clusters by duration"
```

---

### Task 4: Claude API Client

**Files:**
- Create: `lib/claude-api.js`
- Create: `tests/claude-api.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/claude-api.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseClusters } from '../lib/claude-api.js';

describe('buildPrompt', () => {
  it('includes video titles and channels in the prompt', () => {
    const videos = [
      { id: 'v1', title: 'Roman Empire', channel: 'History Guy', duration: 1200 },
      { id: 'v2', title: 'Stand-up Special', channel: 'Comedy Central', duration: 495 },
    ];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('Roman Empire'));
    assert.ok(prompt.includes('History Guy'));
    assert.ok(prompt.includes('Stand-up Special'));
  });

  it('includes video IDs for reference', () => {
    const videos = [{ id: 'abc123', title: 'Test', channel: 'Ch', duration: 100 }];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('abc123'));
  });

  it('requests JSON output format', () => {
    const videos = [{ id: 'v1', title: 'Test', channel: 'Ch', duration: 100 }];
    const prompt = buildPrompt(videos);
    assert.ok(prompt.includes('JSON'));
  });
});

describe('parseClusters', () => {
  it('parses valid cluster JSON from response text', () => {
    const responseText = '{"clusters":[{"name":"History","videoIds":["v1","v2"]}]}';
    const result = parseClusters(responseText);
    assert.equal(result.clusters.length, 1);
    assert.equal(result.clusters[0].name, 'History');
    assert.deepEqual(result.clusters[0].videoIds, ['v1', 'v2']);
  });

  it('extracts JSON from markdown code block', () => {
    const responseText = 'Here is the result:\n```json\n{"clusters":[{"name":"Tech","videoIds":["v1"]}]}\n```';
    const result = parseClusters(responseText);
    assert.equal(result.clusters[0].name, 'Tech');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseClusters('not json at all'), /Failed to parse/);
  });

  it('throws when clusters key is missing', () => {
    assert.throws(() => parseClusters('{"categories":[]}'), /Missing "clusters"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/claude-api.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement claude-api.js**

```js
// lib/claude-api.js

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Build the categorization prompt for Claude.
 * @param {Array<{id: string, title: string, channel: string, duration: number}>} videos
 * @returns {string}
 */
export function buildPrompt(videos) {
  const videoList = videos
    .map(v => `- id: "${v.id}", title: "${v.title}", channel: "${v.channel}", duration: ${v.duration}s`)
    .join('\n');

  return `You are organizing a YouTube Watch Later playlist. Given the following videos, group them into broad topic clusters (e.g., "Media Criticism", "Politics", "Comedy", "Music", "History", "Tech", etc.).

Rules:
- Each video belongs to exactly one cluster
- Use broad, recognizable category names
- Aim for 3-8 clusters depending on variety
- Return ONLY valid JSON, no explanation

Videos:
${videoList}

Return JSON in this exact format:
{"clusters":[{"name":"Category Name","videoIds":["id1","id2"]}]}`;
}

/**
 * Parse Claude's response text into a clusters object.
 * Handles raw JSON or JSON inside a markdown code block.
 * @param {string} text
 * @returns {{clusters: Array<{name: string, videoIds: string[]}>}}
 */
export function parseClusters(text) {
  let jsonStr = text.trim();

  // Extract from markdown code block if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse cluster JSON: ${jsonStr.slice(0, 100)}`);
  }

  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    throw new Error('Missing "clusters" array in response');
  }

  return parsed;
}

/**
 * Call Claude API to categorize videos.
 * @param {string} apiKey
 * @param {Array<{id: string, title: string, channel: string, duration: number}>} videos
 * @returns {Promise<{clusters: Array<{name: string, videoIds: string[]}>}>}
 */
export async function categorizeVideos(apiKey, videos) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(videos) }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  return parseClusters(text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/claude-api.test.js`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/claude-api.js tests/claude-api.test.js
git commit -m "feat: add Claude API client with prompt builder and response parser"
```

---

### Task 5: Content Script — Scraper

**Files:**
- Modify: `content/scraper.js`

This reads the YouTube Watch Later page DOM and extracts video data. Depends on `content/selectors.js`. Since it interacts directly with the YouTube DOM, it cannot be unit tested with Node — it will be tested manually by loading the extension.

- [ ] **Step 1: Implement scraper.js**

```js
// content/scraper.js
// Depends on: content/selectors.js (loaded before this script via manifest)

const WLScraper = {
  /**
   * Auto-scroll the page to load all lazy-loaded videos.
   * @returns {Promise<void>}
   */
  async scrollToLoadAll() {
    let lastHeight = 0;
    let retries = 0;
    const maxRetries = 20;

    while (retries < maxRetries) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      const newHeight = document.documentElement.scrollHeight;
      if (newHeight === lastHeight) {
        retries++;
        if (retries >= 3) break; // 3 consecutive unchanged heights = done
      } else {
        retries = 0;
        lastHeight = newHeight;
      }
    }
    window.scrollTo(0, 0);
  },

  /**
   * Parse duration string "H:MM:SS" or "MM:SS" to total seconds.
   * @param {string} durationStr
   * @returns {number}
   */
  parseDuration(durationStr) {
    const parts = durationStr.trim().split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  },

  /**
   * Extract watch progress as a fraction (0 to 1) from the progress bar element.
   * @param {Element} item - The playlist video renderer element
   * @returns {number}
   */
  getProgress(item) {
    const bar = item.querySelector(SELECTORS.PROGRESS_BAR);
    if (!bar) return 0;
    const style = bar.getAttribute('style') || '';
    const match = style.match(/width:\s*([\d.]+)%/);
    return match ? parseFloat(match[1]) / 100 : 0;
  },

  /**
   * Extract video ID from a YouTube URL.
   * @param {string} href
   * @returns {string}
   */
  extractVideoId(href) {
    try {
      const url = new URL(href, 'https://www.youtube.com');
      return url.searchParams.get('v') || '';
    } catch {
      return '';
    }
  },

  /**
   * Scrape all videos from the Watch Later page.
   * @returns {Promise<Array<{id: string, title: string, channel: string, thumbnailUrl: string, videoUrl: string, duration: number, progress: number}>>}
   */
  async scrapeAll() {
    await this.scrollToLoadAll();

    const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);
    const videos = [];

    for (const item of items) {
      const titleEl = item.querySelector(SELECTORS.VIDEO_TITLE);
      const channelEl = item.querySelector(SELECTORS.CHANNEL_NAME);
      const thumbnailEl = item.querySelector(SELECTORS.THUMBNAIL);
      const linkEl = item.querySelector(SELECTORS.VIDEO_LINK);
      const durationEl = item.querySelector(SELECTORS.DURATION);

      if (!titleEl || !linkEl) continue; // Skip unavailable videos

      const href = linkEl.getAttribute('href') || '';
      const id = this.extractVideoId(href);
      if (!id) continue;

      videos.push({
        id,
        title: titleEl.textContent.trim(),
        channel: channelEl ? channelEl.textContent.trim() : 'Unknown',
        thumbnailUrl: thumbnailEl ? thumbnailEl.getAttribute('src') || '' : '',
        videoUrl: `https://www.youtube.com/watch?v=${id}`,
        duration: durationEl ? this.parseDuration(durationEl.textContent) : 0,
        progress: this.getProgress(item),
      });
    }

    return videos;
  },
};

// Listen for scrape requests from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCRAPE') {
    WLScraper.scrapeAll().then(sendResponse);
    return true;
  }
});
```

- [ ] **Step 2: Verify scraper loads without errors**

Load the extension in Chrome, navigate to YouTube Watch Later page. Open DevTools console and run:
```js
WLScraper.scrapeAll().then(v => console.log(v))
```
Expected: Array of video objects printed to console. Verify titles, channels, durations, and progress values look correct.

- [ ] **Step 3: Adjust selectors if needed**

If any fields are missing or empty, inspect the YouTube DOM and update `content/selectors.js` accordingly. Re-test until all fields populate correctly.

- [ ] **Step 4: Commit**

```bash
git add content/scraper.js content/selectors.js
git commit -m "feat: add Watch Later page scraper with auto-scroll"
```

---

### Task 6: Content Script — Reorder

**Files:**
- Modify: `content/reorder.js`

Reorders videos on the YouTube page using the three-dot menu "Move to top" action.

- [ ] **Step 1: Implement reorder.js**

```js
// content/reorder.js
// Depends on: content/selectors.js

const WLReorder = {
  /**
   * Delay helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  /**
   * Find the playlist item element for a given video ID.
   * @param {string} videoId
   * @returns {Element|null}
   */
  findItem(videoId) {
    const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);
    for (const item of items) {
      const link = item.querySelector(SELECTORS.VIDEO_LINK);
      if (!link) continue;
      const href = link.getAttribute('href') || '';
      if (href.includes(videoId)) return item;
    }
    return null;
  },

  /**
   * Click the three-dot menu on a video item, then click "Move to top".
   * @param {Element} item
   * @returns {Promise<boolean>} true if successful
   */
  async moveToTop(item) {
    const menuBtn = item.querySelector(SELECTORS.MENU_BUTTON);
    if (!menuBtn) return false;

    menuBtn.click();
    await this.sleep(300);

    // Find "Move to top" in the dropdown menu
    const menuItems = document.querySelectorAll(SELECTORS.MOVE_TO_TOP);
    let moveToTopItem = null;
    for (const mi of menuItems) {
      if (mi.textContent.includes('Move to top')) {
        moveToTopItem = mi;
        break;
      }
    }

    if (!moveToTopItem) {
      // Close menu if "Move to top" not found
      document.body.click();
      return false;
    }

    moveToTopItem.click();
    await this.sleep(400);
    return true;
  },

  /**
   * Reorder all videos to match the target order.
   * Works backward: moves last target item to top first, building the order bottom-up.
   * @param {string[]} targetOrder - Array of video IDs in desired order
   * @param {(current: number, total: number) => void} onProgress
   * @returns {Promise<{moved: number, failed: string[]}>}
   */
  async reorder(targetOrder, onProgress) {
    const total = targetOrder.length;
    let moved = 0;
    const failed = [];

    // Process in reverse: last item first → it gets moved to top,
    // then second-to-last → it sits on top of the previous, etc.
    for (let i = total - 1; i >= 0; i--) {
      const videoId = targetOrder[i];
      const item = this.findItem(videoId);

      if (!item) {
        failed.push(videoId);
        continue;
      }

      // Scroll item into view before interacting
      item.scrollIntoView({ behavior: 'instant', block: 'center' });
      await this.sleep(200);

      const success = await this.moveToTop(item);
      if (success) {
        moved++;
      } else {
        failed.push(videoId);
      }

      onProgress(total - i, total);
    }

    return { moved, failed };
  },
};

// Listen for reorder requests from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REORDER') {
    WLReorder.reorder(message.targetOrder, (current, total) => {
      chrome.runtime.sendMessage({ type: 'SORT_PROGRESS', current, total });
    }).then(sendResponse);
    return true;
  }
});
```

- [ ] **Step 2: Manual test on YouTube**

Load extension, go to Watch Later page with a few videos. In DevTools console:
```js
// Test with 2-3 video IDs to verify reordering works
WLReorder.reorder(['videoId1', 'videoId2', 'videoId3'], (c, t) => console.log(`${c}/${t}`))
```
Expected: Videos rearrange on the page. Console shows progress.

- [ ] **Step 3: Adjust selectors and timing if needed**

The menu button and "Move to top" selectors may need tuning. The delay values (300ms, 400ms) may need increasing if YouTube is slow to render the menu. Update and re-test.

- [ ] **Step 4: Commit**

```bash
git add content/reorder.js content/selectors.js
git commit -m "feat: add video reordering via Move to top menu action"
```

---

### Task 7: Content Script — Unwatch Button

**Files:**
- Modify: `content/unwatch.js`
- Modify: `styles/content.css`

Injects an "Unwatch" button on video thumbnails that have a progress bar. Revealed on hover.

- [ ] **Step 1: Implement content.css**

```css
/* styles/content.css */

.wl-unwatch-btn {
  display: none;
  position: absolute;
  bottom: 4px;
  right: 4px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  line-height: 1.4;
}

.wl-unwatch-btn:hover {
  background: rgba(200, 0, 0, 0.9);
}

/* Show button when hovering the thumbnail container */
ytd-playlist-video-renderer:hover .wl-unwatch-btn {
  display: block;
}
```

- [ ] **Step 2: Implement unwatch.js**

```js
// content/unwatch.js
// Depends on: content/selectors.js

const WLUnwatch = {
  /**
   * Inject "Unwatch" buttons on all video rows that have a progress bar.
   * Safe to call multiple times — skips rows that already have the button.
   */
  injectButtons() {
    const items = document.querySelectorAll(SELECTORS.PLAYLIST_ITEMS);

    for (const item of items) {
      if (item.querySelector('.wl-unwatch-btn')) continue; // Already injected

      const progressBar = item.querySelector(SELECTORS.PROGRESS_BAR);
      if (!progressBar) continue; // No watch progress

      const thumbnail = item.querySelector('ytd-thumbnail');
      if (!thumbnail) continue;

      // Ensure thumbnail is positioned for absolute child
      thumbnail.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'wl-unwatch-btn';
      btn.textContent = 'Unwatch';

      const link = item.querySelector(SELECTORS.VIDEO_LINK);
      const videoId = link ? WLScraper.extractVideoId(link.getAttribute('href') || '') : '';

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.clearProgress(videoId);
        // Remove progress bar visually
        progressBar.style.width = '0%';
        btn.remove();
      });

      thumbnail.appendChild(btn);
    }
  },

  /**
   * Clear watch progress for a video by removing it from watch history.
   * Uses YouTube's internal history removal endpoint.
   * @param {string} videoId
   * @returns {Promise<boolean>}
   */
  async clearProgress(videoId) {
    try {
      // YouTube's internal API requires a SAPISIDHASH for auth.
      // We use the same cookies the page already has.
      const response = await fetch(`https://www.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: this.getInnertubeContext(),
          actions: [{
            action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID',
            removedVideoId: videoId,
          }],
          playlistId: 'HL', // History list
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Extract YouTube's innertube context from the page.
   * YouTube embeds this in the page's ytcfg object.
   * @returns {object}
   */
  getInnertubeContext() {
    try {
      const ytcfg = window.ytcfg;
      if (ytcfg && ytcfg.get) {
        const innertubeContext = ytcfg.get('INNERTUBE_CONTEXT');
        if (innertubeContext) return innertubeContext;
      }
    } catch { /* fallback below */ }

    // Minimal fallback context
    return {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
      },
    };
  },

  /**
   * Start observing for new video rows and inject buttons.
   */
  observe() {
    this.injectButtons();

    // Re-inject when YouTube dynamically adds rows (e.g., lazy loading)
    const observer = new MutationObserver(() => this.injectButtons());
    const playlist = document.querySelector('ytd-playlist-video-list-renderer');
    if (playlist) {
      observer.observe(playlist, { childList: true, subtree: true });
    }
  },
};

// Auto-start when content script loads
WLUnwatch.observe();
```

- [ ] **Step 3: Manual test on YouTube**

Load extension, go to Watch Later page. Hover over a video with a red progress bar.
Expected: "Unwatch" button appears on the thumbnail. Clicking it clears the progress bar.

**Important:** The `clearProgress` implementation above removes the video from Watch History entirely (not just the progress bar). This is the more destructive of two options. During implementation, research YouTube's `set_video_position` innertube endpoint (sets playback position to 0) as a less destructive alternative that clears the progress bar without removing the history entry. Inspect YouTube's network requests when manually seeking to the beginning of a video to find the correct endpoint and payload.

- [ ] **Step 4: Commit**

```bash
git add content/unwatch.js styles/content.css
git commit -m "feat: add Unwatch hover button to clear video progress"
```

---

### Task 8: Background Service Worker

**Files:**
- Modify: `background/service-worker.js`

Coordinates messages between content script and popup. Calls the Claude API. Uses ES module imports (enabled by `"type": "module"` in manifest's background config).

- [ ] **Step 1: Implement service-worker.js**

```js
// background/service-worker.js
import { categorizeVideos } from '../lib/claude-api.js';
import { buildSortOrder } from '../lib/sort.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    handleAnalyze(message.videos).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_SORT_STATE') {
    chrome.storage.local.get('sortState', (data) => {
      sendResponse(data.sortState || null);
    });
    return true;
  }
});

/**
 * Handle the analyze request: call Claude API, compute sort order, save state.
 * @param {Array} videos - Scraped video data
 * @returns {Promise<{success: boolean, sortOrder?: Array, error?: string}>}
 */
async function handleAnalyze(videos) {
  try {
    // Get API key from sync storage
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (!apiKey) {
      return { success: false, error: 'No API key configured. Open settings to add your Claude API key.' };
    }

    // Filter to only unwatched videos for categorization
    const unwatched = videos.filter(v => v.progress === 0);

    // Call Claude API for clustering
    const clusters = await categorizeVideos(apiKey, unwatched);

    // Build sort order using the shared sort module
    const sortOrder = buildSortOrder(videos, clusters);

    // Save state
    await chrome.storage.local.set({
      sortState: {
        videos,
        clusters,
        sortOrder,
        timestamp: Date.now(),
      },
    });

    return { success: true, sortOrder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

- [ ] **Step 2: Verify service worker registers**

Load extension in Chrome. Check `chrome://extensions` → click "service worker" link.
Expected: Service worker console opens with no errors. The ES module imports resolve correctly.

- [ ] **Step 3: Commit**

```bash
git add background/service-worker.js
git commit -m "feat: add background service worker to coordinate scraping and Claude API"
```

---

### Task 9: Popup UI — HTML & CSS

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`

- [ ] **Step 1: Implement popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <!-- Settings overlay -->
  <div id="settings-view" class="hidden">
    <div class="header">
      <h1>Settings</h1>
      <button id="settings-back" class="icon-btn" title="Back">&larr;</button>
    </div>
    <div class="settings-form">
      <label for="api-key-input">Claude API Key</label>
      <input type="password" id="api-key-input" placeholder="sk-ant-...">
      <button id="save-key-btn">Save</button>
      <p id="key-status" class="status-text"></p>
    </div>
  </div>

  <!-- Main view -->
  <div id="main-view">
    <div class="header">
      <h1>WL Organizer</h1>
      <button id="settings-btn" class="icon-btn" title="Settings">&#9881;</button>
    </div>

    <!-- Idle state -->
    <div id="state-idle">
      <button id="analyze-btn" class="primary-btn">Analyze &amp; Sort</button>
      <p class="hint">Visit your Watch Later page first</p>
    </div>

    <!-- Analyzing state -->
    <div id="state-analyzing" class="hidden">
      <p class="status-text">Analyzing videos...</p>
      <div class="progress-bar"><div class="progress-fill" id="analyze-progress"></div></div>
    </div>

    <!-- Preview state -->
    <div id="state-preview" class="hidden">
      <h2>Proposed Sort Order</h2>
      <div id="preview-list"></div>
      <div class="button-row">
        <button id="apply-btn" class="primary-btn">Apply Sort</button>
        <button id="cancel-btn" class="secondary-btn">Cancel</button>
      </div>
    </div>

    <!-- Sorting state -->
    <div id="state-sorting" class="hidden">
      <p class="status-text">Sorting your Watch Later...</p>
      <div class="progress-bar"><div class="progress-fill" id="sort-progress"></div></div>
      <p id="sort-count" class="hint">0 / 0 videos moved</p>
    </div>

    <!-- Done state -->
    <div id="state-done" class="hidden">
      <p class="status-text">Done!</p>
      <button id="done-btn" class="secondary-btn">Close</button>
    </div>

    <!-- Error state -->
    <div id="state-error" class="hidden">
      <p id="error-msg" class="error-text"></p>
      <button id="retry-btn" class="secondary-btn">Try Again</button>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement popup.css**

```css
/* popup/popup.css */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 320px;
  max-height: 500px;
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #e1e1e1;
  background: #1a1a1a;
  padding: 12px;
}

.hidden { display: none !important; }

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header h1 {
  font-size: 14px;
  font-weight: 600;
}

.icon-btn {
  background: none;
  border: none;
  color: #aaa;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}
.icon-btn:hover { color: #fff; }

/* Buttons */
.primary-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  background: #c00;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.primary-btn:hover { background: #e00; }
.primary-btn:disabled { background: #555; cursor: default; }

.secondary-btn {
  padding: 8px 16px;
  font-size: 13px;
  background: #333;
  color: #ccc;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.secondary-btn:hover { background: #444; }

.button-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.button-row .primary-btn { flex: 1; }
.button-row .secondary-btn { flex: 1; }

/* Text */
.hint { color: #777; font-size: 11px; margin-top: 8px; text-align: center; }
.status-text { color: #ccc; text-align: center; margin-bottom: 8px; }
.error-text { color: #f44; text-align: center; margin-bottom: 8px; }

/* Progress bar */
.progress-bar {
  background: #333;
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}
.progress-fill {
  background: #c00;
  height: 100%;
  width: 0%;
  transition: width 0.2s;
}

/* Preview list */
#preview-list {
  max-height: 350px;
  overflow-y: auto;
  margin-bottom: 4px;
}

.cluster-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 0 4px;
}
.cluster-label.in-progress { color: #f44; }
.cluster-label.topic { color: #4a9eff; }

.preview-item {
  display: flex;
  justify-content: space-between;
  padding: 3px 0 3px 10px;
  color: #bbb;
  font-size: 12px;
}
.preview-item .title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.preview-item .meta { color: #777; white-space: nowrap; }

/* Settings */
.settings-form { display: flex; flex-direction: column; gap: 8px; }
.settings-form label { font-size: 12px; color: #aaa; }
.settings-form input {
  padding: 8px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e1e1e1;
  font-size: 13px;
}
.settings-form button { align-self: flex-start; }
```

- [ ] **Step 3: Verify popup renders**

Click the extension icon in Chrome.
Expected: Dark popup with "WL Organizer" header, gear icon, "Analyze & Sort" button, hint text.

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.css
git commit -m "feat: add popup HTML and CSS with all UI states"
```

---

### Task 10: Popup UI — JavaScript Logic

**Files:**
- Modify: `popup/popup.js`

Wires up all the popup states and message passing.

- [ ] **Step 1: Implement popup.js**

```js
// popup/popup.js

const $ = (sel) => document.querySelector(sel);

// State elements
const views = {
  idle: $('#state-idle'),
  analyzing: $('#state-analyzing'),
  preview: $('#state-preview'),
  sorting: $('#state-sorting'),
  done: $('#state-done'),
  error: $('#state-error'),
};

function showState(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

// Settings
$('#settings-btn').addEventListener('click', () => {
  $('#main-view').classList.add('hidden');
  $('#settings-view').classList.remove('hidden');
  chrome.storage.sync.get('apiKey', ({ apiKey }) => {
    if (apiKey) $('#api-key-input').value = apiKey;
  });
});

$('#settings-back').addEventListener('click', () => {
  $('#settings-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
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

// Analyze
$('#analyze-btn').addEventListener('click', async () => {
  showState('analyzing');

  // Send scrape command to content script on the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('youtube.com/playlist?list=WL')) {
    showError('Navigate to your YouTube Watch Later page first.');
    return;
  }

  try {
    // Ask content script to scrape
    const videos = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE' });

    if (!videos || videos.length === 0) {
      showError('No videos found on the Watch Later page.');
      return;
    }

    // Send to background for Claude analysis
    const result = await chrome.runtime.sendMessage({ type: 'ANALYZE', videos });

    if (!result.success) {
      showError(result.error);
      return;
    }

    renderPreview(result.sortOrder);
    showState('preview');
  } catch (err) {
    showError(err.message);
  }
});

// Preview rendering
let currentSortOrder = [];

function renderPreview(sortOrder) {
  currentSortOrder = sortOrder;
  const list = $('#preview-list');
  list.innerHTML = '';

  let currentCluster = null;

  for (const video of sortOrder) {
    const clusterName = video.cluster;

    // Add cluster header when cluster changes
    if (clusterName !== currentCluster) {
      currentCluster = clusterName;
      const label = document.createElement('div');
      label.className = clusterName === null ? 'cluster-label in-progress' : 'cluster-label topic';
      label.textContent = clusterName === null ? '\u25B6 In Progress' : clusterName;
      list.appendChild(label);
    }

    const item = document.createElement('div');
    item.className = 'preview-item';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = video.title;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = video.cluster === null
      ? `${Math.round(video.progress * 100)}%`
      : formatDuration(video.duration);

    item.appendChild(title);
    item.appendChild(meta);
    list.appendChild(item);
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Apply sort
$('#apply-btn').addEventListener('click', async () => {
  showState('sorting');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetOrder = currentSortOrder.map(v => v.id);

  // Send reorder command to content script
  chrome.tabs.sendMessage(tab.id, { type: 'REORDER', targetOrder }, (result) => {
    if (result && result.moved > 0) {
      showState('done');
    } else {
      showError('Sort failed. Try refreshing the page and sorting again.');
    }
  });

  // Listen for progress updates
  chrome.runtime.onMessage.addListener(function progressListener(msg) {
    if (msg.type === 'SORT_PROGRESS') {
      const pct = (msg.current / msg.total) * 100;
      $('#sort-progress').style.width = `${pct}%`;
      $('#sort-count').textContent = `${msg.current} / ${msg.total} videos moved`;
      if (msg.current >= msg.total) {
        chrome.runtime.onMessage.removeListener(progressListener);
      }
    }
  });
});

// Cancel
$('#cancel-btn').addEventListener('click', () => {
  currentSortOrder = [];
  showState('idle');
});

// Done
$('#done-btn').addEventListener('click', () => window.close());

// Retry
$('#retry-btn').addEventListener('click', () => showState('idle'));

// Error helper
function showError(msg) {
  $('#error-msg').textContent = msg;
  showState('error');
}
```

- [ ] **Step 2: Verify popup state transitions**

Load extension. Test:
1. Click icon → idle state shown
2. Click gear → settings view
3. Save an API key → "Saved!" appears
4. Click back → main view

Expected: Smooth transitions, no console errors.

- [ ] **Step 3: Commit**

```bash
git add popup/popup.js
git commit -m "feat: wire up popup logic with state management and message passing"
```

---

### Task 11: End-to-End Integration Test

**Files:**
- No new files — this is manual testing on the live YouTube page.

- [ ] **Step 1: Set up**

1. Load extension in Chrome
2. Open settings, enter a valid Claude API key
3. Navigate to YouTube Watch Later page (ensure you have a few videos, some partially watched)

- [ ] **Step 2: Test full analyze flow**

1. Click extension icon
2. Click "Analyze & Sort"
3. Wait for analysis to complete

Expected: Preview state shows in-progress videos at top with percentages, then topic clusters with durations.

- [ ] **Step 3: Test apply sort**

1. Click "Apply Sort"
2. Watch the YouTube page — videos should reorder one by one

Expected: Progress bar advances, videos move, final order matches the preview.

- [ ] **Step 4: Test Unwatch button**

1. Hover over a video with a red progress bar
2. "Unwatch" button should appear on the thumbnail
3. Click it

Expected: Progress bar disappears from that video.

- [ ] **Step 5: Test error states**

1. Remove API key from settings → try analyze → should show "No API key" error
2. Navigate to youtube.com homepage → try analyze → should show "Navigate to Watch Later" error
3. Enter invalid API key → try analyze → should show API error

Expected: Each error shows correctly with retry button.

- [ ] **Step 6: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 12: Run All Unit Tests & Final Cleanup

**Files:**
- Possibly modify any files with issues found

- [ ] **Step 1: Run all unit tests**

Run: `node --test tests/`
Expected: All tests in `tests/selectors.test.js`, `tests/sort.test.js`, and `tests/claude-api.test.js` PASS.

- [ ] **Step 2: Fix any failing tests**

If any tests fail due to changes made during integration, update tests or implementation to match.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and all tests passing"
```
