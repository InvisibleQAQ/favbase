import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
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
    <ChipRowShell
      icon={
        <Iconify
          icon="solar:videocamera-record-bold-duotone"
          width={20}
          sx={{ color: 'primary.main' }}
        />
      }
      title={t('collections.sidebarTitle')}
    >
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" width={96} height={32} />
        ))
      ) : folders.length === 0 ? (
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {t('collections.noFolders')}
        </Typography>
      ) : (
        folders.map((folder) => (
          <FilterChip
            key={folder.id}
            label={folder.title}
            selected={folder.id === selectedId}
            onClick={() => onSelect(folder.id)}
            maxWidth={200}
          />
        ))
      )}
    </ChipRowShell>
  );
}
