import { useTranslation } from '@/lib/i18n/use-translation';

/** The collection page's chrome copy: the same on every platform, so the
 *  scaffold owns it instead of seven views passing it in. */
export interface CollectionChromeCopy {
  /** Title-bar Fetch button, idle. */
  syncLabel: string;
  /** Title-bar Fetch button, while syncing. */
  syncingLabel: string;
  /** `ErrorState` title for both the query-error and sync-error phases. */
  loadFailed: string;
  /** `ErrorState` retry button. */
  retry: string;
  /** Banner above a still-populated library; `error` is the view's mapped sync-error text. */
  syncFailed: (error: string) => string;
}

/**
 * The translated half of `CollectionPageScaffold` (docs/32 Step 6). The
 * scaffold lives in the zero-`t()` `components/collection/` layer, so it reads
 * this hook — and imports this file directly, never the `collection-states`
 * barrel, which would drag react-router, the settings route table and Iconify
 * into the scaffold's module graph. Depends on nothing but `useTranslation`.
 */
export function useCollectionChromeCopy(): CollectionChromeCopy {
  const { t } = useTranslation();
  return {
    syncLabel: t('pipeline.fetchNow'),
    syncingLabel: t('pipeline.fetching'),
    loadFailed: t('common.loadFailed'),
    retry: t('common.retry'),
    syncFailed: (error) => t('common.syncFailed', { error }),
  };
}
