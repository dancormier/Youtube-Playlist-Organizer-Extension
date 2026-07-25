// tests/playlist.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

function load(innerTube = {}) {
  const stub = {
    findAll(obj, key, found = []) {
      if (obj === null || typeof obj !== 'object') return found;
      if (Array.isArray(obj)) { for (const v of obj) this.findAll(v, key, found); return found; }
      for (const [k, v] of Object.entries(obj)) {
        if (k === key) found.push(v);
        this.findAll(v, key, found);
      }
      return found;
    },
    ...innerTube,
  };
  return loadGlobal('content/playlist.js', 'WLPlaylist', { WLInnerTube: stub });
}

function renderer(overrides = {}) {
  return {
    videoId: 'abc123',
    setVideoId: 'SET1',
    lengthSeconds: '520',
    title: { runs: [{ text: 'Some Video' }] },
    shortBylineText: { runs: [{ text: 'Some Channel' }] },
    thumbnailOverlays: [
      { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 32 } },
    ],
    ...overrides,
  };
}

describe('WLPlaylist.browseIdFor', () => {
  it('maps WL to VLWL', () => {
    assert.equal(load().browseIdFor('WL'), 'VLWL');
  });
  it('prefixes other playlists with VL', () => {
    assert.equal(load().browseIdFor('PLabc'), 'VLPLabc');
  });
});

describe('WLPlaylist.normalize', () => {
  it('extracts every field', () => {
    const video = load().normalize(renderer());
    assert.equal(video.id, 'abc123');
    assert.equal(video.setVideoId, 'SET1');
    assert.equal(video.title, 'Some Video');
    assert.equal(video.channel, 'Some Channel');
    assert.equal(video.duration, 520);
    assert.equal(video.percentWatched, 32);
    assert.equal(video.unavailable, false);
  });

  it('defaults percentWatched to 0 when there is no resume overlay', () => {
    const video = load().normalize(renderer({ thumbnailOverlays: [] }));
    assert.equal(video.percentWatched, 0);
  });

  it('initialises enrichment fields to null', () => {
    const video = load().normalize(renderer());
    assert.equal(video.category, null);
    assert.equal(video.description, null);
  });

  it('marks entries with no title as unavailable', () => {
    const video = load().normalize(renderer({ title: undefined }));
    assert.equal(video.unavailable, true);
    assert.equal(video.title, '[Unavailable]');
  });

  it('returns null when there is no setVideoId, since reorder is impossible', () => {
    assert.equal(load().normalize(renderer({ setVideoId: undefined })), null);
  });

  it('defaults a missing channel to Unknown', () => {
    const video = load().normalize(renderer({ shortBylineText: undefined }));
    assert.equal(video.channel, 'Unknown');
  });
});

describe('WLPlaylist.read', () => {
  it('flattens every page into one list', async () => {
    const playlist = load({
      pageAll: async () => [
        { contents: [{ playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) }] },
        { contents: [{ playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: 'S2' }) }] },
      ],
    });
    const videos = await playlist.read('WL');
    assert.deepEqual([...videos.map(v => v.id)], ['a', 'b']);
  });

  it('deduplicates entries repeated across pages', async () => {
    const dupe = { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) };
    const playlist = load({ pageAll: async () => [{ contents: [dupe] }, { contents: [dupe] }] });
    const videos = await playlist.read('WL');
    assert.equal(videos.length, 1);
  });

  it('skips renderers with no setVideoId', async () => {
    const playlist = load({
      pageAll: async () => [{
        contents: [
          { playlistVideoRenderer: renderer({ videoId: 'a', setVideoId: 'S1' }) },
          { playlistVideoRenderer: renderer({ videoId: 'b', setVideoId: undefined }) },
        ],
      }],
    });
    const videos = await playlist.read('WL');
    assert.deepEqual([...videos.map(v => v.id)], ['a']);
  });
});
