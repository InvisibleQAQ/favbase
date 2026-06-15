import { t } from '@/lib/i18n';

interface StatusBarProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  subtitleCount: number;
}

export function StatusBar({ loading, status, error, subtitleCount }: StatusBarProps) {
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
    return (
      <div className="favbase-status favbase-status--ok">
        {t('status.count', { count: subtitleCount })}
      </div>
    );
  }

  return null;
}
