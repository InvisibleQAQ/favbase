import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  useCollectionTags,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
} from '../../components/tags';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SectionTitleBar,
  SearchField,
  CardGrid,
  CardGridItem,
  CardGridPagination,
  CardGridSkeleton,
  ErrorState,
  NoMatchesState,
  SyncNowButton,
  SyncProgressBar,
} from '../../components/collection';
import { resolveCollectionPhase } from '../../hooks/collection-phase';
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
// Main view: title bar + sync + search + language chips + repo grid
// ---------------------------------------------------------------------------

export function GithubStarsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gh = useGithubStars();

  // Manual tagging — batch page tags + single popover + platform-scoped filter
  // chips, with the refresh invariant sealed inside the hook. Hooks stay above
  // the early return.
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
    PLATFORM,
    gh.repos.map((repo) => repo.repoId),
  );

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

  // GitHub has no auth-failed content phase — a missing token short-circuits to
  // NoTokenState above, before this resolver runs.
  const phase = resolveCollectionPhase({
    tagFiltered: selectedTagIds.length > 0,
    queryError: gh.queryError != null,
    authFailed: false,
    syncErrorEmpty: gh.syncError != null && gh.libraryCount === 0,
    metaLoading: gh.metaLoading,
    syncingEmpty: gh.syncing && gh.libraryCount === 0,
    libraryEmpty: gh.libraryCount === 0,
    loading: gh.loading,
    noMatches: gh.repos.length === 0,
  });

  let content: ReactNode;
  switch (phase) {
    case 'tag-filtered':
      content = (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedRepoCard item={item} onEditTags={openEditor} />}
          skeleton={<RepoGridSkeleton />}
          onTagsChanged={handleTagsChanged}
        />
      );
      break;
    case 'query-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={gh.queryError ?? ''}
          retryLabel={t('common.retry')}
          onRetry={gh.retryQuery}
        />
      );
      break;
    case 'auth-failed':
      // Unreachable for github (NoTokenState short-circuits earlier); fall to sync guide.
      content = <EmptyLibraryState syncing={gh.syncing} onSync={gh.sync} />;
      break;
    case 'sync-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={syncErrorText}
          retryLabel={t('common.retry')}
          onRetry={gh.sync}
        />
      );
      break;
    case 'skeleton':
      content = <RepoGridSkeleton />;
      break;
    case 'empty-library':
      content = <EmptyLibraryState syncing={gh.syncing} onSync={gh.sync} />;
      break;
    case 'no-matches':
      content = <NoMatchesState message={t('githubStars.noMatches')} />;
      break;
    case 'grid':
      content = (
        <>
          <CardGrid>
            {gh.repos.map((repo) => (
              <CardGridItem key={repo.id}>
                <RepoCard
                  repo={repo}
                  tags={tagsById[repo.repoId] ?? []}
                  onEditTags={(anchor) => openTagEditor(repo.repoId, anchor)}
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

          <CardGridPagination page={gh.page} totalPages={gh.totalPages} onChange={gh.goToPage} />
        </>
      );
      break;
  }

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={t('githubStars.title')}
        caption={captionParts.length > 0 ? captionParts.join(' · ') : undefined}
        syncing={gh.syncing}
        onSync={gh.sync}
        syncLabel={t('githubStars.sync')}
        syncingLabel={t('githubStars.syncing')}
      />

      {/* Sync progress — determinate once the first page (and its Link header) lands. */}
      {gh.syncing && (
        <SyncProgressBar
          value={gh.syncProgress ? (gh.syncProgress.page / gh.syncProgress.totalPages) * 100 : null}
          caption={
            gh.syncProgress
              ? t('githubStars.syncProgress', {
                  fetched: gh.syncProgress.fetchedCount,
                  total: gh.syncProgress.estimatedTotal,
                })
              : undefined
          }
        />
      )}

      {/* Sync failure banner (library still shows its persisted data) */}
      {gh.syncError && gh.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('githubStars.syncFailed', { error: syncErrorText })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over full_name/description (PGlite) */}
      <SearchField
        value={gh.searchInput}
        onChange={gh.setSearchInput}
        placeholder={t('githubStars.searchPlaceholder')}
      />

      {/* Language chips — hidden until the library has content */}
      {gh.libraryCount > 0 && (
        <LanguageChips
          languages={gh.languages}
          totalCount={gh.libraryCount}
          selected={gh.language}
          onSelect={gh.setLanguage}
        />
      )}

      {/* Tag filter chips — github-scoped, multi-select AND; hidden when no used tags */}
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
