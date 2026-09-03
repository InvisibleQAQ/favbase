import { Link as RouterLink } from 'react-router-dom';

import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';

import type { CollectionAnalyticsSnapshot } from '@/lib/collections';
import type { SupportedLocale } from '@/lib/i18n';
import type { UseTranslationReturn } from '@/lib/i18n/use-translation';
import { useTranslation } from '@/lib/i18n/use-translation';

import { ErrorState, SectionTitleBar, StateBox } from '../../components/collection';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { formatNumber, formatShare } from './analytics-format';
import { AnalyticsLoading } from './analytics-loading';
import { AnalyticsPlatformComposition } from './analytics-platform-composition';
import { AnalyticsPlatformDetail } from './analytics-platform-detail';
import { AnalyticsTopTags } from './analytics-top-tags';
import {
  AnalyticsWidgetSummary,
  type AnalyticsWidgetSummaryProps,
} from './analytics-widget-summary';
import {
  useCollectionAnalytics,
  type UseCollectionAnalyticsReturn,
} from './use-collection-analytics';

/**
 * The four KPI cards, bound to `CollectionAnalyticsSnapshot` fields only
 * (docs/25 D17). No sparkline and no trend: nothing here stores a time series,
 * and a fabricated one would be a lie about the user's own library.
 */
function buildKpis(
  snapshot: CollectionAnalyticsSnapshot,
  // The hook's own contract, not a re-derived shape: `buildKpis` is handed
  // exactly what `useTranslation()` returns.
  t: UseTranslationReturn['t'],
  locale: SupportedLocale,
): (AnalyticsWidgetSummaryProps & { key: string })[] {
  const platformsInUse = snapshot.platforms.filter((platform) => platform.itemCount > 0).length;

  return [
    {
      key: 'items',
      icon: 'solar:database-bold-duotone',
      color: 'primary',
      title: t('dashboard.totalItems'),
      value: formatNumber(snapshot.totalItems, locale),
    },
    {
      key: 'platforms',
      icon: 'solar:layers-bold-duotone',
      color: 'info',
      title: t('dashboard.platformsInUse'),
      // Both ends are snapshot fields; the bare count has no frame of reference.
      value: `${formatNumber(platformsInUse, locale)} / ${formatNumber(snapshot.platforms.length, locale)}`,
    },
    {
      key: 'tags',
      icon: 'solar:tag-bold-duotone',
      color: 'warning',
      title: t('dashboard.usedTags'),
      value: formatNumber(snapshot.usedTags, locale),
    },
    {
      key: 'coverage',
      icon: 'solar:magic-stick-3-bold-duotone',
      color: 'success',
      title: t('dashboard.tagCoverage'),
      // An empty library has no coverage — an em dash, not a fake 0%.
      value:
        snapshot.totalItems === 0
          ? '—'
          : formatShare(snapshot.taggedItems / snapshot.totalItems, locale),
      caption:
        snapshot.usedTags === 0
          ? t('dashboard.noTags')
          : t('dashboard.taggedCount', {
              count: snapshot.taggedItems,
              value: formatNumber(snapshot.taggedItems, locale),
            }),
    },
  ];
}

export function CollectionAnalyticsContent({
  snapshot,
  loading,
  error,
  retry,
  selectedPlatform,
  selectPlatform,
}: UseCollectionAnalyticsReturn) {
  const { t, locale } = useTranslation();
  const selected = snapshot?.platforms.find((row) => row.platform === selectedPlatform);

  return (
    <DashboardContent maxWidth="xl">
      {/* Route title reads first (h1 → subtitle), the same block every collection page uses. */}
      <SectionTitleBar title={t('dashboard.title')} caption={t('dashboard.subtitle')} />

      {error ? (
        <ErrorState
          title={t('common.loadFailed')}
          message={error}
          retryLabel={t('common.retry')}
          onRetry={retry}
        />
      ) : loading || !snapshot ? (
        <AnalyticsLoading label={t('dashboard.loading')} />
      ) : (
        <Grid container spacing={3}>
          {buildKpis(snapshot, t, locale).map(({ key, ...kpi }) => (
            <Grid key={key} size={{ xs: 12, sm: 6, md: 3 }}>
              <AnalyticsWidgetSummary {...kpi} />
            </Grid>
          ))}

          {snapshot.totalItems === 0 && (
            <Grid size={{ xs: 12 }}>
              <StateBox
                minHeight={220}
                icon={
                  <Iconify
                    icon="solar:database-bold-duotone"
                    width={48}
                    sx={{ color: 'text.secondary' }}
                  />
                }
                title={t('dashboard.emptyTitle')}
                description={t('dashboard.emptyDesc')}
                action={
                  <Button component={RouterLink} to="/collections" variant="outlined">
                    {t('dashboard.openCollections')}
                  </Button>
                }
              />
            </Grid>
          )}

          <Grid size={{ xs: 12, md: 6, lg: 4 }}>
            <AnalyticsPlatformComposition
              platforms={snapshot.platforms}
              totalItems={snapshot.totalItems}
              selectedPlatform={selectedPlatform}
              selectPlatform={selectPlatform}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 8 }}>
            {selected && <AnalyticsPlatformDetail platform={selected} />}
          </Grid>

          {snapshot.topTags.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <AnalyticsTopTags tags={snapshot.topTags} />
            </Grid>
          )}
        </Grid>
      )}
    </DashboardContent>
  );
}

export function OverviewView() {
  return <CollectionAnalyticsContent {...useCollectionAnalytics()} />;
}
