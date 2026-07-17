import { useParams, useNavigate } from 'react-router-dom';

import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SectionTitleBar,
  SearchField,
  CardGrid,
  CardGridItem,
  CardGridPagination,
} from '../../components/collection';
import {
  useItemTags,
  useUsedTags,
  useTagFilter,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
  useTagEditState,
} from '../../components/tags';
import { useBookmarks } from './use-bookmarks';
import { FolderChips } from './folder-chips';
import { BookmarkCard } from './bookmark-card';
import { TaggedBookmarkCard } from './tagged-bookmark-card';
import { BookmarkGridSkeleton } from './bookmark-grid-skeleton';

/** Platform key for all tag operations in this (bookmarks-only) section. */
const PLATFORM = 'bookmarks';

// ---------------------------------------------------------------------------
// Dashed-box states — shared StateBox shell, bookmarks copy/actions here
// ---------------------------------------------------------------------------

/** Library empty after an auto-sync — the user has no http(s) bookmarks. No
 *  action: a re-scan won't surface anything, unlike github's connect/sync flow. */
function EmptyState() {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:bookmark-bold-duotone"
          width={64}
          sx={{ color: 'text.secondary', mb: 1 }}
        />
      }
      title={t('bookmarks.emptyTitle')}
      description={t('bookmarks.emptyDesc')}
    />
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:danger-triangle-bold-duotone"
          width={64}
          sx={{ color: 'error.main', mb: 1 }}
        />
      }
      title={t('common.loadFailed')}
      description={message}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

/** Search / folder filter matched nothing. */
function NoMatchesState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {t('bookmarks.noMatches')}
      </Typography>
    </StateBox>
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + search + folder chips + tag chips + bookmark grid
// ---------------------------------------------------------------------------

export function BookmarksView() {
  const { t } = useTranslation();
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const bm = useBookmarks(folderId);

  // Manual tagging — batch-load tags for the current page, single popover
  // instance, platform-scoped filter chips.
  const { tagsById, refresh: refreshItemTags } = useItemTags(
    PLATFORM,
    bm.bookmarks.map((b) => b.normalizedUrl),
  );
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const { usedTags, refresh: refreshUsedTags } = useUsedTags(PLATFORM);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  const handleTagsChanged = () => {
    refreshItemTags();
    refreshUsedTags();
  };

  const handleSelectFolder = (id: string | undefined) => {
    navigate(id ? `/collections/bookmarks/${id}` : '/collections/bookmarks');
  };

  const captionParts: string[] = [];
  if (bm.libraryCount > 0) {
    captionParts.push(t('bookmarks.count', { count: bm.libraryCount }));
  }
  if (bm.lastSyncedAt) {
    captionParts.push(t('bookmarks.lastSynced', { time: formatDateTime(bm.lastSyncedAt.getTime()) }));
  }

  return (
    <DashboardContent maxWidth="xl">
      {/* Auto-synced on mount — no sync button (local + instant + insert-only). */}
      <SectionTitleBar
        title={t('bookmarks.title')}
        caption={captionParts.length > 0 ? captionParts.join(' · ') : undefined}
      />

      {/* Sync failure banner (library still shows its persisted data) */}
      {bm.syncError && bm.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('bookmarks.syncFailed', { error: bm.syncError })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over title/domain, scoped to the selected folder */}
      <SearchField
        value={bm.searchInput}
        onChange={bm.setSearchInput}
        placeholder={t('bookmarks.searchPlaceholder')}
      />

      {/* Folder chips — "All" + one per folder; hidden until the library has content */}
      {bm.libraryCount > 0 && (
        <FolderChips
          folders={bm.folders}
          totalCount={bm.libraryCount}
          selectedId={folderId}
          onSelect={handleSelectFolder}
        />
      )}

      {/* Tag filter chips — bookmarks-scoped, multi-select AND; hidden when no used tags */}
      <TagFilterChips
        tags={usedTags}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        onClear={clearTags}
      />

      {/* Content: tag-filtered grid takes over while filters are active */}
      {selectedTagIds.length > 0 ? (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => (
            <TaggedBookmarkCard item={item} onEditTags={openEditor} />
          )}
          skeleton={<BookmarkGridSkeleton />}
          // handleTagsChanged (not just refreshUsedTags): useItemTags lives at
          // this view's top level and never unmounts while the filter is active,
          // so edits in the tagged grid must also refresh tagsById.
          onTagsChanged={handleTagsChanged}
        />
      ) : bm.syncError && bm.libraryCount === 0 ? (
        <ErrorState message={bm.syncError} onRetry={bm.sync} />
      ) : bm.metaLoading || (bm.syncing && bm.libraryCount === 0) ? (
        <BookmarkGridSkeleton />
      ) : bm.libraryCount === 0 ? (
        <EmptyState />
      ) : bm.queryError ? (
        <ErrorState message={bm.queryError} onRetry={bm.retryQuery} />
      ) : bm.loading ? (
        <BookmarkGridSkeleton />
      ) : bm.bookmarks.length === 0 ? (
        <NoMatchesState />
      ) : (
        <>
          <CardGrid>
            {bm.bookmarks.map((bookmark) => (
              <CardGridItem key={bookmark.id}>
                <BookmarkCard
                  bookmark={bookmark}
                  tags={tagsById[bookmark.normalizedUrl] ?? []}
                  onEditTags={(anchor) => openTagEditor(bookmark.normalizedUrl, anchor)}
                />
              </CardGridItem>
            ))}
          </CardGrid>

          <TagEditPopover
            platform={PLATFORM}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editing ? (tagsById[editing.platformItemId] ?? []) : []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />

          <CardGridPagination page={bm.page} totalPages={bm.totalPages} onChange={bm.goToPage} />
        </>
      )}
    </DashboardContent>
  );
}
