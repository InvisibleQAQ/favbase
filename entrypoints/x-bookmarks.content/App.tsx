import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocaleKeys } from '@/lib/i18n';
import type { XSyncError } from '@/lib/x/x-messages';
import { useOnBookmarksPage } from './use-on-bookmarks-page';
import { useXFetch } from './use-x-fetch';

type TFn = (key: LocaleKeys, params?: Record<string, string | number>) => string;

function errorLabel(error: XSyncError | null, t: TFn): string {
  if (error?.kind === 'auth') {
    // Two different dead ends, two different exits: no-token → refresh the page
    // so the capture listener sees a request; rejected → the session is stale,
    // re-login to x.com.
    return error.reason === 'rejected' ? t('x.fab.authRejected') : t('x.fab.authError');
  }
  if (error?.kind === 'rate-limit') return t('x.rateLimitedNoReset');
  return t('x.fab.error');
}

export default function App() {
  const { t } = useTranslation();
  const onBookmarks = useOnBookmarksPage();
  const { phase, fetchedCount, result, error, start } = useXFetch();

  // Hooks above run unconditionally; the button only shows on /i/bookmarks.
  if (!onBookmarks) return null;

  const busy = phase === 'fetching';

  let label: string;
  if (phase === 'fetching') label = t('x.fab.progress', { count: fetchedCount });
  else if (phase === 'done') label = t('x.fab.done', { count: result?.inserted ?? 0 });
  else if (phase === 'error') label = errorLabel(error, t);
  else label = t('x.fab.fetch');

  return (
    <div className={`fb-x-fab fb-x-fab--${phase}`}>
      <button type="button" className="fb-x-fab__btn" onClick={start} disabled={busy}>
        <span className="fb-x-fab__logo">favbase</span>
        {busy && <span className="fb-x-fab__spinner" aria-hidden="true" />}
        <span className="fb-x-fab__label">{label}</span>
      </button>
    </div>
  );
}
