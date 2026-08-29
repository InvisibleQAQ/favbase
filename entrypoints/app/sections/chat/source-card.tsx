import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

import { isCollectionPlatform } from '@/lib/collections';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { collectionPlatformRegistry } from '../../collection-platform-registry';
import type { ChatSource } from './use-chat-agent';

const PLATFORM_META = new Map(collectionPlatformRegistry.map((c) => [c.id, c]));

/**
 * Compact source cards under an assistant answer. Each card shows the platform
 * icon + title (+ optional relevance score) and opens the original URL in a new
 * tab on click.
 *
 * Click strategy (honest): no platform has an internal per-item detail route —
 * `/collections/bilibili/:mediaId` and `/collections/bookmarks/:folderId` are
 * FOLDER routes, not item routes, and the retrieval tool only surfaces the
 * original `url` (not a platform-native item id). So every source opens its
 * originalUrl via `window.open(url, '_blank', 'noopener')`.
 */
export function SourceCards({ sources }: { sources: ChatSource[] }) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;
  const sourcesLabel = t('chat.sourcesTitle', { n: sources.length });

  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography
        variant="caption"
        sx={(theme) => ({
          display: 'block',
          mb: 0.75,
          fontWeight: theme.typography.fontWeightSemiBold,
          color: theme.vars.palette.text.secondary,
        })}
      >
        {sourcesLabel}
      </Typography>
      <Box
        component="ul"
        aria-label={sourcesLabel}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
          gap: 0.75,
          m: 0,
          p: 0,
          listStyle: 'none',
        }}
      >
        {sources.map((source) => (
          <Box component="li" key={source.itemId} sx={{ minWidth: 0 }}>
            <SourceCardItem source={source} openLabel={t('chat.openSource')} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

interface SourceCardItemProps {
  source: ChatSource;
  openLabel: string;
}

function SourceCardItem({ source, openLabel }: SourceCardItemProps) {
  const { t } = useTranslation();
  const meta = isCollectionPlatform(source.platform) ? PLATFORM_META.get(source.platform) : undefined;
  const platformLabel = meta ? t(meta.title) : source.platform;
  const canOpen = Boolean(source.url);

  const handleOpen = () => {
    if (canOpen) window.open(source.url, '_blank', 'noopener,noreferrer');
  };

  const itemSx = (theme: Theme) => ({
    display: 'flex',
    width: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 1,
    px: 1.25,
    py: 0.875,
    borderRadius: 0.75,
    border: `1px solid ${theme.vars.palette.divider}`,
    bgcolor: theme.vars.palette.background.neutral,
    color: theme.vars.palette.text.primary,
    textAlign: 'left' as const,
    transition: theme.transitions.create(['border-color', 'background-color', 'transform']),
    ...(canOpen && {
      '&:hover': {
        borderColor: varAlpha(theme.vars.palette.text.primaryChannel, 0.24),
        bgcolor: theme.vars.palette.action.hover,
      },
      '&:active': { transform: 'translateY(1px)' },
      '&.Mui-focusVisible': {
        outline: `2px solid ${theme.vars.palette.primary.main}`,
        outlineOffset: 1,
      },
    }),
  });

  const content = (
    <>
      {meta && (
        <Iconify
          icon={meta.icon}
          width={18}
          sx={(theme) => ({ flexShrink: 0, color: theme.vars.palette.text.secondary })}
        />
      )}
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography
          variant="body2"
          sx={(theme) => ({
            display: '-webkit-box',
            overflow: 'hidden',
            fontWeight: theme.typography.fontWeightMedium,
            color: theme.vars.palette.text.primary,
            lineHeight: 1.35,
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          })}
        >
          {source.title || source.url}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          sx={(theme) => ({ display: 'block', mt: 0.25, color: theme.vars.palette.text.secondary })}
        >
          {platformLabel}
          {typeof source.score === 'number' ? ` · ${source.score.toFixed(2)}` : ''}
        </Typography>
      </Box>
      {canOpen && (
        <Iconify
          icon="eva:diagonal-arrow-right-up-fill"
          width={16}
          sx={(theme) => ({ flexShrink: 0, color: theme.vars.palette.text.secondary })}
        />
      )}
    </>
  );

  if (!canOpen) return <Box sx={itemSx}>{content}</Box>;

  return (
    <ButtonBase
      type="button"
      aria-label={`${openLabel}: ${source.title || source.url}`}
      onClick={handleOpen}
      sx={itemSx}
    >
      {content}
    </ButtonBase>
  );
}
