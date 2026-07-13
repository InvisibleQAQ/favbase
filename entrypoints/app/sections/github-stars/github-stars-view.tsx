import { useNavigate } from 'react-router-dom';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  useItemTags,
  useUsedTags,
  useTagFilter,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
  useTagEditState,
} from '../../components/tags';
import { DashboardContent } from '../../layouts/dashboard';
import { useGithubStars, type GithubSyncError, type SyncProgress } from './use-github-stars';
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
// Shared state views (dashed-box states, mirroring the bilibili collections page)
// ---------------------------------------------------------------------------

function StateBox({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
        p: 4,
      })}
    >
      {children}
    </Box>
  );
}

/** No token configured — guide the user to Settings → Connections. */
function NoTokenState({ onGoToSettings }: { onGoToSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Iconify icon="mdi:github" width={64} sx={{ color: 'text.secondary', mb: 1 }} />
      <Typography variant="h6">{t('githubStars.noTokenTitle')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {t('githubStars.noTokenDesc')}
      </Typography>
      <Button variant="contained" onClick={onGoToSettings} sx={{ mt: 1 }}>
        {t('githubStars.goToSettings')}
      </Button>
    </StateBox>
  );
}

/** Token configured but nothing collected yet — guide the user to sync. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Iconify icon="mdi:star" width={64} sx={{ color: 'warning.main', mb: 1 }} />
      <Typography variant="h6">{t('githubStars.emptyTitle')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {t('githubStars.emptyDesc')}
      </Typography>
      <Button
        variant="contained"
        onClick={onSync}
        disabled={syncing}
        startIcon={
          syncing ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <Iconify icon="solar:restart-bold" width={18} />
          )
        }
        sx={{ mt: 1 }}
      >
        {t('githubStars.syncNow')}
      </Button>
    </StateBox>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Iconify icon="solar:danger-triangle-bold-duotone" width={64} sx={{ color: 'error.main', mb: 1 }} />
      <Typography variant="h6">{t('githubStars.loadFailed')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {message}
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
        {t('githubStars.retry')}
      </Button>
    </StateBox>
  );
}

/** Filters (search/language) matched nothing. */
function NoMatchesState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {t('githubStars.noMatches')}
      </Typography>
    </StateBox>
  );
}

function RepoGridSkeleton() {
  return (
    <Grid container spacing={2.5}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <Skeleton variant="rounded" height={148} />
        </Grid>
      ))}
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Sync progress — determinate once the first page (and its Link header) lands.
// ---------------------------------------------------------------------------

function SyncProgressBar({ progress }: { progress: SyncProgress | null }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2.5 }}>
      <LinearProgress
        variant={progress ? 'determinate' : 'indeterminate'}
        value={progress ? (progress.page / progress.totalPages) * 100 : undefined}
        sx={{ mb: 0.5, borderRadius: 1 }}
      />
      {progress && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('githubStars.syncProgress', {
            fetched: progress.fetchedCount,
            total: progress.estimatedTotal,
          })}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + language chips + repo grid
// ---------------------------------------------------------------------------

export function GithubStarsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gh = useGithubStars();

  // Manual tagging — batch-load tags for the current page, single popover
  // instance, platform-scoped filter chips. Hooks stay above the early return.
  const { tagsById, refresh: refreshItemTags } = useItemTags(
    PLATFORM,
    gh.repos.map((repo) => repo.repoId),
  );
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const { usedTags, refresh: refreshUsedTags } = useUsedTags(PLATFORM);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  const handleTagsChanged = () => {
    refreshItemTags();
    refreshUsedTags();
  };

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

  return (
    <DashboardContent maxWidth="xl">
      {/* Title bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexShrink: 0 }} noWrap>
          {t('githubStars.title')}
        </Typography>

        {captionParts.length > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
            {captionParts.join(' · ')}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        <Button
          variant="contained"
          size="small"
          startIcon={
            gh.syncing ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <Iconify icon="solar:restart-bold" width={18} />
            )
          }
          onClick={gh.sync}
          disabled={gh.syncing}
        >
          {gh.syncing ? t('githubStars.syncing') : t('githubStars.sync')}
        </Button>
      </Box>

      {/* Sync progress — full width below the title bar */}
      {gh.syncing && <SyncProgressBar progress={gh.syncProgress} />}

      {/* Sync failure banner (library still shows its persisted data) */}
      {gh.syncError && gh.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('githubStars.syncFailed', { error: syncErrorMessage(gh.syncError) })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over full_name/description (PGlite) */}
      <TextField
        fullWidth
        value={gh.searchInput}
        onChange={(e) => gh.setSearchInput(e.target.value)}
        placeholder={t('githubStars.searchPlaceholder')}
        sx={{ mb: 3 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Iconify icon="eva:search-fill" width={20} sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          },
        }}
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

      {/* Content: tag-filtered grid takes over while filters are active */}
      {selectedTagIds.length > 0 ? (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedRepoCard item={item} onEditTags={openEditor} />}
          skeleton={<RepoGridSkeleton />}
          // handleTagsChanged (not just refreshUsedTags): unlike collections,
          // useItemTags lives at this view's top level and never unmounts while
          // the filter is active — edits made in the tagged grid must also
          // refresh tagsById or the normal grid shows stale tags after clearing.
          onTagsChanged={handleTagsChanged}
        />
      ) : gh.queryError ? (
        <ErrorState message={gh.queryError} onRetry={gh.retryQuery} />
      ) : gh.syncError && gh.libraryCount === 0 ? (
        <ErrorState message={syncErrorMessage(gh.syncError)} onRetry={gh.sync} />
      ) : gh.metaLoading || (gh.syncing && gh.libraryCount === 0) ? (
        <RepoGridSkeleton />
      ) : gh.libraryCount === 0 ? (
        <EmptyLibraryState syncing={gh.syncing} onSync={gh.sync} />
      ) : gh.loading ? (
        <RepoGridSkeleton />
      ) : gh.repos.length === 0 ? (
        <NoMatchesState />
      ) : (
        <>
          <Grid container spacing={2.5}>
            {gh.repos.map((repo) => (
              <Grid key={repo.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <RepoCard
                  repo={repo}
                  tags={tagsById[repo.repoId] ?? []}
                  onEditTags={(anchor) => openTagEditor(repo.repoId, anchor)}
                />
              </Grid>
            ))}
          </Grid>

          <TagEditPopover
            platform={PLATFORM}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editing ? (tagsById[editing.platformItemId] ?? []) : []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />

          {gh.totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <Pagination
                count={gh.totalPages}
                page={gh.page}
                onChange={(_, value) => gh.goToPage(value)}
                color="primary"
                shape="rounded"
              />
            </Box>
          )}
        </>
      )}
    </DashboardContent>
  );
}
