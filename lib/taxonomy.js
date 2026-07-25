// lib/taxonomy.js
// Ordered casual → serious. The model assigns into this list and may add a
// small number of its own; anything unrecognised sorts after these.

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
