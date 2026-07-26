import { useEffect, useRef, useState } from 'react';

import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
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

/**
 * Chat view: multi-session knowledge-base assistant. Left rail lists persisted
 * conversations (new / switch / delete); right column drives the multi-step agent
 * via `useChatAgent`, streams the answer token-by-token, renders a four-state tool
 * activity line, and shows clickable source cards under each answer. Conversations
 * persist to WXT storage (never PGlite). Assistant answers render through
 * `<ChatMarkdown>` (react-markdown, no rehype-raw); user messages stay plain text.
 */
export function ChatView() {
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
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation,
  } = useChatAgent();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

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
    <DashboardContent maxWidth="lg">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 4 } }}>
        {t('chat.title')}
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 3 }}>
          <ConversationRail
            conversations={conversations}
            activeId={activeConversationId}
            onNew={newConversation}
            onSelect={switchConversation}
            onDelete={deleteConversation}
            t={t}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 9 }}>
          <Card>
            <CardContent>
              {!loading && !configured ? (
                <Alert severity="info">{t('chat.llmNotConfigured')}</Alert>
              ) : (
                <Stack spacing={2}>
                  <Box
                    ref={scrollRef}
                    sx={{
                      maxHeight: 460,
                      minHeight: 200,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                    }}
                  >
                    {showEmptyState ? (
                      <Box
                        sx={(theme) => ({
                          m: 'auto',
                          color: theme.vars.palette.text.secondary,
                          textAlign: 'center',
                        })}
                      >
                        <Typography variant="body2">{t('chat.emptyHint')}</Typography>
                      </Box>
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
                  </Box>

                  {status === 'error' && (
                    <Alert severity="error">
                      {errorKind === 'network' ? t('chat.errorNetwork') : t('chat.errorGeneric')}
                    </Alert>
                  )}

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t('chat.composerPlaceholder')}
                    disabled={isStreaming}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    {isStreaming ? (
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={stop}
                        startIcon={<CircularProgress size={16} color="inherit" />}
                      >
                        {t('chat.stop')}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        onClick={handleSend}
                        disabled={!input.trim() || loading}
                      >
                        {t('chat.send')}
                      </Button>
                    )}
                  </Box>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}

interface ConversationRailProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  t: Translate;
}

function ConversationRail({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  t,
}: ConversationRailProps) {
  return (
    <Card sx={{ p: 1.5 }}>
      <Button
        fullWidth
        variant="outlined"
        color="inherit"
        startIcon={<Iconify icon="mingcute:add-line" width={18} />}
        onClick={onNew}
        sx={{ mb: 1.5 }}
      >
        {t('chat.newConversation')}
      </Button>

      {conversations.length === 0 ? (
        <Typography
          variant="caption"
          sx={(theme) => ({
            display: 'block',
            px: 1,
            py: 0.5,
            color: theme.vars.palette.text.disabled,
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
    </Card>
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
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        borderRadius: 1.5,
        pl: 1,
        pr: 0.5,
        transition: theme.transitions.create(['background-color']),
        ...(active
          ? { bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08) }
          : { '&:hover': { bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08) } }),
      })}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        sx={{ flexGrow: 1, minWidth: 0, py: 0.75, cursor: 'pointer' }}
      >
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
          {conversation.title || t('chat.untitledConversation')}
        </Typography>
        <Typography
          variant="caption"
          sx={(theme) => ({ color: theme.vars.palette.text.disabled })}
        >
          {formatDateTime(conversation.updatedAt)}
        </Typography>
      </Box>
      <IconButton
        size="small"
        aria-label={t('chat.deleteConversation')}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        sx={(theme) => ({ color: theme.vars.palette.text.disabled, flexShrink: 0 })}
      >
        <Iconify icon="solar:trash-bin-trash-bold" width={16} />
      </IconButton>
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
  const isUser = message.role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Box sx={{ maxWidth: '82%', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={(theme) => ({
            px: 2,
            py: 1.25,
            borderRadius: 2,
            // User messages stay plain text (pre-wrap preserves line breaks);
            // assistant messages are rendered via <ChatMarkdown> which owns its own spacing.
            ...(isUser && { whiteSpace: 'pre-wrap' }),
            wordBreak: 'break-word',
            bgcolor: isUser
              ? varAlpha(theme.vars.palette.primary.mainChannel, 0.12)
              : theme.vars.palette.background.neutral,
            color: theme.vars.palette.text.primary,
          })}
        >
          {activity && (
            <Typography
              variant="caption"
              sx={(theme) => ({
                display: 'block',
                mb: 0.5,
                color: theme.vars.palette.text.secondary,
              })}
            >
              {activity}
            </Typography>
          )}
          {isUser ? message.content : <ChatMarkdown>{message.content}</ChatMarkdown>}
          {pending && !activity && <CircularProgress size={14} sx={{ ml: 0.5 }} />}
        </Box>
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourceCards sources={message.sources} />
        )}
      </Box>
    </Box>
  );
}
