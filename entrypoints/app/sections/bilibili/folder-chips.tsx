import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, CollapsibleChipRow } from '../../components/collection';
import type { BiliFavFolder } from '@/lib/bilibili/types';

interface FolderChipsProps {
  folders: BiliFavFolder[];
  selectedId: number | undefined;
  loading: boolean;
  onSelect: (folderId: number) => void;
}

export function FolderChips({ folders, selectedId, loading, onSelect }: FolderChipsProps) {
  const { t } = useTranslation();
  const icon = (
    <Iconify icon="solar:videocamera-record-bold-duotone" width={20} />
  );

  if (loading) {
    return (
      <ChipRowShell icon={icon} title={t('collections.foldersTitle')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" width={96} height={32} />
        ))}
      </ChipRowShell>
    );
  }

  if (folders.length === 0) {
    return (
      <ChipRowShell icon={icon} title={t('collections.foldersTitle')}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('collections.noFolders')}
        </Typography>
      </ChipRowShell>
    );
  }

  return (
    <CollapsibleChipRow
      icon={icon}
      title={t('collections.foldersTitle')}
      items={folders}
      getKey={(folder) => String(folder.id)}
      getLabel={(folder) => folder.title}
      selected={selectedId == null ? null : String(selectedId)}
      onSelect={(key) => key != null && onSelect(Number(key))}
      showMoreLabel={(n) => t('collections.showMoreFolders', { n })}
      showLessLabel={t('collections.showLessFolders')}
    />
  );
}
