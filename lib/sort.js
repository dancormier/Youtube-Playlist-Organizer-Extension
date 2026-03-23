// lib/sort.js

/**
 * Build the final sort order from videos and AI cluster assignments.
 *
 * Order:
 * 1. In-progress videos (progress > 0), sorted by remaining watch time ascending
 * 2. Clustered videos grouped by cluster, sorted by duration ascending within each cluster
 * 3. Videos not assigned to any cluster go into an "Other" group at the end
 */
/**
 * Sort videos by duration ascending. Used for regular playlists.
 */
export function buildDurationSortOrder(videos) {
  return [...videos].sort((a, b) => a.duration - b.duration);
}

export function buildSortOrder(videos, clusterResult) {
  if (videos.length === 0) return [];

  const inProgress = videos
    .filter(v => v.progress > 0)
    .sort((a, b) => {
      const remainA = a.duration * (1 - a.progress);
      const remainB = b.duration * (1 - b.progress);
      return remainA - remainB;
    })
    .map(v => ({ ...v, cluster: null }));

  const unwatched = videos.filter(v => v.progress === 0);

  const videoClusterMap = new Map();
  for (const cluster of clusterResult.clusters) {
    for (const videoId of cluster.videoIds) {
      videoClusterMap.set(videoId, cluster.name);
    }
  }

  const groups = new Map();
  for (const video of unwatched) {
    const clusterName = videoClusterMap.get(video.id) || 'Other';
    if (!groups.has(clusterName)) groups.set(clusterName, []);
    groups.get(clusterName).push({ ...video, cluster: clusterName });
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.duration - b.duration);
  }

  const clusterOrder = clusterResult.clusters.map(c => c.name);
  const sorted = [];
  for (const name of clusterOrder) {
    if (groups.has(name)) {
      sorted.push(...groups.get(name));
      groups.delete(name);
    }
  }
  for (const group of groups.values()) {
    sorted.push(...group);
  }

  return [...inProgress, ...sorted];
}
