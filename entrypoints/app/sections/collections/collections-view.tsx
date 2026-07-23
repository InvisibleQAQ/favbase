import { useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';

import { useTranslation } from '@/lib/i18n/use-translation';
import {
  CardGrid,
  CardGridItem,
  CardGridPagination,
  CardGridSkeleton,
  CollapsibleChipRow,
  ErrorState,
  NoMatchesState,
  SearchField,
  SectionTitleBar,
  StateBox,
} from '../../components/collection';
import { TagEditPopover } from '../../components/tags';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { collectionPlatformRegistry } from '../../collection-platform-registry';
import { isCollectionPlatform, type CollectionPlatform } from '@/lib/collections';
import { useCollections } from './use-collections';
import { CollectionItemCard } from './collection-item-card';

function CollectionsGridSkeleton() {
  return (
    <CardGridSkeleton
      card={
        <Card sx={{ height: 260, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Skeleton variant="rounded" height={132} />
          <Skeleton variant="text" width="78%" />
          <Skeleton variant="text" width="54%" />
          <Box sx={{ flex: 1 }} />
          <Skeleton variant="rounded" height={24} />
        </Card>
      }
    />
  );
}

function EmptyCollectionsState({ title, description }: { title: string; description: string }) {
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:video-library-bold-duotone"
          width={64}
          sx={{ color: 'text.disabled' }}
        />
      }
      title={title}
      description={description}
    />
  );
}

export function CollectionsView() {
  const { t } = useTranslation();
  const {
    items,
    total,
    totalPages,
    loading,
    queryError,
    retryQuery,
    platform,
    setPlatform,
    searchInput,
    setSearchInput,
    hasActiveFilter,
    page,
    goToPage,
  } = useCollections();

  const [editing, setEditing] = useState<{
    platform: CollectionPlatform;
    platformItemId: string;
    anchorEl: HTMLElement;
  } | null>(null);

  const editingItem = useMemo(
    () =>
      editing
        ? items.find(
            (item) =>
              item.platform === editing.platform && item.platformItemId === editing.platformItemId,
          ) ?? null
        : null,
    [editing, items],
  );

  useEffect(() => {
    if (editing && editingItem === null) setEditing(null);
  }, [editing, editingItem]);

  const openTagEditor = useCallback(
    (item: { platform: CollectionPlatform; platformItemId: string }, anchorEl: HTMLElement) =>
      setEditing({ ...item, anchorEl }),
    [],
  );
  const closeTagEditor = useCallback(() => setEditing(null), []);
  const handleTagsChanged = useCallback(() => retryQuery(), [retryQuery]);
  const handlePlatformSelect = useCallback(
    (value: string | null) => setPlatform(value && isCollectionPlatform(value) ? value : null),
    [setPlatform],
  );

  const hasRows = items.length > 0;
  const showSkeleton = loading && !hasRows;
  const showError = queryError !== null;
  const showEmpty = !loading && queryError === null && total === 0 && !hasActiveFilter;
  const showNoMatches = !loading && queryError === null && total === 0 && hasActiveFilter;

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={t('allCollections.title')}
        caption={t('allCollections.count', { count: total })}
      />

      <SearchField
        value={searchInput}
        onChange={setSearchInput}
        placeholder={t('allCollections.searchPlaceholder')}
      />

      <CollapsibleChipRow
        icon={<Iconify icon="solar:folder-with-files-bold-duotone" width={20} />}
        title={t('allCollections.platformsTitle')}
        items={collectionPlatformRegistry}
        getKey={(item) => item.id}
        getLabel={(item) => t(item.title)}
        allLabel={t('allCollections.allPlatforms')}
        selected={platform}
        onSelect={handlePlatformSelect}
        showMoreLabel={(overflow) => t('allCollections.showMorePlatforms', { n: overflow })}
        showLessLabel={t('allCollections.showLessPlatforms')}
      />

      {showError ? (
        <ErrorState
          title={t('common.loadFailed')}
          message={queryError ?? ''}
          retryLabel={t('common.retry')}
          onRetry={retryQuery}
        />
      ) : showSkeleton ? (
        <CollectionsGridSkeleton />
      ) : showEmpty ? (
        <EmptyCollectionsState
          title={t('allCollections.emptyTitle')}
          description={t('allCollections.emptyDesc')}
        />
      ) : showNoMatches ? (
        <NoMatchesState message={t('allCollections.noMatches')} />
      ) : (
        <>
          <CardGrid>
            {items.map((item) => (
              <CardGridItem key={`${item.platform}:${item.itemId}`}>
                <CollectionItemCard
                  item={item}
                  onEditTags={(anchor) => openTagEditor(item, anchor)}
                />
              </CardGridItem>
            ))}
          </CardGrid>

          <CardGridPagination page={page} totalPages={totalPages} onChange={goToPage} />

          <TagEditPopover
            platform={editing?.platform ?? ''}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editingItem?.tags ?? []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />
        </>
      )}
    </DashboardContent>
  );
}
