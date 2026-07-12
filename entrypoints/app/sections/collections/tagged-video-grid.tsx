import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { initDbProxy } from '@/lib/database';
import { useTranslation } from '@/lib/i18n/use-translation';
import { getItemsByTags, type TaggedItem } from '@/lib/tagging';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import { VideoCard } from './video-card';
import { VideoGridSkeleton } from './video-grid-skeleton';
import { TagEditPopover, useTagEditState } from './tag-edit-popover';

/**
 * Map a platform-agnostic TaggedItem back to the minimal BiliFavVideo shape
 * VideoCard expects. platformMeta was written by videos-sync with
 * { cover, intro, duration, cnt_info, attr, type, fav_time }; missing fields
 * get safe defaults.
 */
function toBiliFavVideo(item: TaggedItem): BiliFavVideo {
  const meta = item.platformMeta;
  return {
    id: 0,
    type: typeof meta.type === 'number' ? meta.type : 0,
    title: item.title,
    cover: typeof meta.cover === 'string' ? meta.cover : '',
    intro: typeof meta.intro === 'string' ? meta.intro : '',
    duration: typeof meta.duration === 'number' ? meta.duration : 0,
    bvid: item.platformItemId,
    upper: { mid: 0, name: item.authorName, face: '' },
    cnt_info:
      (meta.cnt_info as BiliFavVideo['cnt_info'] | undefined) ?? {
        play: 0,
        collect: 0,
        danmaku: 0,
      },
    fav_time: typeof meta.fav_time === 'number' ? meta.fav_time : 0,
    attr: typeof meta.attr === 'number' ? meta.attr : 0,
  };
}

interface TaggedVideoGridProps {
  tagIds: string[];
  /** Fired after a tag edit so the parent can refresh the filter chips (counts / new tags). */
  onTagsChanged?: () => void;
}

/**
 * Cross-folder grid shown while tag filters are active. Items carrying ALL
 * selected tags (AND semantics), newest first. Cards have no transcribe
 * action bar — this is a knowledge-base view, not a folder view.
 */
export function TaggedVideoGrid({ tagIds, onTagsChanged }: TaggedVideoGridProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TaggedItem[] | null>(null);
  const [version, setVersion] = useState(0);
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const key = tagIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setItems(null);

    (async () => {
      try {
        await initDbProxy();
        const result = await getItemsByTags(key.split(','));
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
  }, [key, version]);

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

  if (items === null) return <VideoGridSkeleton />;

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
            <VideoCard
              video={toBiliFavVideo(item)}
              tags={item.tags}
              onEditTags={(anchor) => openTagEditor(item.platformItemId, anchor)}
            />
          </Grid>
        ))}
      </Grid>

      <TagEditPopover
        anchorEl={editing?.anchorEl ?? null}
        platformItemId={editing?.platformItemId ?? null}
        tags={editingTags}
        onClose={closeTagEditor}
        onChanged={handleTagsChanged}
      />
    </>
  );
}
