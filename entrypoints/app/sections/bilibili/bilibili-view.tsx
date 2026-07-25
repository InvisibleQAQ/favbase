import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';
import type { BiliFavOrder } from '@/lib/bilibili/types';
import { useTranslation } from '@/lib/i18n/use-translation';
import {
  CollectionPageScaffold,
  PipelineProgressStrip,
  StateBox,
} from '../../components/collection';
import { buildPipelineSegments } from '../../hooks/pipeline-segments';
import { useProcessingCoverage } from '../../hooks/use-processing-coverage';
import { trackJobRun, useJob } from '../../hooks/background-jobs-store';
import { Iconify } from '../../components/iconify';
import { AutoTranscribeBar } from './auto-transcribe-bar';
import { FolderChips } from './folder-chips';
import { TaggedVideoCard } from './tagged-video-card';
import { useAutoTranscribe } from './use-auto-transcribe';
import { useBiliFavFolders } from './use-bili-fav-folders';
import { useBiliFavVideos } from './use-bili-fav-videos';
import { useVideoTranscribe } from './use-video-transcribe';
import { INVALID_ATTR, VideoCard } from './video-card';
import { VideoGridSkeleton } from './video-grid-skeleton';

const PLATFORM = 'bilibili';
const SEARCH_DEBOUNCE_MS = 300;
const biliAdapter = createBiliAutoTranscribeAdapter({
  trackProcessingRun: (kind, run) => trackJobRun(PLATFORM, kind, run),
});

function NotLoggedIn({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:shield-keyhole-bold-duotone"
          width={64}
          sx={{ color: 'warning.main', mb: 1 }}
        />
      }
      title={t('collections.notLoggedInTitle')}
      description={t('collections.notLoggedInDesc')}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

function EmptyFolderState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="h6" sx={{ color: 'text.disabled' }}>
        {t('collections.emptyFolderTitle')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('collections.emptyFolderDesc')}
      </Typography>
    </StateBox>
  );
}

function SelectFolderState() {
  const { t } = useTranslation();
  return (
    <StateBox minHeight={240}>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {t('collections.selectFolder')}
      </Typography>
    </StateBox>
  );
}

const SORT_OPTIONS = [
  { value: 'mtime', labelKey: 'collections.sortFavTime', icon: 'solar:clock-circle-bold' },
  { value: 'view', labelKey: 'collections.sortPlay', icon: 'solar:play-circle-bold' },
  { value: 'pubtime', labelKey: 'collections.sortPubTime', icon: 'solar:calendar-bold' },
] as const;

function SortControl({
  order,
  onChange,
}: {
  order: BiliFavOrder;
  onChange: (order: BiliFavOrder) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
      {SORT_OPTIONS.map((option) => {
        const active = order === option.value;
        return (
          <Button
            key={option.value}
            size="small"
            variant="text"
            startIcon={<Iconify icon={option.icon} width={18} />}
            onClick={() => onChange(option.value)}
            sx={{
              minWidth: 0,
              px: 1,
              color: active ? 'primary.main' : 'text.secondary',
              fontWeight: active ? 600 : 400,
              textDecoration: active ? 'underline' : 'none',
              textUnderlineOffset: 4,
              '&:hover': {
                bgcolor: 'transparent',
                color: active ? 'primary.dark' : 'text.primary',
              },
            }}
          >
            {t(option.labelKey)}
          </Button>
        );
      })}
    </Box>
  );
}

interface BilibiliCollectionPageProps {
  mediaId: number;
  keyword: string;
  searchInput: string;
  onSearchInput: (value: string) => void;
  folders: ReturnType<typeof useBiliFavFolders>['folders'];
  selectedId: number;
  onSelectFolder: (folderId: number) => void;
  totalCount: number;
  syncing: boolean;
  syncProgress: ReturnType<typeof useBiliFavFolders>['syncProgress'];
  onSync: () => void;
  lastSyncedAt: Date | null;
  syncError: string | null;
  autoTranscribe: ReturnType<typeof useAutoTranscribe>;
}

function BilibiliCollectionPage({
  mediaId,
  keyword,
  searchInput,
  onSearchInput,
  folders,
  selectedId,
  onSelectFolder,
  totalCount,
  syncing,
  syncProgress,
  onSync,
  lastSyncedAt,
  syncError,
  autoTranscribe,
}: BilibiliCollectionPageProps) {
  const { t } = useTranslation();
  const {
    videos,
    folderTitle,
    page,
    totalPages,
    loading,
    loginState,
    error,
    order,
    setOrder,
    goToPage,
    retry,
  } = useBiliFavVideos(mediaId, keyword);
  const { getState, startTranscribe, cancelTranscribe, activeBvid } =
    useVideoTranscribe(videos);
  const embedJob = useJob(PLATFORM, 'embed');
  const tagJob = useJob(PLATFORM, 'tag');
  const { coverage, status: coverageStatus } = useProcessingCoverage(
    PLATFORM,
    `${syncing}:${autoTranscribe.running}:${activeBvid ?? ''}:${embedJob?.generation ?? 0}:${tagJob?.generation ?? 0}`,
  );
  const activeTranscribeState = activeBvid ? getState(activeBvid) : null;
  const manualTranscribing = activeBvid != null;
  const autoTranscribing = autoTranscribe.running;

  const captionParts: string[] = [];
  if (!loading && folderTitle) captionParts.push(folderTitle);
  if (totalCount > 0) {
    captionParts.push(t('collections.videoCount', { count: totalCount }));
  }
  if (lastSyncedAt) {
    captionParts.push(
      t('collections.lastSynced', { time: lastSyncedAt.toLocaleTimeString() }),
    );
  }

  const pipeline = (
    <PipelineProgressStrip
      segments={buildPipelineSegments({
        coverage,
        coverageStatus,
        stages: [
          {
            id: 'sync',
            label: t('pipeline.sync'),
            coverage: 'acquisition',
            runtime: {
              running: syncing,
              progress: syncing
                ? { done: syncProgress?.fetchedCount ?? 0, total: null }
                : null,
              error: syncError,
            },
          },
          {
            id: 'transcription',
            label: t('pipeline.transcription'),
            coverage: 'content',
            runtime: {
              running: autoTranscribing || manualTranscribing,
              progress: coverageStatus === 'ready' ? coverage.content : null,
              error: activeTranscribeState?.error,
            },
          },
          {
            id: 'embedding',
            label: t('pipeline.embedding'),
            coverage: 'embedding',
            runtime: embedJob,
          },
          {
            id: 'tagging',
            label: t('pipeline.tagging'),
            coverage: 'tagging',
            runtime: tagJob,
          },
        ],
      })}
    />
  );

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={videos}
      getRowKey={(video) => video.id}
      getTagId={(video) => video.bvid}
      libraryCount={totalCount}
      loading={loading}
      metaLoading={false}
      syncing={syncing}
      queryError={error}
      hasSyncError={syncError != null}
      authFailed={loginState === 'not_logged_in'}
      page={page}
      totalPages={totalPages}
      onPageChange={goToPage}
      onSync={onSync}
      onRetryQuery={retry}
      searchInput={searchInput}
      onSearchInput={onSearchInput}
      copy={{
        title: t('collections.sidebarTitle'),
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('collections.searchPlaceholder'),
        noMatches: t('collections.noMatches'),
        syncLabel: t('collections.sync'),
        syncingLabel: t('collections.syncing'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText: syncError ?? '',
        syncFailedBanner: t('collections.syncFailed', { error: syncError ?? '' }),
      }}
      renderCard={(video, tags, onEditTags) => {
        const invalid = video.attr === INVALID_ATTR;
        return (
          <VideoCard
            video={video}
            transcribeState={getState(video.bvid)}
            onTranscribe={() => startTranscribe(video)}
            onCancel={cancelTranscribe}
            disabled={Boolean(activeBvid && activeBvid !== video.bvid)}
            tags={invalid ? undefined : tags}
            onEditTags={invalid ? undefined : onEditTags}
          />
        );
      }}
      renderTaggedCard={(item, openEditor) => (
        <TaggedVideoCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<VideoGridSkeleton />}
      pipeline={loginState === 'logged_in' ? pipeline : undefined}
      operation={
        <Box sx={{ mb: 2.5 }}>
          <AutoTranscribeBar
            state={autoTranscribe.state}
            running={autoTranscribe.running}
            onStart={autoTranscribe.start}
            onStop={autoTranscribe.stop}
          />
        </Box>
      }
      operationScope="primary-category"
      primaryCategory={
        <FolderChips
          folders={folders}
          selectedId={selectedId}
          loading={false}
          onSelect={onSelectFolder}
        />
      }
      secondaryCategory={
        loginState !== 'not_logged_in' && !error ? (
          <SortControl order={order} onChange={setOrder} />
        ) : null
      }
      secondaryCategoryScope="primary-category"
      emptyState={<EmptyFolderState />}
      authFailedState={<NotLoggedIn onRetry={retry} />}
    />
  );
}

interface BilibiliFallbackPageProps {
  folders: ReturnType<typeof useBiliFavFolders>['folders'];
  foldersLoading: boolean;
  selectedId: number | undefined;
  loginState: ReturnType<typeof useBiliFavFolders>['loginState'];
  syncing: boolean;
  error: string | null;
  onSync: () => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSelectFolder: (folderId: number) => void;
}

function BilibiliFallbackPage({
  folders,
  foldersLoading,
  selectedId,
  loginState,
  syncing,
  error,
  onSync,
  searchInput,
  onSearchInput,
  onSelectFolder,
}: BilibiliFallbackPageProps) {
  const { t } = useTranslation();
  const { coverage, status: coverageStatus } = useProcessingCoverage(PLATFORM, syncing);
  const pipeline = (
    <PipelineProgressStrip
      segments={buildPipelineSegments({
        coverage,
        coverageStatus,
        stages: [
          {
            id: 'sync',
            label: t('pipeline.sync'),
            coverage: 'acquisition',
            runtime: {
              running: syncing,
              progress:
                syncing && coverageStatus === 'ready'
                  ? { done: coverage.acquisition.done, total: null }
                  : null,
              error,
            },
          },
          {
            id: 'transcription',
            label: t('pipeline.transcription'),
            coverage: 'content',
          },
          {
            id: 'embedding',
            label: t('pipeline.embedding'),
            coverage: 'embedding',
          },
          {
            id: 'tagging',
            label: t('pipeline.tagging'),
            coverage: 'tagging',
          },
        ],
      })}
    />
  );
  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={[]}
      getRowKey={() => ''}
      getTagId={() => ''}
      libraryCount={0}
      loading={false}
      metaLoading={foldersLoading}
      syncing={syncing}
      queryError={null}
      hasSyncError={error != null}
      authFailed={loginState === 'not_logged_in'}
      page={1}
      totalPages={1}
      onPageChange={() => undefined}
      onSync={onSync}
      onRetryQuery={onSync}
      searchInput={searchInput}
      onSearchInput={onSearchInput}
      copy={{
        title: t('collections.sidebarTitle'),
        searchPlaceholder: t('collections.searchPlaceholder'),
        noMatches: t('collections.noMatches'),
        syncLabel: t('collections.sync'),
        syncingLabel: t('collections.syncing'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText: error ?? '',
        syncFailedBanner: t('collections.syncFailed', { error: error ?? '' }),
      }}
      renderCard={() => null}
      renderTaggedCard={(item, openEditor) => (
        <TaggedVideoCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<VideoGridSkeleton />}
      primaryCategory={
        <FolderChips
          folders={folders}
          selectedId={selectedId}
          loading={foldersLoading}
          onSelect={onSelectFolder}
        />
      }
      emptyState={<SelectFolderState />}
      authFailedState={<NotLoggedIn onRetry={onSync} />}
      pipeline={loginState === 'logged_in' ? pipeline : undefined}
    />
  );
}

export function BilibiliView() {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const {
    folders,
    loading: foldersLoading,
    syncing,
    syncProgress,
    loginState,
    lastSyncedAt,
    error,
    sync,
  } = useBiliFavFolders();

  const selectedId = mediaId ? Number(mediaId) : folders[0]?.id;
  const selectedFolder = folders.find((folder) => folder.id === selectedId);
  const autoTranscribe = useAutoTranscribe(selectedId, biliAdapter);
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');

  useEffect(() => {
    const id = setTimeout(() => {
      const next = searchInput.trim();
      if (next === keywordRef.current) return;
      keywordRef.current = next;
      setKeyword(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (!mediaId && !foldersLoading && folders.length > 0) {
      navigate(`/collections/bilibili/${folders[0].id}`, { replace: true });
    }
  }, [mediaId, foldersLoading, folders, navigate]);

  const handleSelectFolder = (folderId: number) => {
    setSearchInput('');
    setKeyword('');
    keywordRef.current = '';
    navigate(`/collections/bilibili/${folderId}`);
  };

  if (!selectedId) {
    return (
      <BilibiliFallbackPage
        folders={folders}
        foldersLoading={foldersLoading}
        selectedId={selectedId}
        loginState={loginState}
        syncing={syncing}
        error={error}
        onSync={sync}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSelectFolder={handleSelectFolder}
      />
    );
  }

  return (
    <BilibiliCollectionPage
      key={selectedId}
      mediaId={selectedId}
      keyword={keyword}
      searchInput={searchInput}
      onSearchInput={setSearchInput}
      folders={folders}
      selectedId={selectedId}
      onSelectFolder={handleSelectFolder}
      totalCount={selectedFolder?.media_count ?? 0}
      syncing={syncing}
      syncProgress={syncProgress}
      onSync={sync}
      lastSyncedAt={lastSyncedAt}
      syncError={error}
      autoTranscribe={autoTranscribe}
    />
  );
}
