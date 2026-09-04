import { useEffect, useRef } from 'react';

import Stack from '@mui/material/Stack';

import { useTranslation } from '@/lib/i18n/use-translation';
import { EmptyContent } from '../../components/empty-content';
import { Scrollbar } from '../../components/scrollbar';
import { ChatMessageItem } from './chat-message-item';
import type { ChatDisplayMessage, ToolActivity } from './use-chat-agent';

/** Reading track shared by messages, the error alert and the composer. */
export const CHAT_READING_WIDTH = 760;

interface ChatMessageListProps {
  messages: ChatDisplayMessage[];
  streamingText: string;
  toolActivity: ToolActivity | null;
  isStreaming: boolean;
}

/**
 * The message log: a named live region that scrolls on its own and pins itself
 * to the bottom as tokens arrive. `Scrollbar` keeps the real overflow element,
 * so keyboard and screen-reader scrolling still work.
 */
export function ChatMessageList({
  messages,
  streamingText,
  toolActivity,
  isStreaming,
}: ChatMessageListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, toolActivity]);

  const showEmptyState = messages.length === 0 && !isStreaming;

  return (
    <Scrollbar
      ref={scrollRef}
      role="log"
      data-slot="chat-messages"
      aria-label={t('chat.messageHistory')}
      aria-busy={isStreaming}
      sx={{
        flex: '1 1 auto',
        minHeight: 0,
        overscrollBehavior: 'contain',
        px: { xs: 2, sm: 3, lg: 4 },
        py: { xs: 2.5, md: 3 },
      }}
    >
      <Stack
        spacing={{ xs: 2.5, md: 3 }}
        sx={{ width: 1, maxWidth: CHAT_READING_WIDTH, minHeight: '100%', mx: 'auto' }}
      >
        {showEmptyState ? (
          <EmptyContent
            imgUrl="/icon/128.png"
            description={t('chat.emptyHint')}
            slotProps={{ img: { sx: { width: 48, height: 48 } } }}
          />
        ) : (
          messages.map((message) => <ChatMessageItem key={message.id} message={message} />)
        )}

        {isStreaming && (
          <ChatMessageItem
            message={{ id: 'streaming', role: 'assistant', content: streamingText }}
            activity={toolActivity}
            pending={streamingText.length === 0}
          />
        )}
      </Stack>
    </Scrollbar>
  );
}
