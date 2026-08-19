import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';

export const PLATFORM_DIRS = COLLECTION_PLATFORMS.map((platform) => `lib/${platform}`);

const PLATFORM_ENV_PREFIXES = COLLECTION_PLATFORMS
  .map((platform) => platform.toUpperCase())
  .join('|');

/** Matches documented platform env keys while preserving the key in group 1. */
export const PLATFORM_KEY_LINE = new RegExp(
  `^#?\\s*(VITE_(?:${PLATFORM_ENV_PREFIXES})_[A-Z0-9_]+)=`,
);
