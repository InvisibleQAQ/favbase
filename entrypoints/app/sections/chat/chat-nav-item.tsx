import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import { varAlpha } from 'minimal-shared/utils';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { ConversationSummary } from './use-chat-agent';

interface ChatNavItemProps {
  conversation: ConversationSummary;
  active: boolean;
  /** Rail is collapsed to icon width: only the avatar shows. */
  collapse: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

/**
 * One conversation row: Minimal's 72px `ListItemButton` (48px avatar + two text
 * lines) with the delete action as a **sibling** button — nesting it inside the
 * row button would make an unreachable nested control (chat contract 6).
 *
 * Favbase conversations have no avatar image, so the circle carries the first
 * character of the title; collapsed, that circle plus the tooltip is the whole
 * row, which is why the accessible name moves onto the button itself.
 */
export function ChatNavItem({
  conversation,
  active,
  collapse,
  onSelect,
  onDelete,
}: ChatNavItemProps) {
  const { t } = useTranslation();
  const label = conversation.title || t('chat.untitledConversation');
  // Split by code point: a title starting with an emoji or a surrogate pair
  // would otherwise render half a character.
  const initial = Array.from(label)[0] ?? '?';

  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', pr: collapse ? 0 : 1 }}>
      <Tooltip title={collapse ? label : ''} placement="right">
        <ListItemButton
          aria-current={active ? 'true' : undefined}
          aria-label={collapse ? label : undefined}
          onClick={onSelect}
          sx={(theme) => ({
            gap: 2,
            py: 1.5,
            px: 2.5,
            minWidth: 0,
            flexGrow: 1,
            // Selected row = 8% brand wash under ink text, the same active
            // pattern the shell nav uses; the brand color is never the text.
            ...(active && { bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08) }),
            ...(collapse && { px: 1.5, justifyContent: 'center' }),
          })}
        >
          <Avatar
            aria-hidden
            sx={(theme) => ({
              width: 48,
              height: 48,
              typography: 'subtitle1',
              color: theme.vars.palette.text.primary,
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, active ? 0.24 : 0.12),
            })}
          >
            {initial}
          </Avatar>

          {!collapse && (
            <ListItemText
              primary={label}
              secondary={formatDateTime(conversation.updatedAt)}
              slotProps={{
                primary: {
                  noWrap: true,
                  sx: { fontWeight: active ? 'fontWeightSemiBold' : 'fontWeightRegular' },
                },
                secondary: { noWrap: true },
              }}
            />
          )}
        </ListItemButton>
      </Tooltip>

      {!collapse && (
        <Tooltip title={t('chat.deleteConversation')}>
          <IconButton
            size="small"
            aria-label={`${t('chat.deleteConversation')}: ${label}`}
            onClick={onDelete}
            sx={{ color: 'text.secondary', flexShrink: 0 }}
          >
            <Iconify icon="solar:trash-bin-trash-bold" width={16} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
