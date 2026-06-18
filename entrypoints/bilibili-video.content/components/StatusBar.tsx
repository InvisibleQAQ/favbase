import { t } from '@/lib/i18n';

interface StatusBarProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  subtitleCount: number;
  source?: 'bilibili' | 'groq';
  cached?: boolean;
}

export function StatusBar({
  loading,
  status,
  error,
  subtitleCount,
  source = 'bilibili',
  cached = false,
}: StatusBarProps) {
  if (loading) {
    return <div className="favbase-status favbase-status--loading">{t('status.loading')}</div>;
  }

  if (status === 'error') {
    return (
      <div className="favbase-status favbase-status--error">
        {t('status.error', { error: error ?? t('status.errorUnknown') })}
      </div>
    );
  }

  if (status === 'no_subtitle') {
    return <div className="favbase-status favbase-status--empty">{t('status.noSubtitle')}</div>;
  }

  if (status === 'ok') {
    if (source === 'groq') {
      const key = cached ? 'transcribe.cached' : 'transcribe.done';
      return (
        <div className="favbase-status favbase-status--ok">
          {t(key, { count: subtitleCount })}
        </div>
      );
    }

    return (
      <div className="favbase-status favbase-status--ok">
        {t('status.count', { count: subtitleCount })}
      </div>
    );
  }

  return null;
}
