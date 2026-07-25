import { Link as RouterLink } from 'react-router-dom';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Skeleton from '@mui/material/Skeleton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import type {
  CollectionAnalyticsDimensionKind,
  CollectionAnalyticsPlatform,
  CollectionAnalyticsSnapshot,
  CollectionPlatform,
} from '@/lib/collections';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';

import { collectionPlatformRegistry } from '../../collection-platform-registry';
import { ErrorState, StateBox } from '../../components/collection';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import {
  useCollectionAnalytics,
  type UseCollectionAnalyticsReturn,
} from './use-collection-analytics';

const DIMENSION_LABELS: Record<CollectionAnalyticsDimensionKind, LocaleKeys> = {
  uploader: 'dashboard.dimension.uploader',
  favoriteFolder: 'dashboard.dimension.favoriteFolder',
  language: 'dashboard.dimension.language',
  repositoryOwner: 'dashboard.dimension.repositoryOwner',
  domain: 'dashboard.dimension.domain',
  folder: 'dashboard.dimension.folder',
  author: 'dashboard.dimension.author',
  collection: 'dashboard.dimension.collection',
  channel: 'dashboard.dimension.channel',
  playlist: 'dashboard.dimension.playlist',
};

const PLATFORM_COLORS: Record<CollectionPlatform, string> = {
  bilibili: 'primary.main',
  github: 'text.primary',
  bookmarks: 'warning.main',
  x: 'info.main',
  zhihu: 'secondary.main',
  youtube: 'error.main',
};

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatShare(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function AnalyticsLoading({ label }: { label: string }) {
  return (
    <Box aria-busy="true" aria-label={label} sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 3 }}>
        {[0, 1, 2].map((key) => (
          <Box key={key}>
            <Skeleton variant="text" width={96} />
            <Skeleton variant="text" width={120} height={48} />
          </Box>
        ))}
      </Box>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Skeleton variant="text" width={180} height={32} />
          <Skeleton variant="rounded" height={12} sx={{ my: 2 }} />
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} variant="text" height={36} />
          ))}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Skeleton variant="text" width={120} height={32} />
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} variant="text" height={44} />
          ))}
        </Grid>
      </Grid>
      <Skeleton variant="rounded" height={48} />
      <Skeleton variant="rounded" height={220} />
    </Box>
  );
}

function SummaryBand({ snapshot, locale }: { snapshot: CollectionAnalyticsSnapshot; locale: string }) {
  const { t } = useTranslation();
  const metrics = [
    { label: t('dashboard.totalItems'), value: snapshot.totalItems },
    { label: t('dashboard.usedTags'), value: snapshot.usedTags },
    { label: t('dashboard.taggedItems'), value: snapshot.taggedItems },
  ];

  return (
    <Box
      component="section"
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
        borderTop: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
        borderBottom: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
      })}
    >
      {metrics.map((metric, index) => (
        <Box
          key={metric.label}
          sx={(theme) => ({
            py: 2.5,
            px: { xs: 0, sm: 3 },
            ...(index > 0 && {
              borderTop: {
                xs: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
                sm: 'none',
              },
              borderLeft: {
                xs: 'none',
                sm: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
              },
            }),
            '&:first-of-type': { pl: 0 },
          })}
        >
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
            {metric.label}
          </Typography>
          <Typography
            variant="h3"
            sx={{ fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}
          >
            {formatNumber(metric.value, locale)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function PlatformComposition({
  platforms,
  locale,
}: {
  platforms: CollectionAnalyticsPlatform[];
  locale: string;
}) {
  const { t } = useTranslation();
  const registryById = new Map(collectionPlatformRegistry.map((platform) => [platform.id, platform]));
  const hasItems = platforms.some((platform) => platform.itemCount > 0);

  return (
    <Box component="section" aria-labelledby="dashboard-platform-composition">
      <Typography id="dashboard-platform-composition" variant="h6" sx={{ mb: 2 }}>
        {t('dashboard.platformComposition')}
      </Typography>
      {hasItems && (
        <Box
          aria-hidden="true"
          sx={{ display: 'flex', width: 1, height: 10, overflow: 'hidden', borderRadius: 0.75, mb: 2 }}
        >
          {platforms.map((platform) => (
            <Box
              key={platform.platform}
              sx={{ width: `${platform.share * 100}%`, bgcolor: PLATFORM_COLORS[platform.platform] }}
            />
          ))}
        </Box>
      )}
      <Box>
        {platforms.map((platform, index) => {
          const config = registryById.get(platform.platform)!;
          return (
            <Box key={platform.platform}>
              {index > 0 && <Divider />}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '32px minmax(0, 1fr) auto auto',
                  alignItems: 'center',
                  gap: { xs: 1, sm: 2 },
                  minHeight: 48,
                }}
              >
                <Iconify icon={config.icon} width={22} sx={{ color: PLATFORM_COLORS[platform.platform] }} />
                <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {t(config.title)}
                </Typography>
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(platform.itemCount, locale)}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatShare(platform.share, locale)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function TopTags({ snapshot, locale }: { snapshot: CollectionAnalyticsSnapshot; locale: string }) {
  const { t } = useTranslation();
  return (
    <Box component="section" aria-labelledby="dashboard-top-tags">
      <Typography id="dashboard-top-tags" variant="h6" sx={{ mb: 1 }}>
        {t('dashboard.topTags')}
      </Typography>
      {snapshot.topTags.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
          {t('dashboard.noTags')}
        </Typography>
      ) : (
        <List disablePadding>
          {snapshot.topTags.map((tag, index) => (
            <Box key={tag.id}>
              {index > 0 && <Divider />}
              <ListItemButton
                component={RouterLink}
                to={`/collections?tag=${encodeURIComponent(tag.id)}`}
                sx={{ px: 0, minHeight: 48 }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {tag.name}
                </Typography>
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(tag.itemCount, locale)}
                </Typography>
                <Iconify icon="eva:arrow-ios-forward-fill" width={18} sx={{ ml: 1, color: 'text.disabled' }} />
              </ListItemButton>
            </Box>
          ))}
        </List>
      )}
    </Box>
  );
}

function PlatformDetail({ platform, locale }: { platform: CollectionAnalyticsPlatform; locale: string }) {
  const { t } = useTranslation();
  const config = collectionPlatformRegistry.find((entry) => entry.id === platform.platform)!;
  const populatedDimensions = platform.dimensions.filter((dimension) => dimension.entries.length > 0);

  return (
    <Box
      role="tabpanel"
      id={`dashboard-platform-panel-${platform.platform}`}
      aria-labelledby={`dashboard-platform-tab-${platform.platform}`}
      sx={{ pt: 3 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
            {t(config.title)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {t('dashboard.itemCount', {
              count: platform.itemCount,
              value: formatNumber(platform.itemCount, locale),
            })}
          </Typography>
        </Box>
        <Button component={RouterLink} to={config.path} variant="text" sx={{ flexShrink: 0 }}>
          {t('dashboard.openPlatform')}
        </Button>
      </Box>

      {platform.itemCount === 0 ? (
        <StateBox
          minHeight={180}
          icon={<Iconify icon={config.icon} width={48} sx={{ color: 'text.disabled' }} />}
          description={t('dashboard.platformEmpty')}
        />
      ) : populatedDimensions.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
          {t('dashboard.noDimensionData')}
        </Typography>
      ) : (
        <Grid container spacing={{ xs: 3, md: 5 }}>
          {populatedDimensions.map((dimension) => (
            <Grid key={dimension.kind} size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                {t(DIMENSION_LABELS[dimension.kind])}
              </Typography>
              {dimension.entries.map((entry, index) => (
                <Box key={entry.id}>
                  {index > 0 && <Divider />}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 42 }}>
                    <Typography
                      variant="body2"
                      sx={{ flex: 1, minWidth: 0, py: 1, overflowWrap: 'anywhere' }}
                    >
                      {entry.label}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatNumber(entry.itemCount, locale)}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
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
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 0.5, letterSpacing: 0 }}>
          {t('dashboard.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('dashboard.subtitle')}
        </Typography>
      </Box>

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
        <>
          <SummaryBand snapshot={snapshot} locale={locale} />

          {snapshot.totalItems === 0 && (
            <Box sx={{ my: 4 }}>
              <StateBox
                minHeight={220}
                icon={<Iconify icon="solar:database-bold-duotone" width={56} sx={{ color: 'text.disabled' }} />}
                title={t('dashboard.emptyTitle')}
                description={t('dashboard.emptyDesc')}
                action={
                  <Button component={RouterLink} to="/collections" variant="outlined">
                    {t('dashboard.openCollections')}
                  </Button>
                }
              />
            </Box>
          )}

          <Grid container spacing={{ xs: 4, md: 0 }} sx={{ py: 4 }}>
            <Grid size={{ xs: 12, md: 8 }} sx={{ pr: { md: 5 } }}>
              <PlatformComposition platforms={snapshot.platforms} locale={locale} />
            </Grid>
            <Grid
              size={{ xs: 12, md: 4 }}
              sx={(theme) => ({
                pt: { xs: 4, md: 0 },
                pl: { md: 5 },
                borderTop: {
                  xs: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
                  md: 'none',
                },
                borderLeft: {
                  xs: 'none',
                  md: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`,
                },
              })}
            >
              <TopTags snapshot={snapshot} locale={locale} />
            </Grid>
          </Grid>

          <Divider />
          <Box component="section" aria-labelledby="dashboard-platform-details" sx={{ pt: 4 }}>
            <Typography id="dashboard-platform-details" variant="h6" sx={{ mb: 2 }}>
              {t('dashboard.platformDetails')}
            </Typography>
            <Tabs
              value={selectedPlatform}
              onChange={(_event, value: CollectionPlatform) => selectPlatform(value)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              aria-label={t('dashboard.platformDetails')}
              sx={{ minHeight: 48, borderBottom: 1, borderColor: 'divider' }}
            >
              {collectionPlatformRegistry.map((platform) => (
                <Tab
                  key={platform.id}
                  id={`dashboard-platform-tab-${platform.id}`}
                  aria-controls={
                    selectedPlatform === platform.id
                      ? `dashboard-platform-panel-${platform.id}`
                      : undefined
                  }
                  value={platform.id}
                  label={t(platform.title)}
                  icon={<Iconify icon={platform.icon} width={20} />}
                  iconPosition="start"
                  sx={{ minHeight: 48, flexShrink: 0 }}
                />
              ))}
            </Tabs>
            {selected && <PlatformDetail platform={selected} locale={locale} />}
          </Box>
        </>
      )}
    </DashboardContent>
  );
}

export function OverviewView() {
  return <CollectionAnalyticsContent {...useCollectionAnalytics()} />;
}
