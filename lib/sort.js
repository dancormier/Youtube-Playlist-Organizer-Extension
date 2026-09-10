// lib/sort.js
import { TAXONOMY, OTHER_GROUP, UNAVAILABLE_GROUP } from './taxonomy.js';

/** Watch percentages below this count as unwatched. Exactly this value counts as watched. */
export const WATCHED_THRESHOLD = 10;

export function effectiveProgress(video, overrides = []) {
  if (overrides.includes(video.id)) return 0;
  if (video.percentWatched < WATCHED_THRESHOLD) return 0;
  return video.percentWatched;
}

/**
 * Fold cluster names onto one canonical spelling.
 *
 * Group identity is a plain string match, so `"tech & ai"` and `"Tech & AI"`
 * used to become two separate groups with two headings. The model is asked for
 * the taxonomy's exact spellings but is not guaranteed to obey, and stray
 * whitespace is just as likely.
 *
 * Taxonomy spellings always win. Names the model invented fold onto whichever
 * spelling arrived first, so they stay consistent within a single sort even
 * though there is no canonical form to appeal to.
 */
function makeCanonicaliser(taxonomy) {
  const seen = new Map(
    [...taxonomy, OTHER_GROUP, UNAVAILABLE_GROUP].map(name => [name.toLowerCase(), name]),
  );
  return (raw) => {
    const trimmed = String(raw ?? '').trim();
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
    return seen.get(key);
  };
}

/** Sort videos by duration ascending. Used for regular playlists. */
export function buildDurationSortOrder(videos) {
  return [...videos].sort((a, b) => a.duration - b.duration);
}

/**
 * Order:
 *   1. In progress, by remaining watch time ascending
 *   2. Topic groups in taxonomy order, by duration ascending within each
 *   3. Other, then Unavailable
 */
export function buildSortOrder(videos, clusterResult, overrides = [], taxonomy = TAXONOMY) {
  if (videos.length === 0) return [];

  const available = videos.filter(v => !v.unavailable);
  const unavailable = videos
    .filter(v => v.unavailable)
    .map(v => ({ ...v, cluster: UNAVAILABLE_GROUP }));

  const inProgress = available
    .filter(v => effectiveProgress(v, overrides) > 0)
    .sort((a, b) => {
      const remainingA = a.duration * (1 - effectiveProgress(a, overrides) / 100);
      const remainingB = b.duration * (1 - effectiveProgress(b, overrides) / 100);
      return remainingA - remainingB;
    })
    .map(v => ({ ...v, cluster: null }));

  const unwatched = available.filter(v => effectiveProgress(v, overrides) === 0);

  const canonical = makeCanonicaliser(taxonomy);
  const clusterOf = new Map();
  for (const cluster of clusterResult.clusters || []) {
    const name = canonical(cluster.name);
    for (const videoId of cluster.videoIds) clusterOf.set(videoId, name);
  }

  const groups = new Map();
  for (const video of unwatched) {
    const name = clusterOf.get(video.id) || OTHER_GROUP;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ ...video, cluster: name });
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.duration - b.duration);
  }

  // Taxonomy order first, then any model-invented names, then Other.
  const custom = taxonomy.filter(name => name !== OTHER_GROUP && name !== UNAVAILABLE_GROUP);
  const invented = [...groups.keys()]
    .filter(name => !custom.includes(name) && name !== OTHER_GROUP)
    .sort();
  const ordered = [...custom, ...invented, OTHER_GROUP];

  const grouped = [];
  for (const name of ordered) {
    if (groups.has(name)) grouped.push(...groups.get(name));
  }

  return [...inProgress, ...grouped, ...unavailable];
}
