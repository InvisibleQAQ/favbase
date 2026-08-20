# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: people who hoard favorites across Bilibili, X, Zhihu, GitHub, YouTube and the browser bookmark bar, Chinese-speaking first (UI ships zh-CN + en). Developers are a large share but not the only audience; non-developer knowledge workers, students and heavy media consumers are in scope, so language and density must not assume engineering literacy (confirmed 2026-08-20).

Situation: a few times a week, on desktop Chrome, they open the extension page (`app.html`) with one of two jobs: find something they saved ("that video / tweet / answer about X") or ask the library a question. Occasionally they run a sync, connect a new platform, or change an AI key. The Bilibili video page also carries an in-page panel for subtitles and AI summary.

## Product Purpose

favbase turns scattered social-media favorites into one searchable local knowledge base. It fetches the user's favorites, pulls the content behind them (video subtitles or ASR transcripts, tweet text, Zhihu answers and articles, README files, bookmarked web pages), chunks and embeds it, and lets the user search it or chat with it through an agentic RAG assistant. Success is the user finding the thing they half-remember saving, or getting an answer grounded in what they already collected.

## Positioning

The claim a neighbor cannot truthfully copy: **six platforms unified into one library** (confirmed 2026-08-20). Not a bookmark manager for one site, not a read-later queue: one search box, one chat, one tag system over everything the user favorited anywhere. Supporting facts: local-first (PGlite + pgvector inside the browser, no favbase server, data leaves the machine only to the user's own LLM/embedding endpoint and optional WebDAV); content-level ingestion (subtitles, full text, README), not just links.

## Operating Context

- Chrome MV3 extension; the main UI is an extension page with hash routing (`/`, `/collections`, `/collections/<platform>`, `/chat`, `/settings`), plus a first-run `welcome.html` and a popup that opens the page.
- Long-running background pipelines (fetch → extract → embed → tag → transcribe) run while the user browses elsewhere; the header shows unfinished jobs and a per-platform progress strip; the library can be paused/resumed.
- Data volumes are real: thousands of items per user (reference profile: 5,023 items across four platforms), paginated lists, per-platform folders/playlists/authors as filters.
- Credentials vary by platform: cookies (Bilibili, Zhihu), captured request headers (X), PAT (GitHub), API key (YouTube), none (bookmarks). AI features need a user-supplied LLM and embedding provider; the app must stay useful without them (keyword search, browsing).
- Two locales (zh-CN, en) with `auto` following the browser; light and dark color schemes with a header toggle; Windows Chrome is the reference environment.

## Capabilities and Constraints

- Platforms: Bilibili favorites, GitHub stars, browser bookmarks, X bookmarks, Zhihu favorites, YouTube public playlists. Adding a platform is a documented onboarding contract; the nav and aggregate page derive from one platform registry.
- Insert-only ingestion (unstar/unfavorite upstream does not delete locally). Tags are AI-generated after sync plus manual CRUD. Export to JSON/CSV/Obsidian vault. WebDAV config sync (phase 1).
- Chat is read-only over the local DB; tool calls and sources are shown.
- Technical constraints that shape UI: MV3 CSP (`script-src 'self'`) forbids inline scripts; fonts are self-hosted (`@fontsource-variable/dm-sans`, `@fontsource/barlow`); icons are offline-registered Iconify sets; no external image/CDN dependency for the shell itself (thumbnails come from platforms and can fail to load).
- Undecided product facts: per-item detail view inside the app (today cards open the original URL); sort/virtualized scrolling for the aggregate list; keyboard shortcuts.

## Brand Commitments

Binding for any visual work (confirmed 2026-08-20):
- The fox logo at `public/icon/128.png` (and the icon set it ships with) stays, with its own colors.
- Coral primary `#FC7E5B` stays as the brand hue. Its usage may change (it must not be used as small text on white; 2.5:1), its hue may not.
- Typeface pairing DM Sans Variable (UI) + Barlow (display) stays.
- Name written lowercase: `favbase`.

Not binding (replaceable): the material-kit-react / Minimal UI grey ramp, secondary/info/success/warning hues, shadows, radii, card language, dark-mode surfaces, layout chrome.

## Evidence on Hand

- Real data in the reference profile: 1,378 Bilibili videos, 778 bookmarks, 1,943 X bookmarks, 924 Zhihu items; GitHub and YouTube connected-empty. Use it for design decisions; do not invent metrics.
- Design audit with screenshots and detector runs: `docs/19_app-design-critique-2026-08-20.md`, snapshot in `.impeccable/critique/`.
- PRD: `docs/03_favbase-prd.md`. Platform onboarding contract: `.trellis/spec/frontend/platform-onboarding.md`. Current (to-be-replaced) design system record: `.trellis/spec/frontend/ui-design-system.md`.
- No testimonials, press, or customer logos exist; none may be fabricated.

## Product Principles

1. Finding beats managing: the shortest path is from opening the page to opening the saved thing; status and configuration never stand between them.
2. One library, six sources: platform identity is metadata on an item, not a different UI per platform.
3. Useful without AI keys: browsing, filtering and keyword search must feel complete before any provider is configured; AI adds depth, it is not the gate.
4. Honest about work in progress: long pipelines are visible, pausable and never alarming; numbers shown to the user agree with each other.
5. Local and private by construction: nothing in the UI implies a cloud account, and every outbound endpoint is one the user configured.

## Accessibility & Inclusion

Two written languages with very different glyph density (CJK vs Latin) share every layout. Keyboard and screen-reader use must work for the primary path (browse, filter, open, chat): meaningful headings, named controls, visible focus, WCAG AA contrast in both color schemes. No product-specific legal standard has been set.
