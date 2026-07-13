import { useEffect, useState, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { initDbProxy } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';
import { useTranslation } from '@/lib/i18n/use-translation';
import { getItemsByTags, type TaggedItem } from '@/lib/tagging';
import { TagEditPopover, useTagEditState } from './tag-edit-popover';

export interface TaggedItemGridProps {
  /** Platform whose items this grid shows — filter queries and events are scoped to it. */
  platform: string;
  tagIds: string[];
  /**
   * Platform card adapter (render prop): maps a TaggedItem to this page's
   * card component. `openTagEditor` is pre-bound to the item — wire it to the
   * card's tag edit entry.
   */
  renderCard: (item: TaggedItem, openTagEditor: (anchor: HTMLElement) => void) => ReactNode;
  /** Loading placeholder shown while the first query for a filter combination runs. */
  skeleton: ReactNode;
  /** Fired after a tag edit so the parent can refresh the filter chips (counts / new tags). */
  onTagsChanged?: () => void;
}

/**
 * Grid shown while tag filters are active. Items carrying ALL selected tags
 * (AND semantics), newest first, scoped to one platform. This is a
 * knowledge-base view, not a collection view — cards carry no platform
 * action bars, only tag display/edit.
 */
export function TaggedItemGrid({
  platform,
  tagIds,
  renderCard,
  skeleton,
  onTagsChanged,
}: TaggedItemGridProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TaggedItem[] | null>(null);
  const [version, setVersion] = useState(0);
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const key = tagIds.join(',');

  // Only a filter change resets to the skeleton; version bumps (tag edits /
  // background AI tagging) re-query in place without visual churn.
  useEffect(() => {
    setItems(null);
  }, [key]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initDbProxy();
        const result = await getItemsByTags(key.split(','), platform);
        if (cancelled) return;
        setItems(result);
      } catch (err) {
        if (cancelled) return;
        console.error('[tags] Failed to load tagged items:', err);
        setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, key, version]);

  // A freshly AI-tagged item may now match the active filter — re-query so
  // it appears without any manual action. Other platforms' events are noise.
  useEffect(
    () =>
      onDomainEvent('item-tagged', (e) => {
        if (e.platform === platform) setVersion((v) => v + 1);
      }),
    [platform],
  );

  // Removing a tag can drop the item out of the AND filter; its card unmounts,
  // so close the popover instead of leaving it anchored to a detached node.
  useEffect(() => {
    if (
      editing &&
      items !== null &&
      !items.some((item) => item.platformItemId === editing.platformItemId)
    ) {
      closeTagEditor();
    }
  }, [items, editing, closeTagEditor]);

  const handleTagsChanged = () => {
    // Re-query: an edit may drop the item out of the current filter.
    setVersion((v) => v + 1);
    onTagsChanged?.();
  };

  if (items === null) return <>{skeleton}</>;

  if (items.length === 0) {
    return (
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 240,
          borderRadius: 2,
          border: `2px dashed ${theme.vars.palette.grey[300]}`,
        })}
      >
        <Typography variant="body1" sx={{ color: 'text.disabled' }}>
          {t('tags.noMatches')}
        </Typography>
      </Box>
    );
  }

  const editingTags = editing
    ? (items.find((item) => item.platformItemId === editing.platformItemId)?.tags ?? [])
    : [];

  return (
    <>
      <Grid container spacing={2.5}>
        {items.map((item) => (
          <Grid key={item.itemId} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            {renderCard(item, (anchor) => openTagEditor(item.platformItemId, anchor))}
          </Grid>
        ))}
      </Grid>

      <TagEditPopover
        platform={platform}
        anchorEl={editing?.anchorEl ?? null}
        platformItemId={editing?.platformItemId ?? null}
        tags={editingTags}
        onClose={closeTagEditor}
        onChanged={handleTagsChanged}
      />
    </>
  );
}
