import type { ComponentType } from 'react';

// Type-only: the row contract the paged queries hand their mapper — no drizzle,
// entity or `getDb` comes with it (see this directory's CLAUDE.md).
import type { PagedItemRow } from '@/lib/database/collection-queries';
import type { TaggedItem, TagRef } from '@/lib/tagging';

/** What `TaggedItemGrid.renderCard` and the `/collections` registry hand a card adapter. */
export interface TaggedCardProps {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}

type CardProps<K extends string, T> = Record<K, T> & {
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
};

/**
 * A platform card as a tag-grid adapter. `toItem` is the platform's lib
 * `mapRow` — the same function its paged query maps rows with — so the tag
 * grid and the platform grid cannot drift apart. `prop` is the card's item
 * prop (`repo`, `bookmark`, `video`, …); `tsc` rejects a misspelled key or a
 * mapper that does not produce what the card takes, at the call site.
 */
export function taggedCard<K extends string, T>(
  Card: ComponentType<CardProps<K, T>>,
  prop: K,
  toItem: (row: PagedItemRow) => T,
): ComponentType<TaggedCardProps> {
  return function TaggedCard({ item, onEditTags }: TaggedCardProps) {
    const row: PagedItemRow = {
      id: item.itemId,
      platformItemId: item.platformItemId,
      title: item.title,
      authorName: item.authorName,
      originalUrl: item.originalUrl,
      publishedAt: item.publishedAt,
      platformMeta: item.platformMeta,
    };
    // A computed generic key widens to a string index signature.
    const props = { [prop]: toItem(row), tags: item.tags, onEditTags } as CardProps<K, T>;
    return <Card {...props} />;
  };
}
