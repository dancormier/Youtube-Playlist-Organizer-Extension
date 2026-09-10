// lib/taxonomy.js
// The built-in defaults. Users override the list and the new-category limit
// in the popup (lib/settings.js); these are what an empty setting falls back to.
// Ordered casual → serious; anything unrecognised sorts after these.

export const TAXONOMY = [
  'Music',
  'Comedy & Entertainment',
  'Food & Cooking',
  'Home & DIY',
  'Health & Fitness',
  'Tech & AI',
  'Geography & Nature',
  'Science & Space',
  'True Crime & History',
  'Philosophy & Self-Help',
  'Politics & News',
];

export const OTHER_GROUP = 'Other';
export const UNAVAILABLE_GROUP = 'Unavailable';
export const MAX_NEW_CATEGORIES = 2;
