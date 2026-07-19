import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  StateBox,
  SyncNowButton,
  SyncProgressBar,
  BackgroundJobsBar,
  CollectionPageScaffold,
} from '../../components/collection';
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
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
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
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
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

  // Post-sync embed / tag progress captions (self-hiding bar under the title).
  const jobCaptions: string[] = [];
  const ep = x.embedJob?.progress as { done: number; total: number } | null | undefined;
  if (x.embedJob?.running && ep && ep.total > 0) jobCaptions.push(t('backgroundJobs.embedding', ep));
  const tp = x.tagJob?.progress as { done: number; total: number } | null | undefined;
  if (x.tagJob?.running && tp && tp.total > 0) jobCaptions.push(t('backgroundJobs.tagging', tp));

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
        syncLabel: t('x.sync'),
        syncingLabel: t('x.syncing'),
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
      chips={
        <AuthorChips
          authors={x.authors}
          totalCount={x.libraryCount}
          selected={x.author}
          onSelect={x.setAuthor}
        />
      }
      emptyState={<EmptyLibraryState syncing={x.syncing} onSync={x.sync} />}
      authFailedState={<NotLoggedInState syncing={x.syncing} onSync={x.sync} />}
      progressBar={
        // Always indeterminate — cursor pagination has no total.
        <SyncProgressBar
          caption={
            x.syncProgress
              ? t('x.syncProgress', { fetched: x.syncProgress.fetchedCount, page: x.syncProgress.page })
              : undefined
          }
        />
      }
      backgroundJobsBar={<BackgroundJobsBar captions={jobCaptions} />}
    />
  );
}
