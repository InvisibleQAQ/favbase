import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

import type { AuthFailReason } from '@/lib/collections/sync-errors';
import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import {
  StateBox,
  SyncNowButton,
  PipelineProgressStrip,
  CollectionPageScaffold,
} from '../../components/collection';
import { backgroundJobRuntime, fetchedCountProgress } from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useCollectionBreadcrumbs } from '../../hooks/use-collection-breadcrumbs';
import { rateLimitRemainingMs } from '../../hooks/collection-sync-error';
import {
  syncErrorMessage,
  type SyncErrorCopy,
} from '../../hooks/collection-sync-error-message';
import { formatCountdown, useCountdown } from '../../hooks/use-countdown';
import { useXBookmarks } from './use-x-bookmarks';
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
// i18n seam: the classified sync error → user-facing copy (shared
// `syncErrorMessage`). X tells the two auth reasons apart — no captured
// session vs. a captured one X refused — because the user action differs, and
// reports its rate-limit reset, so it has the `rateLimitedUntil` form and the
// Fetch-button lock below.
// ---------------------------------------------------------------------------

const SYNC_ERROR_COPY: SyncErrorCopy = {
  auth: 'x.notLoggedInTitle',
  authRejected: 'x.sessionRejectedTitle',
  rateLimited: 'x.rateLimitedNoReset',
  rateLimitedUntil: 'x.rateLimited',
};

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
 *  user to log in on X so the extension captures the session, then sync here.
 *  `'missing'` = nothing captured yet; `'rejected'` = X refused the captured
 *  session, so the copy says to sign in again rather than for the first time. */
function NotLoggedInState({
  reason,
  syncing,
  onSync,
}: {
  reason: AuthFailReason;
  syncing: boolean;
  onSync: () => void;
}) {
  const { t } = useTranslation();
  const rejected = reason === 'rejected';
  return (
    <StateBox
      icon={<Iconify icon="mdi:twitter" width={48} sx={{ color: 'text.secondary' }} />}
      title={t(rejected ? 'x.sessionRejectedTitle' : 'x.notLoggedInTitle')}
      description={t(rejected ? 'x.sessionRejectedDesc' : 'x.notLoggedInDesc')}
      action={
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
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
      icon={<Iconify icon="mdi:twitter" width={48} sx={{ color: 'text.secondary' }} />}
      title={t('x.emptyTitle')}
      description={t('x.emptyDesc')}
      action={
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
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
  const breadcrumbs = useCollectionBreadcrumbs(PLATFORM);
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: x.syncing,
    fetch: backgroundJobRuntime(x.syncJob, fetchedCountProgress),
    embedJob: x.embedJob,
    tagJob: x.tagJob,
  });
  // A rate limit with a known reset locks the Fetch button until then.
  const lockMs = useCountdown((now) => rateLimitRemainingMs(x.syncError, now));

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

  const syncErrorText = x.syncError ? syncErrorMessage(x.syncError, SYNC_ERROR_COPY) : '';
  const authReason: AuthFailReason =
    x.syncError?.kind === 'auth' ? x.syncError.reason : 'missing';
  const pipeline = <PipelineProgressStrip segments={segments} />;

  // The title-bar Fetch button is hard-disabled with a live m:ss countdown by
  // whichever lock ends later: X's post-sync cooldown, or a rate limit's reset.
  const lockRemainingMs = Math.max(x.cooldownRemainingMs, lockMs);
  const locked = lockRemainingMs > 0;
  const lockLabel = locked
    ? t('pipeline.fetchAvailableIn', { time: formatCountdown(lockRemainingMs) })
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
      syncDisabled={locked}
      syncDisabledLabel={lockLabel}
      searchInput={x.searchInput}
      onSearchInput={x.setSearchInput}
      copy={{
        title: t('x.title'),
        breadcrumbs,
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
      authFailedState={
        <NotLoggedInState reason={authReason} syncing={x.syncing} onSync={x.sync} />
      }
      configurationNotice={
        <CollectionConfigurationNotice
          platform={PLATFORM}
          coverage={coverage}
          coverageStatus={coverageStatus}
        />
      }
      pipeline={x.syncError?.kind === 'auth' ? undefined : pipeline}
    />
  );
}
