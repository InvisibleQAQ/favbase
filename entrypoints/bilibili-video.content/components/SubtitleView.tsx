import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import { t } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';

interface SubtitleViewProps {
  rows: SubtitleRow[];
  source: SubtitleSource;
  cached: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function seekVideo(seconds: number): void {
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = seconds;
    video.play().catch(() => {});
  }
}

function findActiveIndex(rows: SubtitleRow[], time: number): number {
  if (rows.length === 0 || time < rows[0].start) return -1;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (rows[mid].start <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, term: string): ReactNode {
  const parts = text.split(new RegExp(`(${escapeRegex(term)})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i} className="favbase-highlight">{part}</mark> : part
  );
}

function getSourceLabel(source: SubtitleSource, cached: boolean): string {
  if (source === 'bilibili') return t('source.bilibili');
  return cached ? t('source.groqCached') : t('source.groq');
}

const USER_SCROLL_TIMEOUT = 4000;
const SEARCH_DEBOUNCE_MS = 100;

export function SubtitleView({ rows, source, cached }: SubtitleViewProps) {
  useTranslation();
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userScrolledRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollRef = useRef(false);

  const lowerTerm = debouncedTerm.toLowerCase();

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTerm(value), SEARCH_DEBOUNCE_MS);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setDebouncedTerm('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    userScrolledRef.current = true;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      userScrolledRef.current = false;
    }, USER_SCROLL_TIMEOUT);
  }, []);

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

  // Pause auto-scroll during search or user scroll
  useEffect(() => {
    if (activeIndex < 0 || userScrolledRef.current || lowerTerm) return;
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
  }, [activeIndex, lowerTerm]);

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

  rowRefs.current.length = rows.length;

  const hasVisibleRows = !lowerTerm || rows.some(r => r.text.toLowerCase().includes(lowerTerm));

  return (
    <div className="favbase-subtitle-list" ref={listRef}>
      <div className="favbase-search-toolbar">
        <div className="favbase-search-container">
          <input
            type="text"
            className="favbase-search-input"
            placeholder={t('search.placeholder')}
            value={searchTerm}
            onChange={handleSearchChange}
          />
          {searchTerm && (
            <button
              type="button"
              className="favbase-search-clear"
              onClick={clearSearch}
              aria-label={t('search.clear')}
            >
              ×
            </button>
          )}
        </div>
        <span className="favbase-source-badge">
          {getSourceLabel(source, cached)}
        </span>
      </div>

      {rows.map((row, i) => {
        const matches = !lowerTerm || row.text.toLowerCase().includes(lowerTerm);
        return (
          <div
            key={i}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={
              `favbase-subtitle-row${i === activeIndex ? ' favbase-subtitle-row--active' : ''}`
            }
            style={matches ? undefined : { display: 'none' }}
          >
            <button
              className="favbase-timestamp"
              type="button"
              onClick={() => seekVideo(row.start)}
              title={t('subtitle.jumpTo', { time: formatTime(row.start) })}
            >
              {formatTime(row.start)}
            </button>
            <span className="favbase-subtitle-text">
              {lowerTerm ? highlightText(row.text, debouncedTerm) : row.text}
            </span>
          </div>
        );
      })}

      {!hasVisibleRows && (
        <div className="favbase-search-empty">{t('search.noResults')}</div>
      )}
    </div>
  );
}
