# Revise bilingual README product messaging

## Goal

Present favbase as a released, actively evolving browser extension, with formal and consistent product language in the English and Simplified Chinese README files.

## Confirmed facts

- favbase currently supports Bilibili, GitHub, browser bookmarks, X, Zhihu, and YouTube.
- The current six sources are the present integration set, not a permanent product boundary; additional sources are planned.
- The product has been released.
- Installable extension builds are distributed through GitHub Releases.
- The repository remote is `https://github.com/InvisibleQAQ/favbase.git`.
- No repository release workflow or stable asset filename is available to document, so installation must link to the stable latest-release page rather than a guessed archive name.

## Requirements

1. Update `README.md` and `README_zh_CN.md` together and preserve their matching structure.
2. Remove wording that defines favbase as a six-platform product. Describe the listed sources as those currently supported and state that support will expand.
3. Replace casual, promotional, or development-only phrasing with concise, formal product documentation for end users.
4. Replace the source-build-only warning with a primary installation path through the latest GitHub Release.
5. Keep source-build instructions as a separate developer or advanced-user option.
6. Remove the claim that favbase is pre-release software while retaining an accurate active-development notice and data-backup guidance.
7. Do not claim browser-store availability or hard-code an unverified Release asset filename.

## Acceptance criteria

- Neither README says favbase is limited to six platforms or calls the product pre-release.
- Both READMEs state that the source list reflects current support and will expand.
- Both READMEs link to `https://github.com/InvisibleQAQ/favbase/releases/latest` as the primary build download location.
- Release installation steps explain downloading, extracting, and loading the provided Chromium build without inventing an asset name.
- Source build commands remain available and accurate.
- English and Chinese sections convey equivalent facts and use a formal, user-facing tone.
- Existing unrelated worktree changes remain untouched.

## Out of scope

- Creating or publishing a GitHub Release.
- Changing extension code, release automation, screenshots, or SVG assets.
- Claiming availability in a browser extension store.

## Open questions

None. The user explicitly requested implementation and supplied the relevant product-positioning decisions.
