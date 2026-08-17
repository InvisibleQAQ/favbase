import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import type { OpenAppPageRequest } from '@/lib/background/messages';
import { sendBackgroundMessage } from '@/lib/background/client';
import type { SummaryErrorCode, VideoSegment } from '@/lib/summary/types';
import type { UseSummaryReturn } from '../hooks/useSummary';
import { formatClock } from '@/lib/format';
import { seekVideo } from '../player';
import { Markdown } from './Markdown';

function openAppSettings() {
  const msg: OpenAppPageRequest = { type: 'OPEN_APP_PAGE', hash: '#/settings' };
  void sendBackgroundMessage(msg).catch((err) => {
    console.error('[favbase] failed to open app settings:', err);
  });
}

function translateError(
  code: SummaryErrorCode,
  params?: Record<string, string | number>,
): string {
  return t(`summaryError.${code}` as LocaleKeys, params);
}

function SegmentList({ segments }: { segments: VideoSegment[] }) {
  if (segments.length === 0) return null;

  return (
    <div className="favbase-summary-segments">
      <div className="favbase-summary-segments-title">{t('summary.chapters')}</div>
      {segments.map((segment, i) => (
        <button
          key={i}
          type="button"
          className="favbase-summary-segment"
          onClick={() => seekVideo(segment.start)}
          title={t('subtitle.jumpTo', { time: formatClock(segment.start) })}
        >
          <span className="favbase-summary-segment-time">{formatClock(segment.start)}</span>
          <span className="favbase-summary-segment-title">{segment.title}</span>
          {segment.type === 'ad' && (
            <span className="favbase-summary-segment-ad">{t('summary.adBadge')}</span>
          )}
        </button>
      ))}
    </div>
  );
}

interface SummaryViewProps {
  summary: UseSummaryReturn;
  hasSubtitle: boolean;
  hasLlmKey: boolean;
}

export function SummaryView({ summary, hasSubtitle, hasLlmKey }: SummaryViewProps) {
  useTranslation();
  const { generating, markdown, segments, model, createdAt, error, generate, regenerate, cancel } =
    summary;

  if (!hasSubtitle) {
    return <div className="favbase-summary-hint">{t('summary.needSubtitle')}</div>;
  }

  if (!hasLlmKey) {
    return (
      <div className="favbase-summary">
        <div className="favbase-summary-hint">{t('summary.noApiKey')}</div>
        <button className="favbase-settings-open-app" type="button" onClick={openAppSettings}>
          {t('panel.openSettings')}
        </button>
      </div>
    );
  }

  return (
    <div className="favbase-summary">
      {error && (
        <div className="favbase-summary-error">{translateError(error.code, error.params)}</div>
      )}

      {markdown && <Markdown text={markdown} />}

      {generating && (
        <div className="favbase-summary-status">
          <span className="favbase-summary-spinner" />
          <span>{t('summary.generating')}</span>
          <button type="button" className="favbase-transcribe-cancel" onClick={cancel}>
            {t('summary.cancel')}
          </button>
        </div>
      )}

      {!generating && <SegmentList segments={segments} />}

      {!generating && !markdown && (
        <button className="favbase-transcribe-btn" type="button" onClick={generate}>
          {error ? t('summary.retry') : t('summary.generate')}
        </button>
      )}

      {!generating && markdown && (
        <div className="favbase-summary-footer">
          <span className="favbase-summary-meta">
            {model}
            {createdAt > 0 && ` · ${formatDateTime(createdAt)}`}
          </span>
          <button type="button" className="favbase-summary-regenerate" onClick={regenerate}>
            {t('summary.regenerate')}
          </button>
        </div>
      )}
    </div>
  );
}
