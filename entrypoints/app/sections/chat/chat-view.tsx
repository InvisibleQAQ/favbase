import { useEffect, useRef, useState } from 'react';

import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

import { DashboardContent } from '../../layouts/dashboard';
import { Iconify } from '../../components/iconify';
import { useTranslation } from '@/lib/i18n/use-translation';
import { formatDateTime, type LocaleKeys } from '@/lib/i18n';
import {
  useChatAgent,
  type ChatDisplayMessage,
  type ConversationSummary,
  type ToolActivity,
} from './use-chat-agent';
import { SourceCards } from './source-card';
import { ChatMarkdown } from './chat-markdown';

type Translate = (key: LocaleKeys, params?: Record<string, string | number>) => string;
type ChatAgent = ReturnType<typeof useChatAgent>;

interface ChatWorkspaceProps {
  agent: ChatAgent;
}

/**
 * Chat view: multi-session knowledge-base assistant. Left rail lists persisted
 * conversations (new / switch / delete); right column drives the multi-step agent
 * via `useChatAgent`, streams the answer token-by-token, renders a four-state tool
 * activity line, and shows clickable source cards under each answer. Conversations
 * persist to PGlite (`chat_conversations`); a failed history load renders an error
 * caption in the rail instead of silently showing an empty list. Assistant answers
 * render through `<ChatMarkdown>` (react-markdown, no rehype-raw); user messages
 * stay plain text.
 * Below the `lg` breakpoint the rail hides and opens as a temporary left Drawer
 * from the history button in the title row (auto-closed if the viewport widens
 * past `lg`). Composer: Enter sends, Ctrl/⌘+Enter
 * and Shift+Enter insert a newline (Enter is ignored mid-IME composition).
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

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyDrawerRef = useRef<HTMLDivElement>(null);

  const theme = useTheme();
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));

  // Close the history drawer when the viewport widens past `lg`. Merely hiding
  // an open Modal via CSS (`display: none`) would strand the body scroll lock
  // and the focus trap with no visible way to dismiss them.
  useEffect(() => {
    if (isLgUp) setHistoryOpen(false);
  }, [isLgUp]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, toolActivity]);

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    send(input);
    setInput('');
  }

  const showEmptyState = messages.length === 0 && !isStreaming;

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
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{ minHeight: 40, mb: 1.5, flexShrink: 0 }}
      >
        <Box
          component="img"
          src="/icon/128.png"
          alt=""
          sx={{ width: 28, height: 28, flexShrink: 0 }}
        />
        <Typography id="chat-page-title" variant="h4" sx={{ flexGrow: 1 }}>
          {t('chat.title')}
        </Typography>
        <Tooltip title={t('chat.openHistory')}>
          <IconButton
            ref={historyTriggerRef}
            aria-label={t('chat.openHistory')}
            onClick={() => setHistoryOpen(true)}
            sx={{ display: { xs: 'inline-flex', lg: 'none' } }}
          >
            <Iconify icon="solar:chat-round-dots-bold" width={22} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Drawer
        anchor="left"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        ModalProps={{
          disableRestoreFocus: true,
          onTransitionExited: () => {
            // Runs before ModalManager hides the modal; release its focused descendant first.
            const activeElement = document.activeElement;
            if (
              activeElement instanceof HTMLElement &&
              historyDrawerRef.current?.contains(activeElement)
            ) {
              activeElement.blur();
            }
          },
        }}
        sx={{ display: { lg: 'none' }, zIndex: 'calc(var(--layout-nav-zIndex) + 1)' }}
        slotProps={{
          transition: {
            onExited: () => {
              // Slide calls this after ModalManager has removed #root's aria-hidden.
              if (!isLgUp) historyTriggerRef.current?.focus();
            },
          },
          paper: {
            ref: historyDrawerRef,
            sx: {
              left: { xs: 0, md: 'var(--layout-nav-vertical-width)' },
              width: 'min(320px, 92vw)',
              p: 0,
            },
          },
        }}
      >
        <ConversationRail
          conversations={conversations}
          activeId={activeConversationId}
          loadError={historyError}
          onClose={() => setHistoryOpen(false)}
          onNew={() => {
            newConversation();
            setHistoryOpen(false);
          }}
          onSelect={(id) => {
            switchConversation(id);
            setHistoryOpen(false);
          }}
          onDelete={deleteConversation}
          t={t}
        />
      </Drawer>

      <Paper
        component="section"
        aria-labelledby="chat-page-title"
        variant="outlined"
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '248px minmax(0, 1fr)' },
          flex: '1 1 auto',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          borderRadius: 2,
          borderColor: theme.vars.palette.divider,
          boxShadow: 'none',
        })}
      >
        <Box
          sx={(theme) => ({
            display: { xs: 'none', lg: 'flex' },
            minHeight: 0,
            minWidth: 0,
            borderRight: `1px solid ${theme.vars.palette.divider}`,
            bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.04),
          })}
        >
          <ConversationRail
            conversations={conversations}
            activeId={activeConversationId}
            loadError={historyError}
            onNew={newConversation}
            onSelect={switchConversation}
            onDelete={deleteConversation}
            t={t}
          />
        </Box>

        <Box sx={{ display: 'flex', minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
          {loading ? (
            <Stack
              spacing={1.5}
              alignItems="center"
              justifyContent="center"
              sx={{ flex: '1 1 auto', minHeight: 0 }}
            >
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">
                {t('chat.loading')}
              </Typography>
            </Stack>
          ) : !configured ? (
            <Box sx={{ width: 1, maxWidth: 880, mx: 'auto', p: { xs: 2, md: 3 } }}>
              <Alert severity="info">{t('chat.llmNotConfigured')}</Alert>
            </Box>
          ) : (
            <>
              <Box
                ref={scrollRef}
                role="log"
                aria-label={t('chat.messageHistory')}
                aria-busy={isStreaming}
                sx={{
                  display: 'flex',
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  px: { xs: 2, sm: 3, lg: 4 },
                  py: { xs: 2.5, md: 3 },
                }}
              >
                <Stack
                  spacing={{ xs: 2.5, md: 3 }}
                  sx={{ width: 1, maxWidth: 880, minHeight: '100%', mx: 'auto' }}
                >
                  {showEmptyState ? (
                    <Stack
                      spacing={1.5}
                      alignItems="center"
                      justifyContent="center"
                      sx={(theme) => ({
                        flex: '1 1 auto',
                        color: theme.vars.palette.text.secondary,
                        textAlign: 'center',
                      })}
                    >
                      <Box
                        component="img"
                        src="/icon/128.png"
                        alt=""
                        sx={{ width: 48, height: 48 }}
                      />
                      <Typography variant="body2" sx={{ maxWidth: 440 }}>
                        {t('chat.emptyHint')}
                      </Typography>
                    </Stack>
                  ) : (
                    messages.map((message) => <MessageBubble key={message.id} message={message} />)
                  )}

                  {isStreaming && (
                    <MessageBubble
                      message={{ id: 'streaming', role: 'assistant', content: streamingText }}
                      activityLabel={activityLabel(toolActivity, t)}
                      pending={streamingText.length === 0}
                    />
                  )}
                </Stack>
              </Box>

              {status === 'error' && (
                <Box sx={{ flexShrink: 0, px: { xs: 2, sm: 3, lg: 4 }, pt: 1.5 }}>
                  <Alert severity="error" sx={{ maxWidth: 880, mx: 'auto' }}>
                    {errorKind === 'network' ? t('chat.errorNetwork') : t('chat.errorGeneric')}
                  </Alert>
                </Box>
              )}

              <Box
                component="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSend();
                }}
                sx={(theme) => ({
                  flexShrink: 0,
                  borderTop: `1px solid ${theme.vars.palette.divider}`,
                  bgcolor: theme.vars.palette.background.paper,
                  px: { xs: 1.5, sm: 3, lg: 4 },
                  py: { xs: 1.5, md: 2 },
                })}
              >
                <Box sx={{ width: 1, maxWidth: 880, mx: 'auto' }}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={1}
                    maxRows={6}
                    slotProps={{ htmlInput: { 'aria-label': t('chat.composerLabel') } }}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t('chat.composerPlaceholder')}
                    disabled={isStreaming}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                      if (e.shiftKey) return;
                      e.preventDefault();
                      if (e.ctrlKey || e.metaKey) {
                        // Textarea only inserts a newline on plain Enter, so Ctrl/Cmd+Enter
                        // has to splice one in at the caret manually.
                        const el = e.target as HTMLTextAreaElement;
                        const start = el.selectionStart ?? input.length;
                        const end = el.selectionEnd ?? input.length;
                        setInput(input.slice(0, start) + '\n' + input.slice(end));
                        requestAnimationFrame(() => {
                          el.selectionStart = el.selectionEnd = start + 1;
                        });
                        return;
                      }
                      handleSend();
                    }}
                  />

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.25 }}>
                    {isStreaming ? (
                      <Button
                        type="button"
                        variant="outlined"
                        color="inherit"
                        onClick={stop}
                        startIcon={<Iconify icon="solar:stop-bold" width={17} />}
                      >
                        {t('chat.stop')}
                      </Button>
                    ) : (
                      <Button type="submit" variant="contained" disabled={!input.trim()}>
                        {t('chat.send')}
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Paper>
    </DashboardContent>
  );
}

interface ConversationRailProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  /** History failed to load from PGlite — show an error instead of an empty list. */
  loadError: boolean;
  onClose?: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  t: Translate;
}

function ConversationRail({
  conversations,
  activeId,
  loadError,
  onClose,
  onNew,
  onSelect,
  onDelete,
  t,
}: ConversationRailProps) {
  return (
    <Box
      component="nav"
      aria-label={t('chat.conversationHistory')}
      sx={{ display: 'flex', width: 1, height: 1, minHeight: 0, flexDirection: 'column' }}
    >
      <Box sx={{ flexShrink: 0, p: 1.5, pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {t('chat.conversationHistory')}
          </Typography>
          {onClose && (
            <Tooltip title={t('chat.closeHistory')}>
              <IconButton size="small" aria-label={t('chat.closeHistory')} onClick={onClose}>
                <Iconify icon="mingcute:close-line" width={18} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          startIcon={<Iconify icon="mingcute:add-line" width={18} />}
          onClick={onNew}
          sx={{ mt: 1.25 }}
        >
          {t('chat.newConversation')}
        </Button>
      </Box>

      <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', px: 1, pb: 1.5 }}>
        {loadError ? (
          <Typography
            variant="caption"
            sx={(theme) => ({
              display: 'block',
              px: 1,
              py: 0.75,
              color: theme.vars.palette.error.main,
            })}
          >
            {t('chat.historyLoadFailed')}
          </Typography>
        ) : conversations.length === 0 ? (
          <Typography
            variant="caption"
            sx={(theme) => ({
              display: 'block',
              px: 1,
              py: 0.75,
              color: theme.vars.palette.text.secondary,
            })}
          >
            {t('chat.noConversations')}
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                active={conv.id === activeId}
                onSelect={() => onSelect(conv.id)}
                onDelete={() => onDelete(conv.id)}
                t={t}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

interface ConversationRowProps {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  t: Translate;
}

function ConversationRow({ conversation, active, onSelect, onDelete, t }: ConversationRowProps) {
  const conversationLabel = conversation.title || t('chat.untitledConversation');

  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        p: 0.25,
        borderRadius: 1,
        transition: theme.transitions.create(['background-color']),
        ...(active
          ? { bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08) }
          : { '&:hover': { bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08) } }),
      })}
    >
      <ButtonBase
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        sx={(theme) => ({
          flexGrow: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          borderRadius: 0.75,
          px: 0.75,
          py: 0.625,
          textAlign: 'left',
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: 1,
          },
        })}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            noWrap
            sx={(theme) => ({
              fontWeight: active
                ? theme.typography.fontWeightSemiBold
                : theme.typography.fontWeightRegular,
              color: active ? theme.vars.palette.primary.main : theme.vars.palette.text.primary,
            })}
          >
            {conversationLabel}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={(theme) => ({ display: 'block', color: theme.vars.palette.text.secondary })}
          >
            {formatDateTime(conversation.updatedAt)}
          </Typography>
        </Box>
      </ButtonBase>
      <Tooltip title={t('chat.deleteConversation')}>
        <IconButton
          size="small"
          aria-label={`${t('chat.deleteConversation')}: ${conversationLabel}`}
          onClick={onDelete}
          sx={(theme) => ({ color: theme.vars.palette.text.secondary, flexShrink: 0 })}
        >
          <Iconify icon="solar:trash-bin-trash-bold" width={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function activityLabel(activity: ToolActivity | null, t: Translate): string | null {
  if (!activity) return null;
  if (activity.phase === 'output-error') return t('chat.toolError');
  switch (activity.kind) {
    case 'search':
      if (activity.phase === 'output-available') {
        return t('chat.toolSearched', { n: activity.count ?? 0 });
      }
      if (activity.phase === 'input-streaming') return t('chat.toolThinking');
      return t('chat.toolSearching');
    case 'read':
      return t('chat.toolReading');
    case 'listTags':
      return t('chat.toolListingTags');
    default:
      return null;
  }
}

interface MessageBubbleProps {
  message: ChatDisplayMessage;
  activityLabel?: string | null;
  pending?: boolean;
}

function MessageBubble({ message, activityLabel: activity, pending }: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  return (
    <Box
      component="article"
      aria-label={t(isUser ? 'chat.userMessage' : 'chat.assistantMessage')}
      sx={{ display: 'flex', minWidth: 0, justifyContent: isUser ? 'flex-end' : 'flex-start' }}
    >
      <Box
        sx={{
          display: 'flex',
          width: isUser ? 'auto' : 1,
          maxWidth: isUser ? { xs: '92%', sm: '76%' } : '100%',
          minWidth: 0,
          flexDirection: 'column',
        }}
      >
        {activity && (
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            aria-live="polite"
            sx={{ mb: 0.75 }}
          >
            {pending && <CircularProgress size={12} color="inherit" />}
            <Typography
              variant="caption"
              sx={(theme) => ({ color: theme.vars.palette.text.secondary })}
            >
              {activity}
            </Typography>
          </Stack>
        )}
        <Box
          sx={(theme) => ({
            // User messages stay plain text (pre-wrap preserves line breaks);
            // assistant messages are rendered via <ChatMarkdown> which owns its own spacing.
            ...(isUser
              ? {
                  px: 2,
                  py: 1.25,
                  borderRadius: 2,
                  whiteSpace: 'pre-wrap',
                  bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
                }
              : { px: 0, py: 0 }),
            wordBreak: 'break-word',
            color: theme.vars.palette.text.primary,
          })}
        >
          {isUser ? message.content : <ChatMarkdown>{message.content}</ChatMarkdown>}
          {pending && !activity && <CircularProgress size={14} color="inherit" />}
        </Box>
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourceCards sources={message.sources} />
        )}
      </Box>
    </Box>
  );
}
