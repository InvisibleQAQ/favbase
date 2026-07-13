import { useCallback, useEffect, useState } from 'react';

import type { UsedTag } from '@/lib/tagging';

/**
 * Selected-tag-filter state shared by collection pages: multi-select toggle,
 * clear, and orphan pruning against the live used-tag list.
 */
export function useTagFilter(usedTags: UsedTag[]): {
  selectedTagIds: string[];
  toggleTag: (tagId: string) => void;
  clearTags: () => void;
} {
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  const clearTags = useCallback(() => setSelectedTagIds([]), []);

  // Prune selections whose tag became orphaned (last link removed via edit):
  // an orphan renders no chip — and when it was the ONLY used tag,
  // TagFilterChips vanishes entirely (no Clear button), trapping the user in
  // an un-clearable "no matches" grid.
  useEffect(() => {
    setSelectedTagIds((prev) => {
      const valid = new Set(usedTags.map((tag) => tag.id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [usedTags]);

  return { selectedTagIds, toggleTag, clearTags };
}
