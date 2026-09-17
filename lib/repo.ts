/**
 * Canonical project repository links — single source for every surface that
 * points at the repo (header GitHub button, nav Platform Request leaf,
 * welcome Platform Request section, welcome Agent Skills section).
 */
const REPO_SLUG = 'InvisibleQAQ/favbase';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/**
 * Agent Setup Guide (see CONTEXT.md and docs/adr/0005): the raw markdown a
 * user hands to their coding agent so it can install and pair the favbase CLI
 * on its own. Raw, not the blob page -- an agent fetching the blob URL gets
 * GitHub's HTML shell instead of the document.
 *
 * This URL is a PUBLIC CONTRACT: users paste it into their own prompts and
 * notes, so neither the `main` branch nor the `skills/favbase/INSTALL.md` path
 * can be moved without silently breaking them.
 */
export const AGENT_SETUP_GUIDE_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/main/skills/favbase/INSTALL.md`;

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
