import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollapsibleChipRow } from '../../components/collection';
import type { PlaylistCount } from '@/lib/youtube/youtube-sync-service';

interface PlaylistChipsProps {
  playlists: PlaylistCount[];
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. Value is the playlist id. */
  selected: string | null;
  onSelect: (playlistId: string | null) => void;
}

function playlistLabel({ title, playlistId, count }: PlaylistCount): string {
  return `${title || playlistId} (${count})`;
}

/** Playlist filter row: an "All" chip + one chip per playlist (title + count,
 *  descending by video count — mirrors the zhihu collection chips), collapsed
 *  to the top N with a show-more/less toggle so a large set stays tidy. */
export function PlaylistChips({ playlists, totalCount, selected, onSelect }: PlaylistChipsProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleChipRow
      icon={<Iconify icon="mdi:youtube" width={20} />}
      title={t('youtube.playlistsTitle')}
      items={playlists}
      getKey={(p) => p.playlistId}
      getLabel={playlistLabel}
      allLabel={`${t('youtube.allPlaylists')} (${totalCount})`}
      selected={selected}
      onSelect={onSelect}
      showMoreLabel={(n) => t('youtube.showMorePlaylists', { n })}
      showLessLabel={t('youtube.showLessPlaylists')}
    />
  );
}
