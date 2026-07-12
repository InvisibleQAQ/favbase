import { useCallback, useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { getAllUsedTags, getTagsForPlatformItems, type TagRef, type UsedTag } from '@/lib/tagging';

/** Platform key for all tag operations in this (bilibili-only) section. */
export const BILI_PLATFORM = 'bilibili';

/**
 * Batch-load tags for the current page of video cards (bvid → TagRef[]).
 * Reloads when the bvid list changes (pagination / folder switch); `refresh()`
 * re-fetches after a manual tag edit. Only items that HAVE tags appear in the
 * record — callers use `tagsByBvid[bvid] ?? []`.
 */
export function useItemTags(bvids: string[]): {
  tagsByBvid: Record<string, TagRef[]>;
  refresh: () => void;
} {
  const [tagsByBvid, setTagsByBvid] = useState<Record<string, TagRef[]>>({});
  const [version, setVersion] = useState(0);
  const key = bvids.join(',');

  useEffect(() => {
    if (!key) {
      setTagsByBvid({});
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        await initDbProxy();
        const map = await getTagsForPlatformItems(BILI_PLATFORM, key.split(','));
        if (cancelled) return;
        setTagsByBvid(map);
      } catch (err) {
        if (cancelled) return;
        console.error('[tags] Failed to load item tags:', err);
        setTagsByBvid({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { tagsByBvid, refresh };
}

/**
 * All tags linked to at least one item (most-used first) for the filter chips.
 * `refresh()` after tag edits so counts / new tags stay current.
 */
export function useUsedTags(): { usedTags: UsedTag[]; refresh: () => void } {
  const [usedTags, setUsedTags] = useState<UsedTag[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initDbProxy();
        const rows = await getAllUsedTags();
        if (cancelled) return;
        setUsedTags(rows);
      } catch (err) {
        if (cancelled) return;
        console.error('[tags] Failed to load used tags:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { usedTags, refresh };
}
