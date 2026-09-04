import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CHAT_READING_WIDTH } from './chat-message-list';

interface ChatMessageInputProps {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * Composer: Minimal's 56px `InputBase` bar with the top divider, minus its
 * attachment / emoji / microphone buttons — those back no Favbase feature and
 * fake buttons are worse than none.
 *
 * Keyboard contract (unchanged): **Enter sends; Shift+Enter breaks the line;
 * Ctrl/⌘+Enter splices one in at the caret; Enter mid-IME-composition does
 * nothing.** Minimal's bar is fixed at 56px because it is single-line; ours
 * grows to six rows, so 56 is a floor.
 */
export function ChatMessageInput({ isStreaming, onSend, onStop }: ChatMessageInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  function handleSend() {
    if (!value.trim() || isStreaming) return;
    onSend(value);
    setValue('');
  }

  return (
    <Box
      component="form"
      data-slot="chat-input"
      onSubmit={(event) => {
        event.preventDefault();
        handleSend();
      }}
      sx={(theme) => ({
        flexShrink: 0,
        borderTop: `solid 1px ${theme.vars.palette.divider}`,
        bgcolor: theme.vars.palette.background.paper,
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: 1,
          minHeight: 56,
          maxWidth: CHAT_READING_WIDTH,
          mx: 'auto',
          px: { xs: 1.5, sm: 3, lg: 4 },
          py: 1,
        }}
      >
        <InputBase
          multiline
          maxRows={6}
          value={value}
          disabled={isStreaming}
          placeholder={t('chat.composerPlaceholder')}
          slotProps={{ input: { 'aria-label': t('chat.composerLabel') } }}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (event.shiftKey) return;
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
              // A textarea only inserts a newline on plain Enter, so Ctrl/Cmd+
              // Enter has to splice one in at the caret manually.
              const element = event.target as HTMLTextAreaElement;
              const start = element.selectionStart ?? value.length;
              const end = element.selectionEnd ?? value.length;
              setValue(value.slice(0, start) + '\n' + value.slice(end));
              requestAnimationFrame(() => {
                element.selectionStart = element.selectionEnd = start + 1;
              });
              return;
            }
            handleSend();
          }}
          sx={{ flexGrow: 1, minWidth: 0 }}
        />

        {isStreaming ? (
          <Button
            type="button"
            size="small"
            variant="outlined"
            color="inherit"
            onClick={onStop}
            startIcon={<Iconify icon="solar:stop-bold" width={17} />}
            sx={{ flexShrink: 0 }}
          >
            {t('chat.stop')}
          </Button>
        ) : (
          <Button
            type="submit"
            size="small"
            variant="contained"
            disabled={!value.trim()}
            sx={{ flexShrink: 0 }}
          >
            {t('chat.send')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
