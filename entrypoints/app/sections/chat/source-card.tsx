import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
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

  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        variant="caption"
        sx={(theme) => ({
          display: 'block',
          mb: 0.75,
          fontWeight: theme.typography.fontWeightSemiBold,
          color: theme.vars.palette.text.secondary,
        })}
      >
        {t('chat.sourcesTitle', { n: sources.length })}
      </Typography>
      <Stack spacing={0.75}>
        {sources.map((source) => (
          <SourceCardItem key={source.itemId} source={source} openLabel={t('chat.openSource')} />
        ))}
      </Stack>
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

  return (
    <Card
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={canOpen ? `${openLabel}: ${source.title}` : undefined}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleOpen();
        }
      }}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        cursor: canOpen ? 'pointer' : 'default',
        boxShadow: 'none',
        border: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
        transition: theme.transitions.create(['border-color', 'background-color']),
        '&:hover': canOpen
          ? {
              borderColor: varAlpha(theme.vars.palette.primary.mainChannel, 0.4),
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.04),
            }
          : undefined,
      })}
    >
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
          noWrap
          sx={(theme) => ({ color: theme.vars.palette.text.primary })}
        >
          {source.title || source.url}
        </Typography>
        <Typography
          variant="caption"
          sx={(theme) => ({ color: theme.vars.palette.text.disabled })}
        >
          {platformLabel}
          {typeof source.score === 'number' ? ` · ${source.score.toFixed(2)}` : ''}
        </Typography>
      </Box>
      {canOpen && (
        <Iconify
          icon="eva:arrow-ios-forward-fill"
          width={16}
          sx={(theme) => ({ flexShrink: 0, color: theme.vars.palette.text.disabled })}
        />
      )}
    </Card>
  );
}
