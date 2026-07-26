import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  StateBox,
  SyncNowButton,
  PipelineProgressStrip,
  CollectionPageScaffold,
} from '../../components/collection';
import {
  backgroundJobRuntime,
  buildPipelineSegments,
} from '../../hooks/pipeline-segments';
import { useProcessingCoverage } from '../../hooks/use-processing-coverage';
import { useXBookmarks, type XSyncError } from './use-x-bookmarks';
import { formatCountdown } from './cooldown';
import { AuthorChips } from './author-chips';
import { XCard } from './x-card';
import { TaggedTweetCard } from './tagged-tweet-card';
import { TweetGridSkeleton } from './tweet-grid-skeleton';

/** Platform key for all tag operations in this (x-only) section. */
const PLATFORM = 'x';
// Deep-link to the bookmarks page: logged-out users get X's own login flow
// first; logged-in users land there so the extension captures their session,
// after which app.html's Sync button can pull the bookmarks.
const X_BOOKMARKS_URL = 'https://x.com/i/bookmarks';

// ---------------------------------------------------------------------------
// i18n seam: structured sync errors from the hook → user-facing copy here.
// ---------------------------------------------------------------------------

function syncErrorMessage(error: XSyncError): string {
  switch (error.kind) {
    case 'auth':
      return t('x.notLoggedInTitle');
    case 'rate-limit':
      return error.resetAt
        ? t('x.rateLimited', { reset: formatDateTime(error.resetAt.getTime()) })
        : t('x.rateLimitedNoReset');
    case 'unknown':
      return error.message;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific dashed-box states (shared StateBox shell, x copy).
// ---------------------------------------------------------------------------

/** Primary action of both empty states: open x.com/i/bookmarks (login-gated by
 *  X itself) so the extension captures the session; the user then returns here
 *  and clicks Sync. */
function OpenBookmarksButton() {
  const { t } = useTranslation();
  return (
    <Button
      component={Link}
      href={X_BOOKMARKS_URL}
      target="_blank"
      rel="noopener"
      variant="contained"
      startIcon={<Iconify icon="mdi:twitter" width={18} />}
    >
      {t('x.openBookmarksPage')}
    </Button>
  );
}

/** No valid x.com session (surfaced when a sync throws XAuthError) — guide the
 *  user to log in on X so the extension captures the session, then sync here. */
function NotLoggedInState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:twitter" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('x.notLoggedInTitle')}
      description={t('x.notLoggedInDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <OpenBookmarksButton />
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('pipeline.fetchNow')} />
        </Box>
      }
    />
  );
}

/** Never synced (or synced empty) — guide the user to log in on X (session
 *  capture) then sync here, with immediate in-app sync as the secondary path. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:twitter" width={64} sx={{ color: 'primary.main', mb: 1 }} />}
      title={t('x.emptyTitle')}
      description={t('x.emptyDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <OpenBookmarksButton />
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('pipeline.fetchNow')} />
        </Box>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main view: scaffold assembly (title bar + sync + search + author chips +
// tweet grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function XView() {
  const { t } = useTranslation();
  const x = useXBookmarks();
  const { coverage, status: coverageStatus } = useProcessingCoverage(
    PLATFORM,
    `${x.syncing}:${x.embedJob?.generation ?? 0}:${x.tagJob?.generation ?? 0}`,
  );

  const captionParts: string[] = [];
  if (x.libraryCount > 0) {
    captionParts.push(t('x.count', { count: x.libraryCount }));
  }
  if (x.lastSyncedAt) {
    captionParts.push(t('x.lastSynced', { time: formatDateTime(x.lastSyncedAt.getTime()) }));
  }
  // "N new this run" — persisted across reloads (omitted for legacy libraries
  // synced before this feature existed).
  if (x.lastInserted != null) {
    captionParts.push(t('x.newThisSync', { count: x.lastInserted }));
  }

  const syncErrorText = x.syncError ? syncErrorMessage(x.syncError) : '';
  const fetchLabel = t('pipeline.fetch');
  const embeddingLabel = t('pipeline.embedding');
  const taggingLabel = t('pipeline.tagging');

  const pipeline = (
    <PipelineProgressStrip
      segments={buildPipelineSegments({
        coverage,
        coverageStatus,
        stages: [
          {
            id: 'fetch',
            label: fetchLabel,
            coverage: 'acquisition',
            completedProgress: 'last-run',
            runtime: backgroundJobRuntime(
              x.syncJob,
              (progress) => progress
                ? { done: progress.fetchedCount, total: null }
                : null,
            ),
          },
          {
            id: 'embedding',
            label: embeddingLabel,
            coverage: 'embedding',
            runtime: backgroundJobRuntime(x.embedJob),
          },
          {
            id: 'tagging',
            label: taggingLabel,
            coverage: 'tagging',
            runtime: backgroundJobRuntime(x.tagJob),
          },
        ],
      })}
    />
  );

  // X-only 5-minute cooldown after a successful sync — hard-disables the
  // title-bar sync button with a live mm:ss countdown label.
  const inCooldown = x.cooldownRemainingMs > 0;
  const cooldownLabel = inCooldown
    ? t('x.cooldown', { time: formatCountdown(x.cooldownRemainingMs) })
    : undefined;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={x.bookmarks}
      getRowKey={(bookmark) => bookmark.id}
      getTagId={(bookmark) => bookmark.tweetId}
      libraryCount={x.libraryCount}
      loading={x.loading}
      metaLoading={x.metaLoading}
      syncing={x.syncing}
      queryError={x.queryError}
      hasSyncError={x.syncError != null}
      authFailed={x.syncError?.kind === 'auth'}
      page={x.page}
      totalPages={x.totalPages}
      onPageChange={x.goToPage}
      onSync={x.sync}
      onRetryQuery={x.retryQuery}
      syncDisabled={inCooldown}
      syncDisabledLabel={cooldownLabel}
      searchInput={x.searchInput}
      onSearchInput={x.setSearchInput}
      copy={{
        title: t('x.title'),
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('x.searchPlaceholder'),
        noMatches: t('x.noMatches'),
        syncLabel: t('pipeline.fetchNow'),
        syncingLabel: t('pipeline.fetching'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText,
        syncFailedBanner: t('x.syncFailed', { error: syncErrorText }),
      }}
      renderCard={(bookmark, tags, onEditTags) => (
        <XCard bookmark={bookmark} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedTweetCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<TweetGridSkeleton />}
      primaryCategory={x.libraryCount > 0 ? (
        <AuthorChips
          authors={x.authors}
          totalCount={x.libraryCount}
          selected={x.author}
          onSelect={x.setAuthor}
        />
      ) : null}
      emptyState={<EmptyLibraryState syncing={x.syncing} onSync={x.sync} />}
      authFailedState={<NotLoggedInState syncing={x.syncing} onSync={x.sync} />}
      pipeline={x.syncError?.kind === 'auth' ? undefined : pipeline}
    />
  );
}
