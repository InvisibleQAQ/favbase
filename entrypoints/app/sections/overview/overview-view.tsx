import { Link as RouterLink } from 'react-router-dom';
import { varAlpha } from 'minimal-shared/utils';
import type { SxProps, Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
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
import type { IconifyName } from '../../components/iconify/register-icons';
import { DashboardContent } from '../../layouts/dashboard';
import {
  useCollectionAnalytics,
  type UseCollectionAnalyticsReturn,
} from './use-collection-analytics';

type CollectionAnalyticsDimension = CollectionAnalyticsPlatform['dimensions'][number];

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

/** Glyph per dimension kind — people, containers, playlists, languages, domains. */
const DIMENSION_ICONS: Record<CollectionAnalyticsDimensionKind, IconifyName> = {
  uploader: 'solar:user-bold-duotone',
  author: 'solar:user-bold-duotone',
  repositoryOwner: 'solar:user-bold-duotone',
  channel: 'solar:user-bold-duotone',
  favoriteFolder: 'solar:folder-with-files-bold-duotone',
  folder: 'solar:folder-with-files-bold-duotone',
  collection: 'solar:folder-with-files-bold-duotone',
  playlist: 'solar:playlist-bold-duotone',
  language: 'solar:code-bold-duotone',
  domain: 'solar:global-bold-duotone',
};

const registryById = new Map(collectionPlatformRegistry.map((platform) => [platform.id, platform]));

function hairline(theme: Theme): string {
  return `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.2)}`;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatShare(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

/**
 * Neutral square holding a platform glyph. Identity = the platform's brand color
 * on the glyph (`palette.platform`, black-logo brands resolve to ink there);
 * `selected` overrides it with the coral stamp (ink glyph) — coral owns selection.
 * Rendered as a span so it is legal inside a Tab's <button>.
 */
function PlatformTile({
  platform,
  icon,
  size,
  iconSize,
  selected = false,
  sx,
}: {
  platform: CollectionPlatform;
  icon: IconifyName;
  size: number;
  iconSize: number;
  selected?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={[
        (theme) => ({
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: selected ? 'primary.main' : 'background.neutral',
          color: selected ? 'primary.contrastText' : theme.vars.palette.platform[platform],
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Iconify icon={icon} width={iconSize} />
    </Box>
  );
}

function AnalyticsLoading({ label }: { label: string }) {
  return (
    <Box aria-busy="true" aria-label={label} sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 3 }}>
        {[0, 1, 2].map((key) => (
          <Box key={key}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Skeleton variant="circular" width={18} height={18} />
              <Skeleton variant="text" width={96} />
            </Box>
            <Skeleton variant="text" width={120} height={32} />
          </Box>
        ))}
      </Box>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Skeleton variant="text" width={160} height={28} sx={{ mb: 1.5 }} />
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
              <Skeleton variant="rounded" width={36} height={36} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
              </Box>
            </Box>
          ))}
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Skeleton variant="rounded" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width={180} height={28} />
              <Skeleton variant="text" width={100} />
            </Box>
          </Box>
          <Grid container spacing={{ xs: 3, lg: 5 }}>
            {[0, 1].map((column) => (
              <Grid key={column} size={{ xs: 12, lg: 6 }}>
                <Skeleton variant="text" width={140} sx={{ mb: 1 }} />
                {[0, 1, 2, 3, 4].map((key) => (
                  <Skeleton key={key} variant="text" height={36} />
                ))}
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}

function SummaryBand({ snapshot, locale }: { snapshot: CollectionAnalyticsSnapshot; locale: string }) {
  const { t } = useTranslation();
  const platformsInUse = snapshot.platforms.filter((platform) => platform.itemCount > 0).length;
  const coverage = snapshot.totalItems === 0 ? 0 : snapshot.taggedItems / snapshot.totalItems;
  const metrics: { key: string; icon: IconifyName; label: string; value: string; caption?: string }[] = [
    {
      key: 'items',
      icon: 'solar:database-bold-duotone',
      label: t('dashboard.totalItems'),
      value: formatNumber(snapshot.totalItems, locale),
    },
    {
      key: 'platforms',
      icon: 'solar:layers-bold-duotone',
      label: t('dashboard.platformsInUse'),
      value: `${formatNumber(platformsInUse, locale)} / ${formatNumber(snapshot.platforms.length, locale)}`,
    },
    {
      key: 'tags',
      icon: 'solar:tag-bold-duotone',
      label: t('dashboard.tagCoverage'),
      value: formatShare(coverage, locale),
      caption:
        snapshot.usedTags === 0
          ? t('dashboard.noTags')
          : `${t('dashboard.tagCount', {
              count: snapshot.usedTags,
              value: formatNumber(snapshot.usedTags, locale),
            })} · ${t('dashboard.taggedCount', {
              count: snapshot.taggedItems,
              value: formatNumber(snapshot.taggedItems, locale),
            })}`,
    },
  ];

  return (
    <Box
      component="section"
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
        borderTop: hairline(theme),
        borderBottom: hairline(theme),
      })}
    >
      {metrics.map((metric, index) => (
        <Box
          key={metric.key}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, color: 'text.secondary' }}>
            <Iconify icon={metric.icon} width={18} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {metric.label}
            </Typography>
          </Box>
          <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {metric.value}
          </Typography>
          {metric.caption && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              {metric.caption}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** Tab label: tile spanning two rows, then name + count, then share bar + share. All spans (lives in a <button>). */
function PlatformShelfLabel({
  platform,
  selected,
  locale,
}: {
  platform: CollectionAnalyticsPlatform;
  selected: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const config = registryById.get(platform.platform)!;
  const title = t(config.title);

  return (
    <Box
      component="span"
      sx={{
        display: 'grid',
        gridTemplateColumns: '36px minmax(0, 1fr) auto',
        columnGap: 1.5,
        rowGap: 0.5,
        alignItems: 'center',
        width: 1,
      }}
    >
      <PlatformTile
        platform={platform.platform}
        icon={config.icon}
        size={36}
        iconSize={20}
        selected={selected}
        sx={{ gridRow: 'span 2' }}
      />
      <Typography
        component="span"
        variant="body2"
        noWrap
        title={title}
        sx={{ minWidth: 0, color: 'text.primary', fontWeight: selected ? 'fontWeightSemiBold' : undefined }}
      >
        {title}
      </Typography>
      <Typography component="span" variant="subtitle1" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {formatNumber(platform.itemCount, locale)}
      </Typography>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: 4 }}>
        {platform.share > 0 && (
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              display: 'block',
              height: 4,
              minWidth: 4,
              borderRadius: 1,
              width: `${platform.share * 100}%`,
              // Always the platform's own color; selection is told by the tile + row wash.
              bgcolor: (theme) => theme.vars.palette.platform[platform.platform],
            }}
          />
        )}
      </Box>
      <Typography
        component="span"
        variant="caption"
        sx={{ color: 'text.secondary', minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {formatShare(platform.share, locale)}
      </Typography>
    </Box>
  );
}

/** Platform composition that doubles as the detail selector (one list, not two). */
function PlatformShelf({
  platforms,
  selectedPlatform,
  selectPlatform,
  locale,
}: {
  platforms: CollectionAnalyticsPlatform[];
  selectedPlatform: CollectionPlatform;
  selectPlatform: (platform: CollectionPlatform) => void;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <Box component="section" aria-labelledby="dashboard-platform-composition">
      <Typography id="dashboard-platform-composition" variant="h6" component="h2" sx={{ mb: 1.5 }}>
        {t('dashboard.platformComposition')}
      </Typography>
      <Tabs
        orientation="vertical"
        value={selectedPlatform}
        onChange={(_event, value: CollectionPlatform) => selectPlatform(value)}
        aria-label={t('dashboard.platformDetails')}
        sx={{
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { gap: 0.5 },
        }}
      >
        {platforms.map((platform) => {
          const selected = platform.platform === selectedPlatform;
          return (
            <Tab
              key={platform.platform}
              id={`dashboard-platform-tab-${platform.platform}`}
              aria-controls={selected ? `dashboard-platform-panel-${platform.platform}` : undefined}
              value={platform.platform}
              label={<PlatformShelfLabel platform={platform} selected={selected} locale={locale} />}
              sx={{
                maxWidth: 'none',
                minHeight: 56,
                alignItems: 'stretch',
                textAlign: 'left',
                opacity: 1,
                px: 1.5,
                py: 1,
                borderRadius: 1,
                textTransform: 'none',
                color: 'text.primary',
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-selected': { bgcolor: 'primary.lighter', color: 'text.primary' },
              }}
            />
          );
        })}
      </Tabs>
    </Box>
  );
}

function DimensionRanking({
  dimension,
  locale,
}: {
  dimension: CollectionAnalyticsDimension;
  locale: string;
}) {
  const { t } = useTranslation();
  // Entries arrive sorted by count desc, so the first one is the scale.
  const max = dimension.entries[0]?.itemCount ?? 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Iconify icon={DIMENSION_ICONS[dimension.kind]} width={18} sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle2" component="h3">
          {t(DIMENSION_LABELS[dimension.kind])}
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {dimension.entries.map((entry) => (
          <Box component="li" key={entry.id} sx={{ py: 0.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
              <Typography variant="body2" noWrap title={entry.label} sx={{ minWidth: 0 }}>
                {entry.label}
              </Typography>
              <Typography variant="subtitle2" component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {formatNumber(entry.itemCount, locale)}
              </Typography>
            </Box>
            {entry.itemCount > 0 && max > 0 && (
              <Box
                aria-hidden="true"
                sx={(theme) => ({
                  height: 4,
                  minWidth: 4,
                  borderRadius: 1,
                  mt: 0.5,
                  width: `${(entry.itemCount / max) * 100}%`,
                  bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.64),
                })}
              />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function PlatformDetail({ platform, locale }: { platform: CollectionAnalyticsPlatform; locale: string }) {
  const { t } = useTranslation();
  const config = registryById.get(platform.platform)!;
  const populatedDimensions = platform.dimensions.filter((dimension) => dimension.entries.length > 0);

  return (
    <Box
      role="tabpanel"
      id={`dashboard-platform-panel-${platform.platform}`}
      aria-labelledby={`dashboard-platform-tab-${platform.platform}`}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <PlatformTile platform={platform.platform} icon={config.icon} size={40} iconSize={24} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>
            {t(config.title)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {t('dashboard.itemCount', {
              count: platform.itemCount,
              value: formatNumber(platform.itemCount, locale),
            })}
          </Typography>
        </Box>
        <Button component={RouterLink} to={config.path} variant="outlined" sx={{ flexShrink: 0 }}>
          {t('dashboard.openPlatform')}
        </Button>
      </Box>

      {platform.itemCount === 0 ? (
        <StateBox
          minHeight={200}
          icon={<Iconify icon={config.icon} width={48} sx={{ color: 'text.secondary' }} />}
          description={t('dashboard.platformEmpty')}
        />
      ) : populatedDimensions.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
          {t('dashboard.noDimensionData')}
        </Typography>
      ) : (
        <Grid container spacing={{ xs: 3, lg: 5 }}>
          {populatedDimensions.map((dimension) => (
            <Grid key={dimension.kind} size={{ xs: 12, lg: 6 }}>
              <DimensionRanking dimension={dimension} locale={locale} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

/** Rendered only when there are tags — the zero state already lives in the summary band. */
function TopTags({ tags, locale }: { tags: CollectionAnalyticsSnapshot['topTags']; locale: string }) {
  const { t } = useTranslation();
  if (tags.length === 0) return null;

  return (
    <>
      <Divider sx={{ my: 4 }} />
      <Box component="section" aria-labelledby="dashboard-top-tags">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Iconify icon="mdi:tag" width={18} sx={{ color: 'text.secondary' }} />
          <Typography id="dashboard-top-tags" variant="h6" component="h2">
            {t('dashboard.topTags')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              component={RouterLink}
              to={`/collections?tag=${encodeURIComponent(tag.id)}`}
              clickable
              variant="outlined"
              label={
                <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
                  {tag.name}
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatNumber(tag.itemCount, locale)}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Box>
      </Box>
    </>
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
        <Typography variant="h4" component="h1" sx={{ mb: 0.5 }}>
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
            <Box sx={{ mt: 4 }}>
              <StateBox
                minHeight={220}
                icon={<Iconify icon="solar:database-bold-duotone" width={56} sx={{ color: 'text.secondary' }} />}
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

          <Grid container spacing={{ xs: 4, md: 0 }} sx={{ pt: 4 }}>
            <Grid size={{ xs: 12, md: 4 }} sx={{ pr: { md: 4 } }}>
              <PlatformShelf
                platforms={snapshot.platforms}
                selectedPlatform={selectedPlatform}
                selectPlatform={selectPlatform}
                locale={locale}
              />
            </Grid>
            <Grid
              size={{ xs: 12, md: 8 }}
              sx={(theme) => ({
                pt: { xs: 4, md: 0 },
                pl: { md: 4 },
                borderTop: { xs: hairline(theme), md: 'none' },
                borderLeft: { xs: 'none', md: hairline(theme) },
              })}
            >
              {selected && <PlatformDetail platform={selected} locale={locale} />}
            </Grid>
          </Grid>

          <TopTags tags={snapshot.topTags} locale={locale} />
        </>
      )}
    </DashboardContent>
  );
}

export function OverviewView() {
  return <CollectionAnalyticsContent {...useCollectionAnalytics()} />;
}
