import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';

import { initDbProxy } from '@/lib/database';
import { useTranslation } from '@/lib/i18n/use-translation';
import { addTagToPlatformItem, removeTagFromPlatformItem, type TagRef } from '@/lib/tagging';
import { BILI_PLATFORM } from './use-item-tags';

/**
 * Shared anchor state for the single popover instance each grid renders:
 * `open(platformItemId, anchor)` from a card's edit button, `close()` on dismiss.
 */
export function useTagEditState() {
  const [editing, setEditing] = useState<{
    platformItemId: string;
    anchorEl: HTMLElement;
  } | null>(null);

  const open = useCallback(
    (platformItemId: string, anchorEl: HTMLElement) => setEditing({ platformItemId, anchorEl }),
    [],
  );
  const close = useCallback(() => setEditing(null), []);

  return { editing, open, close };
}

interface TagEditPopoverProps {
  anchorEl: HTMLElement | null;
  platformItemId: string | null;
  tags: TagRef[];
  onClose: () => void;
  /** Called after a successful add/remove so the parent can refresh its tag data. */
  onChanged: () => void;
}

export function TagEditPopover({
  anchorEl,
  platformItemId,
  tags,
  onClose,
  onChanged,
}: TagEditPopoverProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setInput('');
    onClose();
  };

  const handleAdd = async () => {
    const name = input.trim();
    if (!name || !platformItemId || busy) return;
    setBusy(true);
    try {
      // Joins the in-flight init instead of racing getDb() on first click after page load.
      await initDbProxy();
      await addTagToPlatformItem(BILI_PLATFORM, platformItemId, name);
      setInput('');
      onChanged();
    } catch (err) {
      console.error('[tags] Failed to add tag:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (tagId: string) => {
    if (!platformItemId || busy) return;
    setBusy(true);
    try {
      await initDbProxy();
      await removeTagFromPlatformItem(BILI_PLATFORM, platformItemId, tagId);
      onChanged();
    } catch (err) {
      console.error('[tags] Failed to remove tag:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={Boolean(anchorEl && platformItemId)}
      anchorEl={anchorEl}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 1.5, width: 260 } } }}
    >
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              size="small"
              variant="outlined"
              disabled={busy}
              onDelete={() => void handleRemove(tag.id)}
            />
          ))}
        </Box>
      )}
      <TextField
        fullWidth
        autoFocus
        size="small"
        placeholder={t('tags.addPlaceholder')}
        value={input}
        disabled={busy}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void handleAdd();
          }
        }}
      />
    </Popover>
  );
}
