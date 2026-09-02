import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { varAlpha } from 'minimal-shared/utils';

import type { BiliFavOrder } from '@/lib/bilibili/types';
import { isProcessableVideo } from '@/lib/bilibili/video-eligibility';
import { useTranslation } from '@/lib/i18n/use-translation';
import {
  CollectionPageScaffold,
  PipelineProgressStrip,
  StateBox,
} from '../../components/collection';
import { backgroundJobRuntime, fetchedCountProgress } from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useJob, type BackgroundJob } from '../../hooks/background-jobs-store';
import { Iconify } from '../../components/iconify';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import { AutoTranscribeBar } from './auto-transcribe-bar';
import { FolderChips } from './folder-chips';
import { TaggedVideoCard } from './tagged-video-card';
import { useAutoTranscribe } from './use-auto-transcribe';
import { useBiliFavFolders } from './use-bili-fav-folders';
import { useBiliFavVideos } from './use-bili-fav-videos';
import { useVideoTranscribe } from './use-video-transcribe';
import { VideoCard } from './video-card';
import { VideoGridSkeleton } from './video-grid-skeleton';

const PLATFORM = 'bilibili';
const SEARCH_DEBOUNCE_MS = 300;

/** Transcription is bilibili's content stage on both the folder page and the fallback page. */
function transcriptionStage(label: string, transcribeJob: BackgroundJob | null) {
  return { id: 'transcription', label, runtime: backgroundJobRuntime(transcribeJob) };
}

function NotLoggedIn({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:shield-keyhole-bold-duotone"
          width={48}
          sx={{ color: 'text.secondary' }}
        />
      }
      title={t('collections.notLoggedInTitle')}
      description={t('collections.notLoggedInDesc')}
      action={
        <Button variant="outlined" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

function EmptyFolderState() {
  const { t } = useTranslation();
  return (
    <StateBox
      title={t('collections.emptyFolderTitle')}
      description={t('collections.emptyFolderDesc')}
    />
  );
}

function SelectFolderState() {
  const { t } = useTranslation();
  return <StateBox minHeight={240} description={t('collections.selectFolder')} />;
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
    <Box role="group" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
      {SORT_OPTIONS.map((option) => {
        const active = order === option.value;
        return (
          <Button
            key={option.value}
            size="small"
            variant="text"
            color="inherit"
            aria-pressed={active}
            startIcon={<Iconify icon={option.icon} width={18} />}
            onClick={() => onChange(option.value)}
            sx={(theme) => ({
              minWidth: 0,
              px: 1,
              color: active ? theme.vars.palette.text.primary : theme.vars.palette.text.secondary,
              fontWeight: active ? 600 : 400,
              // Selected = 8% brand wash, deepened to 16% on hover (nav active pattern).
              bgcolor: active ? varAlpha(theme.vars.palette.primary.mainChannel, 0.08) : 'transparent',
              '& .MuiButton-startIcon': {
                color: active ? theme.vars.palette.primary.main : 'inherit',
              },
              '&:hover': {
                bgcolor: active
                  ? varAlpha(theme.vars.palette.primary.mainChannel, 0.16)
                  : theme.vars.palette.action.hover,
                color: theme.vars.palette.text.primary,
              },
            })}
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
  syncJob: ReturnType<typeof useBiliFavFolders>['syncJob'];
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
  syncJob,
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
  const transcribeJob = useJob(PLATFORM, 'transcribe');
  const embedJob = useJob(PLATFORM, 'embed');
  const tagJob = useJob(PLATFORM, 'tag');
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing,
    fetch: backgroundJobRuntime(syncJob, fetchedCountProgress),
    content: transcriptionStage(t('pipeline.transcription'), transcribeJob),
    embedJob,
    tagJob,
    extraRefreshKey: `${autoTranscribe.running}:${activeBvid ?? ''}:${transcribeJob?.generation ?? 0}`,
  });

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
  const pipeline = <PipelineProgressStrip segments={segments} />;

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
        syncLabel: t('pipeline.fetchNow'),
        syncingLabel: t('pipeline.fetching'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText: syncError ?? '',
        syncFailedBanner: t('collections.syncFailed', { error: syncError ?? '' }),
      }}
      renderCard={(video, tags, onEditTags) => {
        const invalid = !isProcessableVideo(video);
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
      configurationNotice={
        loginState === 'logged_in' ? (
          <CollectionConfigurationNotice
            platform={PLATFORM}
            coverage={coverage}
            coverageStatus={coverageStatus}
            asrBlocked={autoTranscribe.state.asrBlocked}
          />
        ) : undefined
      }
      pipeline={loginState === 'logged_in' ? pipeline : undefined}
      operation={autoTranscribe.state.phase === 'configuration_required' ? undefined : (
        <AutoTranscribeBar
          state={autoTranscribe.state}
          running={autoTranscribe.running}
        />
      )}
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
  syncJob: ReturnType<typeof useBiliFavFolders>['syncJob'];
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
  syncJob,
  error,
  onSync,
  searchInput,
  onSearchInput,
  onSelectFolder,
}: BilibiliFallbackPageProps) {
  const { t } = useTranslation();
  const transcribeJob = useJob(PLATFORM, 'transcribe');
  const embedJob = useJob(PLATFORM, 'embed');
  const tagJob = useJob(PLATFORM, 'tag');
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing,
    fetch: backgroundJobRuntime(syncJob, fetchedCountProgress),
    content: transcriptionStage(t('pipeline.transcription'), transcribeJob),
    embedJob,
    tagJob,
    extraRefreshKey: transcribeJob?.generation ?? 0,
  });
  const pipeline = <PipelineProgressStrip segments={segments} />;
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
        syncLabel: t('pipeline.fetchNow'),
        syncingLabel: t('pipeline.fetching'),
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
      configurationNotice={
        loginState === 'logged_in' ? (
          <CollectionConfigurationNotice
            platform={PLATFORM}
            coverage={coverage}
            coverageStatus={coverageStatus}
          />
        ) : undefined
      }
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
    syncJob,
    loginState,
    lastSyncedAt,
    error,
    sync,
  } = useBiliFavFolders(mediaId ? Number(mediaId) : undefined);

  const selectedId = mediaId ? Number(mediaId) : folders[0]?.id;
  const selectedFolder = folders.find((folder) => folder.id === selectedId);
  const autoTranscribe = useAutoTranscribe();
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
        syncJob={syncJob}
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
      syncJob={syncJob}
      onSync={sync}
      lastSyncedAt={lastSyncedAt}
      syncError={error}
      autoTranscribe={autoTranscribe}
    />
  );
}
