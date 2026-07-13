import { useCallback, useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';
import { getAllUsedTags, getTagsForPlatformItems, type TagRef, type UsedTag } from '@/lib/tagging';

/**
 * Batch-load tags for the current page of cards (platformItemId → TagRef[]).
 * Reloads when the id list changes (pagination / collection switch);
 * `refresh()` re-fetches after a manual tag edit. Only items that HAVE tags
 * appear in the record — callers use `tagsById[id] ?? []`.
 */
export function useItemTags(
  platform: string,
  ids: string[],
): {
  tagsById: Record<string, TagRef[]>;
  refresh: () => void;
} {
  const [tagsById, setTagsById] = useState<Record<string, TagRef[]>>({});
  const [version, setVersion] = useState(0);
  const key = ids.join(',');

  useEffect(() => {
    if (!key) {
      setTagsById({});
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        await initDbProxy();
        const map = await getTagsForPlatformItems(platform, key.split(','));
        if (cancelled) return;
        setTagsById(map);
      } catch (err) {
        if (cancelled) return;
        console.error('[tags] Failed to load item tags:', err);
        setTagsById({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, key, version]);

  // Auto-refresh when AI tagging lands for an item on the current page
  // (fires seconds after the transcription itself reports done). Ids compare
  // case-insensitively — some platforms use case-mixed item ids.
  useEffect(() => {
    if (!key) return;
    const idSet = new Set(key.toLowerCase().split(','));
    return onDomainEvent('item-tagged', (e) => {
      if (e.platform === platform && idSet.has(e.platformItemId.toLowerCase())) {
        setVersion((v) => v + 1);
      }
    });
  }, [platform, key]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { tagsById, refresh };
}

/**
 * All tags linked to at least one item (most-used first) for the filter chips.
 * Pass `platform` to scope the tag list and counts to one platform's items
 * (page-scoped chips); omit for the whole library. `refresh()` after tag
 * edits so counts / new tags stay current.
 */
export function useUsedTags(platform?: string): { usedTags: UsedTag[]; refresh: () => void } {
  const [usedTags, setUsedTags] = useState<UsedTag[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initDbProxy();
        const rows = await getAllUsedTags(platform);
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
  }, [platform, version]);

  // New AI tags / count changes must reach the filter chips as they happen.
  // Platform-scoped consumers ignore events from other platforms.
  useEffect(
    () =>
      onDomainEvent('item-tagged', (e) => {
        if (!platform || e.platform === platform) setVersion((v) => v + 1);
      }),
    [platform],
  );

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { usedTags, refresh };
}
