import { t } from '@/lib/i18n';
import type { UseTranscribeReturn } from '../hooks/useTranscribe';

interface TranscribeButtonProps {
  transcribe: UseTranscribeReturn;
  hasApiKey: boolean;
}

export function TranscribeButton({ transcribe, hasApiKey }: TranscribeButtonProps) {
  const {
    transcribing,
    progress,
    stage,
    error,
    retryCountdown,
    startTranscribe,
    cancelTranscribe,
  } = transcribe;

  if (transcribing) {
    return (
      <div className="favbase-transcribe">
        <div className="favbase-transcribe-progress">
          <div
            className="favbase-transcribe-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="favbase-transcribe-info">
          <span className="favbase-transcribe-stage">{stage}</span>
          <span className="favbase-transcribe-percent">{progress}%</span>
        </div>
        <button
          type="button"
          className="favbase-transcribe-cancel"
          onClick={cancelTranscribe}
        >
          {t('transcribe.cancel')}
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="favbase-transcribe">
        <div className="favbase-transcribe-error">
          {error.message}
        </div>
        {retryCountdown > 0 ? (
          <div className="favbase-transcribe-countdown">
            {t('transcribe.rateLimit', { seconds: retryCountdown })}
          </div>
        ) : (
          <button
            type="button"
            className="favbase-transcribe-btn favbase-transcribe-btn--retry"
            onClick={startTranscribe}
            disabled={!hasApiKey}
          >
            {t('transcribe.retry')}
          </button>
        )}
      </div>
    );
  }

  if (!hasApiKey) {
    return (
      <div className="favbase-transcribe">
        <div className="favbase-transcribe-hint">
          {t('transcribe.noApiKey')}
        </div>
      </div>
    );
  }

  return (
    <div className="favbase-transcribe">
      <button
        type="button"
        className="favbase-transcribe-btn"
        onClick={startTranscribe}
      >
        {t('transcribe.button')}
      </button>
    </div>
  );
}
