import type { UsedTag } from '@/lib/tagging';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedCollectionTagFilter {
  tagId: string | null;
  shouldClean: boolean;
}

export function resolveCollectionTagFilter(
  values: string[],
  usedTags: UsedTag[],
): ResolvedCollectionTagFilter {
  if (values.length === 0) return { tagId: null, shouldClean: false };
  if (values.length !== 1) return { tagId: null, shouldClean: true };

  const [tagId] = values;
  const knownTag = UUID_PATTERN.test(tagId)
    ? usedTags.find((tag) => tag.id.toLowerCase() === tagId.toLowerCase())
    : undefined;
  return knownTag
    ? { tagId: knownTag.id, shouldClean: false }
    : { tagId: null, shouldClean: true };
}

export function updateCollectionTagParams(
  current: URLSearchParams,
  tagId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('tag');
  if (tagId) next.set('tag', tagId);
  return next;
}
