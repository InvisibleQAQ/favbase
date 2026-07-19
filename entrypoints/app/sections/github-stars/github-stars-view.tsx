import { useNavigate } from 'react-router-dom';

import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SyncNowButton,
  SyncProgressBar,
  CardGridSkeleton,
  CollectionPageScaffold,
} from '../../components/collection';
import { useGithubStars, type GithubSyncError } from './use-github-stars';
import { LanguageChips } from './language-chips';
import { RepoCard } from './repo-card';
import { TaggedRepoCard } from './tagged-repo-card';

/** Platform key for all tag operations in this (github-only) section. */
const PLATFORM = 'github';

// ---------------------------------------------------------------------------
// i18n seam: structured sync errors from the hook → user-facing copy here.
// Reuses the settings.github.* keys (same error semantics as the token test).
// ---------------------------------------------------------------------------

function syncErrorMessage(error: GithubSyncError): string {
  switch (error.kind) {
    case 'auth':
      return t('settings.github.invalidToken');
    case 'rate-limit':
      return error.resetAt
        ? t('settings.github.rateLimited', { reset: formatDateTime(error.resetAt.getTime()) })
        : t('settings.github.rateLimitedNoReset');
    case 'unknown':
      return error.message;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific dashed-box states (shared StateBox shell, github copy).
// ---------------------------------------------------------------------------

/** No token configured — guide the user to Settings → Connections. */
function NoTokenState({ onGoToSettings }: { onGoToSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:github" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('githubStars.noTokenTitle')}
      description={t('githubStars.noTokenDesc')}
      action={
        <Button variant="contained" onClick={onGoToSettings} sx={{ mt: 1 }}>
          {t('githubStars.goToSettings')}
        </Button>
      }
    />
  );
}

/** Token configured but nothing collected yet — guide the user to sync. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:star" width={64} sx={{ color: 'warning.main', mb: 1 }} />}
      title={t('githubStars.emptyTitle')}
      description={t('githubStars.emptyDesc')}
      action={
        <SyncNowButton
          syncing={syncing}
          onSync={onSync}
          label={t('common.syncNow')}
          variant="contained"
        />
      }
    />
  );
}

function RepoGridSkeleton() {
  return <CardGridSkeleton card={<Skeleton variant="rounded" height={148} />} />;
}

// ---------------------------------------------------------------------------
// Main view: config gate + scaffold assembly (title bar + sync + search +
// language chips + repo grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function GithubStarsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gh = useGithubStars();

  // No token: the whole page short-circuits into the connect guide.
  if (!gh.settingsLoading && !gh.hasToken) {
    return (
      <DashboardContent maxWidth="xl">
        <NoTokenState onGoToSettings={() => navigate('/settings')} />
      </DashboardContent>
    );
  }

  const captionParts: string[] = [];
  if (gh.libraryCount > 0) {
    captionParts.push(t('githubStars.repoCount', { count: gh.libraryCount }));
  }
  if (gh.lastSyncedAt) {
    captionParts.push(
      t('githubStars.lastSynced', { time: formatDateTime(gh.lastSyncedAt.getTime()) }),
    );
  }

  const syncErrorText = gh.syncError ? syncErrorMessage(gh.syncError) : '';

  // Two sync phases: paged star-list fetch (determinate once the first page's
  // Link header lands), then serial README fetch for new repos.
  let progressValue: number | null = null;
  let progressCaption: string | undefined;
  if (gh.syncProgress) {
    if (gh.syncProgress.phase === 'stars') {
      progressValue = (gh.syncProgress.page / gh.syncProgress.totalPages) * 100;
      progressCaption = t('githubStars.syncProgress', {
        fetched: gh.syncProgress.fetchedCount,
        total: gh.syncProgress.estimatedTotal,
      });
    } else {
      progressValue =
        gh.syncProgress.total > 0 ? (gh.syncProgress.done / gh.syncProgress.total) * 100 : null;
      progressCaption = t('githubStars.readmeProgress', {
        done: gh.syncProgress.done,
        total: gh.syncProgress.total,
      });
    }
  }

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={gh.repos}
      getRowKey={(repo) => repo.id}
      getTagId={(repo) => repo.repoId}
      libraryCount={gh.libraryCount}
      loading={gh.loading}
      metaLoading={gh.metaLoading}
      syncing={gh.syncing}
      queryError={gh.queryError}
      hasSyncError={gh.syncError != null}
      // GitHub has no auth-failed content phase — a missing token short-circuits
      // to NoTokenState above, before the scaffold renders.
      authFailed={false}
      page={gh.page}
      totalPages={gh.totalPages}
      onPageChange={gh.goToPage}
      onSync={gh.sync}
      onRetryQuery={gh.retryQuery}
      searchInput={gh.searchInput}
      onSearchInput={gh.setSearchInput}
      copy={{
        title: t('githubStars.title'),
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('githubStars.searchPlaceholder'),
        noMatches: t('githubStars.noMatches'),
        syncLabel: t('githubStars.sync'),
        syncingLabel: t('githubStars.syncing'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText,
        syncFailedBanner: t('githubStars.syncFailed', { error: syncErrorText }),
      }}
      renderCard={(repo, tags, onEditTags) => (
        <RepoCard repo={repo} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedRepoCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<RepoGridSkeleton />}
      chips={
        <LanguageChips
          languages={gh.languages}
          totalCount={gh.libraryCount}
          selected={gh.language}
          onSelect={gh.setLanguage}
        />
      }
      emptyState={<EmptyLibraryState syncing={gh.syncing} onSync={gh.sync} />}
      progressBar={<SyncProgressBar value={progressValue} caption={progressCaption} />}
    />
  );
}
