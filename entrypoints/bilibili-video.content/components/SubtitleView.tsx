import type { SubtitleRow } from '@/lib/types';
import { t } from '@/lib/i18n';

interface SubtitleViewProps {
  rows: SubtitleRow[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Seek the bilibili video player to a specific time.
 * Accesses the <video> element in the host page (outside shadow DOM).
 */
function seekVideo(seconds: number): void {
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = seconds;
    video.play().catch(() => {
      // Autoplay may be blocked — that's fine, user can click play.
    });
  }
}

export function SubtitleView({ rows }: SubtitleViewProps) {
  if (rows.length === 0) return null;

  return (
    <div className="favbase-subtitle-list">
      {rows.map((row, i) => (
        <div key={i} className="favbase-subtitle-row">
          <button
            className="favbase-timestamp"
            type="button"
            onClick={() => seekVideo(row.start)}
            title={t('subtitle.jumpTo', { time: formatTime(row.start) })}
          >
            {formatTime(row.start)}
          </button>
          <span className="favbase-subtitle-text">{row.text}</span>
        </div>
      ))}
    </div>
  );
}
