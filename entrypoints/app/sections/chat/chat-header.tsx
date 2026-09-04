import type { RefObject } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';

interface ChatHeaderProps {
  /** Active conversation title, already resolved; `null` before one exists. */
  conversationTitle: string | null;
  historyTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenHistory: () => void;
}

/**
 * Minimal's chat header slot, in Favbase terms: the page heading plus which
 * conversation is open. Below `lg` the rail is gone, so this line is the only
 * place that answers "which conversation am I in", and it owns the trigger that
 * opens the history Drawer.
 *
 * Minimal's compose header (recipient picker) has no counterpart, and neither
 * does a conversation action menu: the runtime exposes no rename, and delete
 * already sits on every row (docs/25 Step 9 erratum E-2).
 */
export function ChatHeader({
  conversationTitle,
  historyTriggerRef,
  onOpenHistory,
}: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <Box component="img" src="/icon/128.png" alt="" sx={{ width: 28, height: 28, flexShrink: 0 }} />

      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography id="chat-page-title" variant="h1" noWrap>
          {t('chat.title')}
        </Typography>
        {conversationTitle && (
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
            {conversationTitle}
          </Typography>
        )}
      </Box>

      <Tooltip title={t('chat.openHistory')}>
        <IconButton
          ref={historyTriggerRef}
          aria-label={t('chat.openHistory')}
          onClick={onOpenHistory}
          sx={{ flexShrink: 0, display: { xs: 'inline-flex', lg: 'none' } }}
        >
          <Iconify icon="solar:chat-round-dots-bold" width={22} />
        </IconButton>
      </Tooltip>
    </>
  );
}
