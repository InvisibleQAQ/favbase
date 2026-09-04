import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { Scrollbar } from '../../components/scrollbar';
import { ChatNavItem } from './chat-nav-item';
import { CHAT_NAV_COLLAPSE_WIDTH, CHAT_NAV_WIDTH } from './layout';
import type { ConversationSummary } from './use-chat-agent';

export interface ChatNavProps {
  /** `rail` is the desktop column; `drawer` fills the mobile Drawer paper. */
  variant: 'rail' | 'drawer';
  conversations: ConversationSummary[];
  activeId: string | null;
  /** History failed to load from PGlite — show an error instead of an empty list. */
  loadError: boolean;
  collapse?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Conversation list. The desktop rail collapses from `CHAT_NAV_WIDTH` to
 * `CHAT_NAV_COLLAPSE_WIDTH` (Minimal's chat nav); the same component fills the
 * mobile Drawer, where collapsing is meaningless and the header carries a close
 * button instead of the collapse toggle.
 */
export function ChatNav({
  variant,
  conversations,
  activeId,
  loadError,
  collapse = false,
  onToggleCollapse,
  onClose,
  onNew,
  onSelect,
  onDelete,
}: ChatNavProps) {
  const { t } = useTranslation();
  const rail = variant === 'rail';
  const collapsed = rail && collapse;

  const renderHeader = () => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 2.5,
        pb: 1.5,
        ...(collapsed && { px: 1, flexDirection: 'column' }),
      }}
    >
      {!collapsed && (
        <Typography variant="subtitle2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
          {t('chat.conversationHistory')}
        </Typography>
      )}

      {onToggleCollapse && (
        <Tooltip title={collapsed ? t('chat.expandNav') : t('chat.collapseNav')}>
          <IconButton
            size="small"
            aria-label={collapsed ? t('chat.expandNav') : t('chat.collapseNav')}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            <Iconify
              width={18}
              icon={collapsed ? 'eva:arrow-ios-forward-fill' : 'eva:arrow-ios-back-fill'}
            />
          </IconButton>
        </Tooltip>
      )}

      {onClose && (
        <Tooltip title={t('chat.closeHistory')}>
          <IconButton size="small" aria-label={t('chat.closeHistory')} onClick={onClose}>
            <Iconify icon="mingcute:close-line" width={18} />
          </IconButton>
        </Tooltip>
      )}

      {collapsed && (
        <Tooltip title={t('chat.newConversation')}>
          <IconButton size="small" aria-label={t('chat.newConversation')} onClick={onNew}>
            <Iconify icon="mingcute:add-line" width={18} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );

  const renderNotice = (message: string, error?: boolean) => (
    <Typography
      variant="caption"
      sx={{ display: 'block', px: 2.5, py: 0.75, color: error ? 'error.main' : 'text.secondary' }}
    >
      {message}
    </Typography>
  );

  return (
    <Box
      component="nav"
      data-slot="chat-nav"
      aria-label={t('chat.conversationHistory')}
      sx={(theme) => ({
        minHeight: 0,
        flexDirection: 'column',
        bgcolor: theme.vars.palette.background.neutral,
        ...(rail
          ? {
              flexShrink: 0,
              display: { xs: 'none', lg: 'flex' },
              width: collapsed ? CHAT_NAV_COLLAPSE_WIDTH : CHAT_NAV_WIDTH,
              borderRight: `solid 1px ${theme.vars.palette.divider}`,
              transition: theme.transitions.create(['width'], {
                duration: theme.transitions.duration.shorter,
              }),
            }
          : { display: 'flex', width: 1, height: 1 }),
      })}
    >
      {renderHeader()}

      {!collapsed && (
        <Box sx={{ px: 2.5, pb: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon="mingcute:add-line" width={18} />}
            onClick={onNew}
          >
            {t('chat.newConversation')}
          </Button>
        </Box>
      )}

      <Scrollbar sx={{ pb: 1.5 }}>
        {/* Notices are prose: at 96px there is nowhere to read them. */}
        {!collapsed && loadError && renderNotice(t('chat.historyLoadFailed'), true)}
        {!collapsed && !loadError && conversations.length === 0 && (
          renderNotice(t('chat.noConversations'))
        )}

        {!loadError && conversations.length > 0 && (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {conversations.map((conversation) => (
              <ChatNavItem
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                collapse={collapsed}
                onSelect={() => onSelect(conversation.id)}
                onDelete={() => onDelete(conversation.id)}
              />
            ))}
          </Box>
        )}
      </Scrollbar>
    </Box>
  );
}
