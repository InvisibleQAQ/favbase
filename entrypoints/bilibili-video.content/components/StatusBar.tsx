import { t } from '@/lib/i18n';

interface StatusBarProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
}

export function StatusBar({ loading, status, error }: StatusBarProps) {
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

  return null;
}
