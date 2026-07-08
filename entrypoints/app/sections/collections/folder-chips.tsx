import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { BiliFavFolder } from '@/lib/bilibili/types';

interface FolderChipsProps {
  folders: BiliFavFolder[];
  selectedId: number | undefined;
  loading: boolean;
  onSelect: (folderId: number) => void;
}

export function FolderChips({ folders, selectedId, loading, onSelect }: FolderChipsProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Iconify
          icon="solar:videocamera-record-bold-duotone"
          width={20}
          sx={{ color: 'primary.main' }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('collections.sidebarTitle')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" width={96} height={32} />
          ))
        ) : folders.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {t('collections.noFolders')}
          </Typography>
        ) : (
          folders.map((folder) => {
            const isSelected = folder.id === selectedId;
            return (
              <Chip
                key={folder.id}
                label={folder.title}
                clickable
                onClick={() => onSelect(folder.id)}
                color={isSelected ? 'primary' : 'default'}
                variant={isSelected ? 'filled' : 'outlined'}
                sx={{
                  maxWidth: 200,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
            );
          })
        )}
      </Box>
    </Box>
  );
}
