import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type {
  CollectionAnalyticsDimension,
  CollectionAnalyticsDimensionKind,
} from '@/lib/collections';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify/register-icons';
import { formatNumber } from './analytics-format';

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

/**
 * One ranked list inside the platform detail card. Platform differences are
 * data (`kind`), never a branch: both records above are exhaustive over
 * `CollectionAnalyticsDimensionKind`, so a new kind fails compilation here.
 */
export function AnalyticsDimensionRanking({
  dimension,
}: {
  dimension: CollectionAnalyticsDimension;
}) {
  const { t, locale } = useTranslation();
  // Entries arrive sorted by count desc, so the first one is the scale.
  const max = dimension.entries[0]?.itemCount ?? 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Iconify icon={DIMENSION_ICONS[dimension.kind]} width={18} sx={{ color: 'text.secondary' }} />
        {/* Compact heading inside the detail card: h3 in the outline, 14px in weight. */}
        <Typography variant="h6" component="h3">
          {t(DIMENSION_LABELS[dimension.kind])}
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {dimension.entries.map((entry) => (
          <Box component="li" key={entry.id} sx={{ py: 0.75 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 2,
              }}
            >
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
