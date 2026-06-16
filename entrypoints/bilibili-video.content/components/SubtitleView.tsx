import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Find the active subtitle index for a given playback time.
 * Returns the last row whose start <= currentTime, or -1 if none.
 */
function findActiveIndex(rows: SubtitleRow[], time: number): number {
  if (rows.length === 0 || time < rows[0].start) return -1;

  // Binary search: find the rightmost row with start <= time
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (rows[mid].start <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** Milliseconds after a user scroll before auto-scroll resumes. */
const USER_SCROLL_TIMEOUT = 4000;

export function SubtitleView({ rows }: SubtitleViewProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // --- User scroll intent tracking ---
  // When the user manually scrolls the subtitle list, we pause auto-scroll
  // so we don't yank the viewport away from where they're reading.
  const userScrolledRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the last scroll was programmatic (auto-scroll).
  const programmaticScrollRef = useRef(false);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      // This scroll event was triggered by our own scrollIntoView — ignore it.
      programmaticScrollRef.current = false;
      return;
    }
    userScrolledRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      userScrolledRef.current = false;
    }, USER_SCROLL_TIMEOUT);
  }, []);

  // --- Poll video currentTime ---
  useEffect(() => {
    if (rows.length === 0) return;

    const id = setInterval(() => {
      const video = document.querySelector('video');
      if (!video) return;
      const idx = findActiveIndex(rows, video.currentTime);
      setActiveIndex((prev) => (prev === idx ? prev : idx));
    }, 250);

    return () => clearInterval(id);
  }, [rows]);

  // --- Auto-scroll: center active row in scroll container ---
  useEffect(() => {
    if (activeIndex < 0 || userScrolledRef.current) return;
    const el = rowRefs.current[activeIndex];
    if (!el) return;
    const scrollParent = listRef.current?.closest('.favbase-panel-body') as HTMLElement | null;
    if (!scrollParent) return;

    programmaticScrollRef.current = true;
    const parentRect = scrollParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetTop = elRect.top - parentRect.top + scrollParent.scrollTop
      - scrollParent.clientHeight / 2 + el.clientHeight / 2;
    scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, [activeIndex]);

  // --- Attach scroll listener to the actual scrollable parent ---
  // The list div itself doesn't scroll; the parent .favbase-panel-body does.
  // Scroll events don't bubble, so we must listen on the real scroll container.
  useEffect(() => {
    const scrollParent = listRef.current?.closest('.favbase-panel-body') as HTMLElement | null;
    if (!scrollParent) return;

    scrollParent.addEventListener('scroll', handleScroll);
    return () => {
      scrollParent.removeEventListener('scroll', handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [handleScroll]);

  if (rows.length === 0) return null;

  // Reset refs array length when rows change.
  rowRefs.current.length = rows.length;

  return (
    <div
      className="favbase-subtitle-list"
      ref={listRef}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          ref={(el) => { rowRefs.current[i] = el; }}
          className={
            `favbase-subtitle-row${i === activeIndex ? ' favbase-subtitle-row--active' : ''}`
          }
        >
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
