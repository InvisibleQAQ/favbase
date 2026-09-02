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
import { ErrorState, SectionTitleBar, StateBox } from '../../components/collection';
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

/**
 * Vertical rhythm between the page's hairline-separated sections (32px).
 * Inside a section the shared 24px rhythm applies.
 */
const SECTION_GAP = 4;

/** Every hairline on this page is the theme divider — no page-local alphas. */
function hairline(theme: Theme): string {
  return `1px solid ${theme.vars.palette.divider}`;
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
          borderRadius: 0.75,
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

/** Same geometry as the loaded page: band → shelf (6 rows) | detail (header + two rankings). */
function AnalyticsLoading({ label }: { label: string }) {
  return (
    <Box role="status" aria-busy="true" aria-label={label}>
      <Box
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          borderTop: hairline(theme),
          borderBottom: hairline(theme),
        })}
      >
        {[0, 1, 2].map((key) => (
          <Box key={key} sx={{ py: 2.5, px: { xs: 0, sm: 3 }, '&:first-of-type': { pl: 0 } }}>
            <Skeleton variant="text" width={120} sx={{ mb: 0.5 }} />
            <Skeleton variant="text" width={96} height={26} />
          </Box>
        ))}
      </Box>
      <Grid container spacing={{ xs: SECTION_GAP, lg: 0 }} sx={{ mt: SECTION_GAP }}>
        <Grid size={{ xs: 12, lg: 4 }} sx={{ pr: { lg: SECTION_GAP } }}>
          <Skeleton variant="text" width={180} height={30} sx={{ mb: 2 }} />
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Box
              key={key}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, minHeight: 56 }}
            >
              <Skeleton variant="rounded" width={36} height={36} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
              </Box>
            </Box>
          ))}
        </Grid>
        <Grid size={{ xs: 12, lg: 8 }} sx={{ pl: { lg: SECTION_GAP } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Skeleton variant="rounded" width={48} height={48} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width={200} height={30} />
              <Skeleton variant="text" width={100} />
            </Box>
          </Box>
          <Grid container spacing={{ xs: 3, md: 5 }}>
            {[0, 1].map((column) => (
              <Grid key={column} size={{ xs: 12, md: 6 }}>
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
      data-section="summary"
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
              borderTop: { xs: hairline(theme), sm: 'none' },
              borderLeft: { xs: 'none', sm: hairline(theme) },
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
          {/* Metric figure: Barlow h3 (20px) — a figure, never a heading. */}
          <Typography variant="h3" component="p">
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
      <Typography component="span" variant="subtitle1" sx={{ color: 'text.primary' }}>
        {formatNumber(platform.itemCount, locale)}
      </Typography>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', minWidth: 0, minHeight: 4 }}>
        {platform.share > 0 && (
          <Box
            component="span"
            data-slot="share-bar"
            aria-hidden="true"
            sx={{
              display: 'block',
              height: 4,
              minWidth: 4,
              borderRadius: 0.5,
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
        data-slot="share-label"
        sx={{ color: 'text.primary', minWidth: 44, textAlign: 'right' }}
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
      <Typography id="dashboard-platform-composition" variant="h2" sx={{ mb: 2 }}>
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
                px: 1.5,
                py: 1,
                borderRadius: 0.75,
                '&:hover': { bgcolor: 'action.hover' },
                // Selection = 8% brand wash on the row (the tile flips to the brand stamp).
                '&.Mui-selected': {
                  bgcolor: (theme) => varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
                },
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
        {/* Compact heading inside the detail panel: h3 in the outline, h6 (14px) in weight. */}
        <Typography variant="h6" component="h3">
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
              <Typography variant="subtitle2" component="span" sx={{ flexShrink: 0 }}>
                {formatNumber(entry.itemCount, locale)}
              </Typography>
            </Box>
            {entry.itemCount > 0 && max > 0 && (
              <Box
                aria-hidden="true"
                sx={(theme) => ({
                  height: 4,
                  minWidth: 4,
                  borderRadius: 0.5,
                  mt: 0.5,
                  width: `${(entry.itemCount / max) * 100}%`,
                  // Secondary ink: rankings never wear the platform color.
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
      {/* Same wrap rule as SectionTitleBar: on narrow widths the action drops
          under the title instead of squeezing the h2 into a few characters. */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <PlatformTile platform={platform.platform} icon={config.icon} size={48} iconSize={28} />
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>
            {t(config.title)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
        <Grid container spacing={{ xs: 3, md: 5 }}>
          {populatedDimensions.map((dimension) => (
            <Grid key={dimension.kind} size={{ xs: 12, md: 6 }}>
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
      <Divider sx={{ my: SECTION_GAP }} />
      <Box component="section" aria-labelledby="dashboard-top-tags">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Iconify icon="mdi:tag" width={20} sx={{ color: 'text.secondary' }} />
          <Typography id="dashboard-top-tags" variant="h2">
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
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
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
        <>
          <SummaryBand snapshot={snapshot} locale={locale} />

          {snapshot.totalItems === 0 && (
            <Box sx={{ mt: SECTION_GAP }}>
              <StateBox
                minHeight={220}
                icon={
                  <Iconify icon="solar:database-bold-duotone" width={48} sx={{ color: 'text.secondary' }} />
                }
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

          {/* Shelf | detail sit side by side only from `lg` (≥1200px viewport): below
              that a pinned 300px nav leaves too little width for a 4/12 shelf to show
              platform names and counts untruncated, so they stack with a hairline between. */}
          <Grid container spacing={{ xs: SECTION_GAP, lg: 0 }} sx={{ mt: SECTION_GAP }}>
            <Grid size={{ xs: 12, lg: 4 }} sx={{ pr: { lg: SECTION_GAP } }}>
              <PlatformShelf
                platforms={snapshot.platforms}
                selectedPlatform={selectedPlatform}
                selectPlatform={selectPlatform}
                locale={locale}
              />
            </Grid>
            <Grid
              size={{ xs: 12, lg: 8 }}
              sx={(theme) => ({
                pt: { xs: SECTION_GAP, lg: 0 },
                pl: { lg: SECTION_GAP },
                borderTop: { xs: hairline(theme), lg: 'none' },
                borderLeft: { xs: 'none', lg: hairline(theme) },
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
