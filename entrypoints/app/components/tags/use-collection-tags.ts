import { useCallback } from 'react';

import type { TagRef, UsedTag } from '@/lib/tagging';

import { useItemTags, useUsedTags } from './use-item-tags';
import { useTagFilter } from './use-tag-filter';
import { useTagEditState } from './tag-edit-popover';

export interface UseCollectionTagsReturn {
  /** platformItemId → tags for the current page of cards. */
  tagsById: Record<string, TagRef[]>;
  /** Single popover anchor state for the grid. */
  editing: { platformItemId: string; anchorEl: HTMLElement } | null;
  openTagEditor: (platformItemId: string, anchorEl: HTMLElement) => void;
  closeTagEditor: () => void;
  /** Platform-scoped used tags for the filter chips. */
  usedTags: UsedTag[];
  selectedTagIds: string[];
  toggleTag: (tagId: string) => void;
  clearTags: () => void;
  /**
   * Refresh both channels after a manual tag edit. MUST be the onChanged /
   * onTagsChanged callback for every editor in this section — see note below.
   */
  handleTagsChanged: () => void;
}

/**
 * The tag wiring shared by every collection page (github / x / zhihu): batch
 * page tags + single popover + platform-scoped filter chips, bundled so a new
 * platform gets tagging by passing `(platform, pageItemIds)` — no five-hook
 * copy, no chance to mis-wire the refresh.
 *
 * Sealed invariant: `handleTagsChanged` refreshes BOTH item tags and used tags.
 * `useItemTags` lives at the view's top level and never unmounts while a tag
 * filter is active, so an edit made in the tagged grid must also refresh
 * `tagsById` — otherwise the normal grid shows stale tags after the filter
 * clears. Callers pass `handleTagsChanged` (not the narrower `refreshUsedTags`)
 * to both the popover and the tagged grid; bundling it here removes the footgun
 * each view previously documented by hand.
 */
export function useCollectionTags(platform: string, itemIds: string[]): UseCollectionTagsReturn {
  const { tagsById, refresh: refreshItemTags } = useItemTags(platform, itemIds);
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const { usedTags, refresh: refreshUsedTags } = useUsedTags(platform);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  const handleTagsChanged = useCallback(() => {
    refreshItemTags();
    refreshUsedTags();
  }, [refreshItemTags, refreshUsedTags]);

  return {
    tagsById,
    editing,
    openTagEditor,
    closeTagEditor,
    usedTags,
    selectedTagIds,
    toggleTag,
    clearTags,
    handleTagsChanged,
  };
}
