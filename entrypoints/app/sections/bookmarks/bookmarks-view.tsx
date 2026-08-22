import { useNavigate, useParams } from 'react-router-dom';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import {
  CollectionPageScaffold,
  PipelineProgressStrip,
  StateBox,
} from '../../components/collection';
import { backgroundJobRuntime } from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { Iconify } from '../../components/iconify';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import { BookmarkCard } from './bookmark-card';
import { BookmarkExtractionPanel } from './bookmark-extraction-panel';
import { BookmarkGridSkeleton } from './bookmark-grid-skeleton';
import { FolderChips } from './folder-chips';
import { TaggedBookmarkCard } from './tagged-bookmark-card';
import { useBookmarkExtraction } from './use-bookmark-extraction';
import { useBookmarks } from './use-bookmarks';

const PLATFORM = 'bookmarks';

/** Library empty after the local mount sync: there are no http(s) bookmarks. */
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

export function BookmarksView() {
  const { t } = useTranslation();
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const bm = useBookmarks(folderId);
  const extraction = useBookmarkExtraction(bm.lastSyncedAt?.getTime());
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: bm.syncing,
    fetch: backgroundJobRuntime(bm.syncJob),
    content: {
      id: 'extraction',
      label: t('pipeline.extraction'),
      runtime: backgroundJobRuntime(extraction.extractJob),
    },
    embedJob: extraction.embedJob,
    tagJob: extraction.tagJob,
    extraRefreshKey: extraction.running,
  });

  const captionParts: string[] = [];
  if (bm.libraryCount > 0) {
    captionParts.push(t('bookmarks.count', { count: bm.libraryCount }));
  }
  if (bm.lastSyncedAt) {
    captionParts.push(
      t('bookmarks.lastSynced', {
        time: formatDateTime(bm.lastSyncedAt.getTime()),
      }),
    );
  }
  const pipeline = <PipelineProgressStrip segments={segments} />;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={bm.bookmarks}
      getRowKey={(bookmark) => bookmark.id}
      getTagId={(bookmark) => bookmark.normalizedUrl}
      libraryCount={bm.libraryCount}
      loading={bm.loading}
      metaLoading={bm.metaLoading}
      syncing={bm.syncing}
      queryError={bm.queryError}
      hasSyncError={bm.syncError != null}
      authFailed={false}
      page={bm.page}
      totalPages={bm.totalPages}
      onPageChange={bm.goToPage}
      onSync={bm.sync}
      onRetryQuery={bm.retryQuery}
      searchInput={bm.searchInput}
      onSearchInput={bm.setSearchInput}
      copy={{
        title: t('bookmarks.title'),
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('bookmarks.searchPlaceholder'),
        noMatches: t('bookmarks.noMatches'),
        syncLabel: t('pipeline.fetchNow'),
        syncingLabel: t('pipeline.fetching'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText: bm.syncError ?? '',
        syncFailedBanner: bm.syncError
          ? t('bookmarks.syncFailed', { error: bm.syncError })
          : '',
      }}
      renderCard={(bookmark, tags, onEditTags) => (
        <BookmarkCard bookmark={bookmark} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedBookmarkCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<BookmarkGridSkeleton />}
      operation={<BookmarkExtractionPanel extraction={extraction} />}
      primaryCategory={
        bm.libraryCount > 0 ? (
          <FolderChips
            folders={bm.folders}
            totalCount={bm.libraryCount}
            selectedId={folderId}
            onSelect={(id) =>
              navigate(id ? `/collections/bookmarks/${id}` : '/collections/bookmarks')
            }
          />
        ) : null
      }
      emptyState={<EmptyState />}
      configurationNotice={
        <CollectionConfigurationNotice
          platform={PLATFORM}
          coverage={coverage}
          coverageStatus={coverageStatus}
        />
      }
      pipeline={pipeline}
    />
  );
}
