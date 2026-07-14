import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
import type { BookmarkFolderRef } from '@/lib/bookmarks/bookmarks-sync-service';

interface FolderChipsProps {
  folders: BookmarkFolderRef[];
  /** Whole-library count, shown on the "All" chip. */
  totalCount: number;
  /** Selected folder node id; undefined = "All". */
  selectedId: string | undefined;
  onSelect: (folderId: string | undefined) => void;
}

/** Folder filter row: an "All" chip + one chip per folder (title, no per-folder
 *  count — mirrors bilibili's name-only folder chips). */
export function FolderChips({ folders, totalCount, selectedId, onSelect }: FolderChipsProps) {
  const { t } = useTranslation();

  return (
    <ChipRowShell
      icon={
        <Iconify
          icon="solar:folder-with-files-bold-duotone"
          width={20}
          sx={{ color: 'primary.main' }}
        />
      }
      title={t('bookmarks.foldersTitle')}
    >
      <FilterChip
        label={t('bookmarks.allFolders', { count: totalCount })}
        selected={!selectedId}
        onClick={() => onSelect(undefined)}
      />
      {folders.map((folder) => (
        <FilterChip
          key={folder.folderId}
          label={folder.title}
          selected={folder.folderId === selectedId}
          onClick={() => onSelect(folder.folderId)}
          maxWidth={200}
        />
      ))}
    </ChipRowShell>
  );
}
