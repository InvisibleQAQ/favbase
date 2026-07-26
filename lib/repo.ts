/**
 * Canonical project repository links — single source for every surface that
 * points at the repo (header GitHub button, nav Platform Request leaf,
 * welcome Platform Request section).
 */
export const REPO_URL = 'https://github.com/InvisibleQAQ/favbase';

/**
 * Platform Request (see CONTEXT.md): outbound action link to a prefilled
 * new-issue form, never a platform/route. Template is English on purpose —
 * it is the issue tracker's working language.
 */
export const PLATFORM_REQUEST_ISSUE_URL = `${REPO_URL}/issues/new?${new URLSearchParams({
  title: '[Platform Request] <platform name>',
  body: [
    '**Platform**: ',
    '',
    '**Favorites / bookmarks page URL**: ',
    '',
    '**What would you like collected**: ',
  ].join('\n'),
}).toString()}`;
