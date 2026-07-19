import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';

import type { TagRef, TaggedItem } from '@/lib/tagging';

import { DashboardContent } from '../../layouts/dashboard';
import { resolveCollectionPhase } from '../../hooks/collection-phase';
import {
  useCollectionTags,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
} from '../tags';
import { SectionTitleBar } from './section-title-bar';
import { SearchField } from './search-field';
import { CardGrid, CardGridItem, CardGridPagination } from './card-grid';
import { ErrorState } from './error-state';
import { NoMatchesState } from './no-matches-state';

/**
 * Pre-translated copy for a collection page. The scaffold lives in the
 * zero-`t()` `components/collection/` layer, so every user-facing string is
 * translated by the consuming view and handed in here (the i18n seam).
 */
export interface CollectionPageCopy {
  /** SectionTitleBar heading. */
  title: string;
  /** SectionTitleBar sub-caption (count · lastSynced), already joined; omit to hide. */
  caption?: string;
  searchPlaceholder: string;
  /** no-matches phase message. */
  noMatches: string;
  /** SectionTitleBar sync button labels. */
  syncLabel: string;
  syncingLabel: string;
  /** ErrorState title for both query-error and sync-error phases (`common.loadFailed`). */
  loadFailed: string;
  /** ErrorState retry button (`common.retry`). */
  retry: string;
  /** sync-error phase message — the structured sync error mapped to copy by the view. */
  syncErrorText: string;
  /** Failure banner shown above the still-populated library (`{platform}.syncFailed`). */
  syncFailedBanner: string;
}

export interface CollectionPageScaffoldProps<T> {
  /** Platform discriminator — scopes every tag operation on this page. */
  platform: string;

  // --- rows + identity ------------------------------------------------------
  /** Current page of platform rows. */
  items: T[];
  /** Stable React `key` for a grid cell (the DB row id). */
  getRowKey: (item: T) => string | number;
  /** Platform item id used for tagging (tweetId / videoId / repoId / …). */
  getTagId: (item: T) => string;

  // --- raw phase signals (the scaffold computes resolveCollectionPhase) ------
  libraryCount: number;
  /** Paged query in flight (library already known non-empty). */
  loading: boolean;
  /** Library meta (count / chips) still loading. */
  metaLoading: boolean;
  syncing: boolean;
  /** Paged query error message, or null. Drives the query-error phase + message. */
  queryError: string | null;
  /** A sync error is present (any kind). */
  hasSyncError: boolean;
  /** The sync error is an auth failure (platforms without the concept pass false). */
  authFailed: boolean;

  // --- pagination -----------------------------------------------------------
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;

  // --- actions --------------------------------------------------------------
  /** Sync trigger — powers both the title-bar button and the sync-error retry. */
  onSync: () => void;
  /** Re-run the failed paged query. */
  onRetryQuery: () => void;
  /** Hard-disable the title-bar sync button while not syncing (X cooldown).
   *  Optional — platforms without a cooldown omit it (unchanged behavior). */
  syncDisabled?: boolean;
  /** Pre-translated label shown on the sync button while `syncDisabled`. */
  syncDisabledLabel?: string;

  // --- search ---------------------------------------------------------------
  searchInput: string;
  onSearchInput: (value: string) => void;

  // --- copy -----------------------------------------------------------------
  copy: CollectionPageCopy;

  // --- render slots ---------------------------------------------------------
  /** Normal grid card. `tags`/`onEditTags` are pre-bound to the item by the scaffold. */
  renderCard: (item: T, tags: TagRef[], onEditTags: (anchor: HTMLElement) => void) => ReactNode;
  /** Tag-filtered grid card (render-prop for TaggedItemGrid). */
  renderTaggedCard: (item: TaggedItem, openEditor: (anchor: HTMLElement) => void) => ReactNode;
  /** Loading placeholder (grid-shaped skeleton). Reused by skeleton + tag-filtered phases. */
  skeleton: ReactNode;
  /** Facet chips (author / playlist / language …). Hidden until the library has content. */
  chips: ReactNode;
  /** empty-library phase content (platform sync guide). */
  emptyState: ReactNode;
  /** auth-failed phase content. Omit for platforms without the concept (falls back to emptyState). */
  authFailedState?: ReactNode;
  /** Sync progress bar. Rendered only while syncing; omit for platforms without one. */
  progressBar?: ReactNode;
}

/**
 * The orchestration shared by every "single list + facet chips + manual sync"
 * collection page (github / x / zhihu / youtube). Owns the tag wiring
 * (`useCollectionTags`), the content-phase ladder (`resolveCollectionPhase` +
 * its 8-case render), the two-id mapping (grid key vs tag id), the main-grid
 * TagEditPopover + pagination, and the page skeleton region with its five
 * conditional gates. Platforms inject only their cards, chips, states, progress
 * bar and pre-translated copy — no phase wiring is copied per platform.
 *
 * The config gate (missing token / api key) is NOT here: it is a
 * platform-specific early return that runs in the view before this renders.
 */
export function CollectionPageScaffold<T>({
  platform,
  items,
  getRowKey,
  getTagId,
  libraryCount,
  loading,
  metaLoading,
  syncing,
  queryError,
  hasSyncError,
  authFailed,
  page,
  totalPages,
  onPageChange,
  onSync,
  onRetryQuery,
  syncDisabled,
  syncDisabledLabel,
  searchInput,
  onSearchInput,
  copy,
  renderCard,
  renderTaggedCard,
  skeleton,
  chips,
  emptyState,
  authFailedState,
  progressBar,
}: CollectionPageScaffoldProps<T>) {
  // Manual tagging — batch page tags + single popover + platform-scoped filter
  // chips, with the refresh invariant sealed inside the hook.
  const {
    tagsById,
    editing,
    openTagEditor,
    closeTagEditor,
    usedTags,
    selectedTagIds,
    toggleTag,
    clearTags,
    handleTagsChanged,
  } = useCollectionTags(
    platform,
    items.map(getTagId),
  );

  const phase = resolveCollectionPhase({
    tagFiltered: selectedTagIds.length > 0,
    queryError: queryError != null,
    authFailed,
    syncErrorEmpty: hasSyncError && libraryCount === 0,
    metaLoading,
    syncingEmpty: syncing && libraryCount === 0,
    libraryEmpty: libraryCount === 0,
    loading,
    noMatches: items.length === 0,
  });

  let content: ReactNode;
  switch (phase) {
    case 'tag-filtered':
      // TaggedItemGrid owns its OWN popover — the main-grid popover below is
      // intentionally not rendered in this phase.
      content = (
        <TaggedItemGrid
          platform={platform}
          tagIds={selectedTagIds}
          renderCard={renderTaggedCard}
          skeleton={skeleton}
          onTagsChanged={handleTagsChanged}
        />
      );
      break;
    case 'query-error':
      content = (
        <ErrorState
          title={copy.loadFailed}
          message={queryError ?? ''}
          retryLabel={copy.retry}
          onRetry={onRetryQuery}
        />
      );
      break;
    case 'auth-failed':
      // Platforms without an auth-failed concept (github) omit the slot and
      // fall back to the sync guide — matching the pre-scaffold behavior.
      content = <>{authFailedState ?? emptyState}</>;
      break;
    case 'sync-error':
      content = (
        <ErrorState
          title={copy.loadFailed}
          message={copy.syncErrorText}
          retryLabel={copy.retry}
          onRetry={onSync}
        />
      );
      break;
    case 'skeleton':
      content = <>{skeleton}</>;
      break;
    case 'empty-library':
      content = <>{emptyState}</>;
      break;
    case 'no-matches':
      content = <NoMatchesState message={copy.noMatches} />;
      break;
    case 'grid':
      content = (
        <>
          <CardGrid>
            {items.map((item) => {
              const tagId = getTagId(item);
              return (
                <CardGridItem key={getRowKey(item)}>
                  {renderCard(item, tagsById[tagId] ?? [], (anchor) =>
                    openTagEditor(tagId, anchor),
                  )}
                </CardGridItem>
              );
            })}
          </CardGrid>

          <TagEditPopover
            platform={platform}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editing ? (tagsById[editing.platformItemId] ?? []) : []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />

          <CardGridPagination page={page} totalPages={totalPages} onChange={onPageChange} />
        </>
      );
      break;
  }

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={copy.title}
        caption={copy.caption}
        syncing={syncing}
        onSync={onSync}
        syncLabel={copy.syncLabel}
        syncingLabel={copy.syncingLabel}
        syncDisabled={syncDisabled}
        syncDisabledLabel={syncDisabledLabel}
      />

      {/* Sync progress — shape (determinate/indeterminate) owned by the platform's bar. */}
      {syncing && progressBar}

      {/* Sync failure banner (library still shows its persisted data). */}
      {hasSyncError && libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {copy.syncFailedBanner}
        </Typography>
      )}

      <SearchField
        value={searchInput}
        onChange={onSearchInput}
        placeholder={copy.searchPlaceholder}
      />

      {/* Facet chips — hidden until the library has content. */}
      {libraryCount > 0 && chips}

      {/* Tag filter chips — platform-scoped, multi-select AND; hidden when no used tags. */}
      <TagFilterChips
        tags={usedTags}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        onClear={clearTags}
      />

      {content}
    </DashboardContent>
  );
}
