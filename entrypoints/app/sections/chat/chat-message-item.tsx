import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import type { LocaleKeys } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { ChatMarkdown } from './chat-markdown';
import { SourceCards } from './source-card';
import type { ChatDisplayMessage, ToolActivity } from './use-chat-agent';

/** Minimal's bubble cap. Questions are short; answers are not — see below. */
const USER_BUBBLE_MAX_WIDTH = 320;

type Translate = (key: LocaleKeys, params?: Record<string, string | number>) => string;

interface ChatMessageItemProps {
  message: ChatDisplayMessage;
  /** Live tool state for the streaming turn; rendered above the bubble. */
  activity?: ToolActivity | null;
  pending?: boolean;
}

/**
 * One turn. The user question takes Minimal's bubble geometry (`p 1.5`,
 * `maxWidth 320`, `borderRadius 1`) washed with 16% brand.
 *
 * The assistant answer deliberately does **not** (user decision 2026-09-04,
 * docs/25 Step 9): it is markdown with tables, code blocks and source cards,
 * which 320px cannot hold, and `chat-markdown.tsx` already paints code on
 * `background.neutral` — a neutral bubble under it would swallow the code
 * block. Answers stay frameless across the reading track.
 */
export function ChatMessageItem({ message, activity, pending }: ChatMessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const activityText = activityLabel(activity ?? null, t);

  return (
    <Box
      component="article"
      aria-label={t(isUser ? 'chat.userMessage' : 'chat.assistantMessage')}
      data-role={isUser ? 'user' : 'assistant'}
      sx={{ display: 'flex', minWidth: 0, justifyContent: isUser ? 'flex-end' : 'flex-start' }}
    >
      <Box
        sx={{
          display: 'flex',
          minWidth: 0,
          flexDirection: 'column',
          width: isUser ? 'auto' : 1,
          maxWidth: isUser ? USER_BUBBLE_MAX_WIDTH : '100%',
        }}
      >
        {activityText && (
          <Stack
            direction="row"
            spacing={0.75}
            role="status"
            aria-live="polite"
            data-slot="tool-activity"
            sx={(theme) => ({
              alignItems: 'center',
              alignSelf: 'flex-start',
              minHeight: 30,
              mb: 1,
              px: 1,
              py: 0.375,
              borderRadius: 0.75,
              bgcolor: theme.vars.palette.background.neutral,
            })}
          >
            {pending && <CircularProgress size={12} color="inherit" />}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {activityText}
            </Typography>
          </Stack>
        )}

        <Box
          sx={(theme) => ({
            wordBreak: 'break-word',
            color: theme.vars.palette.text.primary,
            // User messages stay plain text (pre-wrap preserves line breaks);
            // assistant messages go through <ChatMarkdown>, which owns its own
            // spacing and needs the full track.
            ...(isUser && {
              p: 1.5,
              minWidth: 48,
              borderRadius: 1,
              typography: 'body2',
              whiteSpace: 'pre-wrap',
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
            }),
          })}
        >
          {isUser ? message.content : <ChatMarkdown>{message.content}</ChatMarkdown>}
          {pending && !activityText && <CircularProgress size={14} color="inherit" />}
        </Box>

        {!isUser && message.sources && message.sources.length > 0 && (
          <SourceCards sources={message.sources} />
        )}
      </Box>
    </Box>
  );
}

/** Tool four-state → the one line the user reads while the agent works. */
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
