import { useEffect, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { useTranslation } from '@/lib/i18n/use-translation';
import { DashboardContent } from '../../layouts/dashboard';
import { ChatHeader } from './chat-header';
import { ChatMessageInput } from './chat-message-input';
import { CHAT_READING_WIDTH, ChatMessageList } from './chat-message-list';
import { ChatNav } from './chat-nav';
import { ChatNavDrawer } from './chat-nav-drawer';
import { ChatLayout } from './layout';
import { useChatAgent } from './use-chat-agent';

type ChatAgent = ReturnType<typeof useChatAgent>;

interface ChatWorkspaceProps {
  agent: ChatAgent;
}

/**
 * Chat page: a multi-session knowledge-base assistant in Minimal's chat card
 * (`layout.tsx`) — conversation rail beside a header + message log + composer.
 * `ChatView` only wires `useChatAgent`; the controlled shell is `ChatWorkspace`.
 *
 * The rail is permanent at `lg+` and collapsible to icon width; below `lg` it
 * moves into a temporary Drawer opened from the header (auto-closed when the
 * viewport widens past `lg`, so its focus trap and scroll lock cannot be
 * stranded off-screen). Conversations persist to PGlite (`chat_conversations`);
 * a failed history load renders an error notice in the rail instead of silently
 * showing an empty list.
 */
export function ChatView() {
  return <ChatWorkspace agent={useChatAgent()} />;
}

export function ChatWorkspace({ agent }: ChatWorkspaceProps) {
  const { t } = useTranslation();
  const {
    messages,
    streamingText,
    toolActivity,
    status,
    errorKind,
    isStreaming,
    configured,
    loading,
    send,
    stop,
    conversations,
    historyError,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation,
  } = agent;

  const [historyOpen, setHistoryOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  const theme = useTheme();
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));

  // Close the history drawer when the viewport widens past `lg`. Merely hiding
  // an open Modal via CSS (`display: none`) would strand the body scroll lock
  // and the focus trap with no visible way to dismiss them.
  useEffect(() => {
    if (isLgUp) setHistoryOpen(false);
  }, [isLgUp]);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const activeTitle = activeConversation
    ? activeConversation.title || t('chat.untitledConversation')
    : null;

  const renderMain = () => {
    if (loading) {
      return (
        <Stack
          spacing={1.5}
          sx={{ alignItems: 'center', justifyContent: 'center', flex: '1 1 auto', minHeight: 0 }}
        >
          <CircularProgress size={24} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('chat.loading')}
          </Typography>
        </Stack>
      );
    }

    if (!configured) {
      return (
        <Box sx={{ width: 1, maxWidth: 880, mx: 'auto', p: { xs: 2, md: 3 } }}>
          <Alert severity="info">{t('chat.llmNotConfigured')}</Alert>
        </Box>
      );
    }

    return (
      <>
        <ChatMessageList
          messages={messages}
          streamingText={streamingText}
          toolActivity={toolActivity}
          isStreaming={isStreaming}
        />

        {status === 'error' && (
          <Box sx={{ flexShrink: 0, px: { xs: 2, sm: 3, lg: 4 }, pt: 1.5 }}>
            <Alert severity="error" sx={{ maxWidth: CHAT_READING_WIDTH, mx: 'auto' }}>
              {errorKind === 'network' ? t('chat.errorNetwork') : t('chat.errorGeneric')}
            </Alert>
          </Box>
        )}

        <ChatMessageInput isStreaming={isStreaming} onSend={send} onStop={stop} />
      </>
    );
  };

  return (
    <DashboardContent
      maxWidth="xl"
      sx={{
        height: {
          xs: 'calc(100dvh - var(--layout-header-mobile-height))',
          md: 'calc(100dvh - var(--layout-header-desktop-height))',
        },
        minHeight: 0,
        overflow: 'hidden',
        pb: { xs: 1.5, md: 2.5 },
      }}
    >
      <ChatLayout
        aria-labelledby="chat-page-title"
        slots={{
          nav: (
            <ChatNav
              variant="rail"
              conversations={conversations}
              activeId={activeConversationId}
              loadError={historyError}
              collapse={navCollapsed}
              onToggleCollapse={() => setNavCollapsed((prev) => !prev)}
              onNew={newConversation}
              onSelect={switchConversation}
              onDelete={deleteConversation}
            />
          ),
          header: (
            <ChatHeader
              conversationTitle={activeTitle}
              historyTriggerRef={historyTriggerRef}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          ),
          main: renderMain(),
        }}
      />

      <ChatNavDrawer
        open={historyOpen}
        triggerRef={historyTriggerRef}
        canRestoreFocus={!isLgUp}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        activeId={activeConversationId}
        loadError={historyError}
        onNew={() => {
          newConversation();
          setHistoryOpen(false);
        }}
        onSelect={(id) => {
          switchConversation(id);
          setHistoryOpen(false);
        }}
        onDelete={deleteConversation}
      />
    </DashboardContent>
  );
}
