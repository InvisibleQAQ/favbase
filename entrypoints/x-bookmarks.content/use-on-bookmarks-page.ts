import { useEffect, useState } from 'react';

const BOOKMARKS_PATH = '/i/bookmarks';

/**
 * Track whether the SPA is currently on the X bookmarks page. x.com is a client
 * -routed React SPA, so we react to WXT's `wxt:locationchange` (dispatched on
 * window) plus `popstate` rather than relying on the initial page load.
 */
export function useOnBookmarksPage(): boolean {
  const [onBookmarks, setOnBookmarks] = useState(
    () => location.pathname === BOOKMARKS_PATH,
  );

  useEffect(() => {
    const update = () => setOnBookmarks(location.pathname === BOOKMARKS_PATH);
    window.addEventListener('wxt:locationchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('wxt:locationchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  return onBookmarks;
}
