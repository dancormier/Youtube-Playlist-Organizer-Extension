// lib/sort.js
import { TAXONOMY, OTHER_GROUP, UNAVAILABLE_GROUP } from './taxonomy.js';

/** Watch percentages below this count as unwatched. Exactly this value counts as watched. */
export const WATCHED_THRESHOLD = 10;

export const SORT_DEFAULTS = Object.freeze({
  withinGroup: 'duration-asc',
  inProgress: 'top',
  groupOrder: 'taxonomy',
});

/** One entry per option, in the order the UI should offer them. */
export const SORT_CHOICES = Object.freeze({
  withinGroup: [
    { value: 'duration-asc', label: 'Shortest first' },
    { value: 'duration-desc', label: 'Longest first' },
    { value: 'playlist', label: 'Playlist order' },
    { value: 'title', label: 'Title A–Z' },
  ],
  inProgress: [
    { value: 'top', label: 'Own group on top' },
    { value: 'within', label: 'Inside their category' },
  ],
  groupOrder: [
    { value: 'taxonomy', label: 'My category order' },
    { value: 'size', label: 'Largest group first' },
    { value: 'alpha', label: 'Alphabetical' },
  ],
});

// Values that shipped once and were later removed, mapped onto their nearest
// surviving choice so a saved setting keeps its intent instead of resetting.
const LEGACY_SORT_VALUES = {
  inProgress: { ignore: 'within' },
};

export function normalizeSortOptions(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(SORT_DEFAULTS)) {
    const value = LEGACY_SORT_VALUES[key]?.[source[key]] ?? source[key];
    const allowed = SORT_CHOICES[key].some(choice => choice.value === value);
    out[key] = allowed ? value : fallback;
  }
  return out;
}

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

function compareTitles(a, b) {
  return String(a.title ?? '').localeCompare(String(b.title ?? ''), undefined, { sensitivity: 'base' });
}

// 'playlist' has no comparator: the videos already arrive in playlist order and
// every step below preserves it.
const WITHIN_GROUP = {
  'duration-asc': (a, b) => a.duration - b.duration,
  'duration-desc': (a, b) => b.duration - a.duration,
  'playlist': null,
  'title': compareTitles,
};

/**
 * Order (with the default options):
 *   1. In progress, by remaining watch time ascending
 *   2. Topic groups in taxonomy order, by duration ascending within each
 *   3. Other, then Unavailable
 *
 * `options` (see SORT_CHOICES) moves the in-progress videos into their groups,
 * changes the order inside a group, and changes the order of the groups.
 * Unavailable is last whatever the options say.
 *
 * Every available video carries `inProgress` in the output, because with
 * `inProgress: 'within'` a started video keeps its cluster name and the UI can
 * no longer infer "started" from `cluster === null`.
 */
export function buildSortOrder(videos, clusterResult, overrides = [], taxonomy = TAXONOMY, options = {}) {
  if (videos.length === 0) return [];
  const { withinGroup, inProgress, groupOrder } = normalizeSortOptions(options);

  const remaining = (v) => v.duration * (1 - effectiveProgress(v, overrides) / 100);
  const byRemaining = (a, b) => remaining(a) - remaining(b);
  const withinComparator = WITHIN_GROUP[withinGroup];
  const sortWithin = (list) => (withinComparator ? list.sort(withinComparator) : list);

  const available = videos
    .filter(v => !v.unavailable)
    .map(v => ({ ...v, inProgress: effectiveProgress(v, overrides) > 0 }));
  const unavailable = videos
    .filter(v => v.unavailable)
    .map(v => ({ ...v, cluster: UNAVAILABLE_GROUP }));

  const top = inProgress === 'top'
    ? available.filter(v => v.inProgress).sort(byRemaining).map(v => ({ ...v, cluster: null }))
    : [];
  const toGroup = inProgress === 'top' ? available.filter(v => !v.inProgress) : available;

  const canonical = makeCanonicaliser(taxonomy);
  const clusterOf = new Map();
  for (const cluster of clusterResult.clusters || []) {
    const name = canonical(cluster.name);
    for (const videoId of cluster.videoIds) clusterOf.set(videoId, name);
  }

  const groups = new Map();
  for (const video of toGroup) {
    const name = clusterOf.get(video.id) || OTHER_GROUP;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ ...video, cluster: name });
  }
  // With 'top' the started videos were already pulled out above, so this pass
  // is a plain sortWithin; with 'within' it floats the started ones first.
  for (const [name, group] of groups) {
    const started = group.filter(v => v.inProgress).sort(byRemaining);
    const rest = sortWithin(group.filter(v => !v.inProgress));
    groups.set(name, [...started, ...rest]);
  }

  // Taxonomy order first, then any model-invented names, then Other.
  const custom = taxonomy.filter(name => name !== OTHER_GROUP && name !== UNAVAILABLE_GROUP);
  const invented = [...groups.keys()]
    .filter(name => !custom.includes(name) && name !== OTHER_GROUP)
    .sort();
  const byTaxonomy = [...custom, ...invented].filter(name => groups.has(name));

  let ordered = byTaxonomy;
  if (groupOrder === 'size') {
    const rank = new Map(byTaxonomy.map((name, i) => [name, i]));
    ordered = [...byTaxonomy].sort((a, b) =>
      groups.get(b).length - groups.get(a).length || rank.get(a) - rank.get(b));
  } else if (groupOrder === 'alpha') {
    ordered = [...byTaxonomy].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  const grouped = [];
  for (const name of [...ordered, OTHER_GROUP]) {
    if (groups.has(name)) grouped.push(...groups.get(name));
  }

  return [...top, ...grouped, ...unavailable];
}
