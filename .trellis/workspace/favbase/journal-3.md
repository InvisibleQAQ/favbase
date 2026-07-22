# Journal - favbase (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-07-19

---



## Session 120: docs/16 MEDIUM-4: extract shared charSplit chunker

**Date**: 2026-07-19
**Task**: docs/16 MEDIUM-4: extract shared charSplit chunker
**Branch**: `main`

### Summary

Collapsed the 3rd byte-identical char-soft-split chunker (zhihu/youtube/x) into a shared charSplit(text, { preferParagraph }) in lib/embedding/; deleted 3 chunker files + tests, merged suites into char-split.test.ts. trellis-check caught a HIGH regression I introduced: x-sync-service switched to the @/lib/embedding barrel (eager @/lib/storage side-effect) but runs in offscreen with no chrome.storage — fixed to leaf import. tsc + 352 tests green.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6203834` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 121: audit 16 MEDIUM-5: per-platform narrowMeta dedup

**Date**: 2026-07-19
**Task**: audit 16 MEDIUM-5: per-platform narrowMeta dedup
**Branch**: `main`

### Summary

四平台(github/x/zhihu/youtube)各从 sync-service 导出唯一 narrow{Platform}Meta，mapRow 与 section tagged-card 共用；删除 tagged-card 本地收窄(narrowMedia 归 x-sync-service 单份)，envelope fallback 经 fb 参数收敛。行为差异取更安全方向(x narrowMedia 过滤畸形/github typeof)，逐字段 fallback 语义精确保留。新增 4 份守护单测(18 例)。platform-onboarding spec 第4点更新禁止 card 再写 typeof 块。tsc + pnpm test 370 全绿。docs/16 HIGH/MEDIUM 全部完成，剩 LOW-7/8 观察项。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `74b8481` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 122: Auto-embed new items after collection sync for x/zhihu/youtube

**Date**: 2026-07-19
**Task**: Auto-embed new items after collection sync for x/zhihu/youtube
**Branch**: `main`

### Summary

Added embedNewItems (lib/embedding/indexing.ts) mirroring the tagNewItems post-sync fire-and-forget seam: only 'chunked' items (idempotent), serial pacing, never-throws, settings rebuild stays as backlog fallback. Wired into zhihu/youtube sync wrappers and x use-x-bookmarks syncFn; ingest pipeline untouched (D3 holds at pipeline level, offscreen-safe). 6 new PGlite tests, 376 total green, tsc clean, 7 CLAUDE.md updated. trellis-check passed with zero spec violations.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ea3771e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 123: GitHub star README content ingestion + auto-tag/embed wiring

**Date**: 2026-07-19
**Task**: GitHub star README content ingestion + auto-tag/embed wiring
**Branch**: `main`

### Summary

Inline README pipeline (zhihu-isomorphic): syncStars diffs star list against DB, serially fetches READMEs for new repos only (100ms pacing, tolerant degradation to no_content on any failure, head-truncation at 100k chars), persists via ingestCollection content channel with charSplit leaf import -> contentState 'chunked'. use-github-stars syncFn fires tagNewItems + embedNewItems (github joins x/zhihu/youtube seam). Dual-phase sync progress UI with i18n keys. 4 new PGlite guard tests; check pass fixed barrel->leaf import and stale docs. 380/380 tests green, tsc clean.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `644dc9c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 124: Bookmark page content extraction via defuddle to markdown

**Date**: 2026-07-19
**Task**: Bookmark page content extraction via defuddle to markdown
**Branch**: `main`

### Summary

bookmarks 平台内容管线落地：静态 <all_urls> 权限；新书签 contentState seam 翻为 pending；lib/bookmarks/bookmark-content.ts 纯层（credentials:omit/15s 超时/content-type 门/5MB 上限/charset 探测/defuddle-full 转 Markdown/200 字符阈值）+ bookmark-content-service.ts 串行队列 worker（永久失败 no_content、瞬时留 pending 自愈）；lib/ingest 抽共享 persistItemContent；UI 挂载自动提取（单例 store）+ 进度 caption + onItemExtracted 逐条喂 embedNewItems/tagNewItems；i18n 双语；411 测试全绿。check 修复 429 误判永久失败。spec 沉淀：platform-onboarding contentState 三形态 + database-bridge 异步提取队列契约。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f495084` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 125: backgroundJobs store: collection sync survives app.html route switches (ST1+ST2)

**Date**: 2026-07-20
**Task**: backgroundJobs store: collection sync survives app.html route switches (ST1+ST2)
**Branch**: `main`

### Summary

Introduced a module-level backgroundJobs singleton store (useSyncExternalStore) so collection-page sync state (progress/error) and its dedupe guard survive app.html route switches; refactored useCollectionLibrary to derive sync tri-state from useJob(logTag,'sync') with a generation completion signal; added an always-mounted global header 'don't close this page' reminder + zh/en i18n. ST1 (core store + zhihu tracer + 7 store unit tests) and ST2 (x/github/youtube verified, zero code changes) done and committed as 35af517, both archived. trellis-check passed a 9-area adversarial review with zero issues. Remaining under parent task 07-20-fix-collection-sync-state-lost-on-route-switch: ST3 (embed/tag full done/total progress + lib onProgress + zhihu/youtube trigger relocation), ST4 (bookmarks), ST5 (bilibili) — to be done in a new conversation. Checks green: pnpm test 430/430, compile clean, build clean. Browser-level runtime verification not performed.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `35af517` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 126: Surface per-job detail in global don't-close reminder tooltip

**Date**: 2026-07-21
**Task**: Surface per-job detail in global don't-close reminder tooltip
**Branch**: `main`

### Summary

Global background-jobs reminder showed only a count; surfaced per-job platform/kind/progress in the Chip tooltip. Store: cached runningSnapshot + getRunningJobs/useRunningJobs (ref-stable for useSyncExternalStore), dropped useRunningJobCount. Indicator: PLATFORM_LABEL (logTag->nav.* in UI layer, store stays platform-agnostic). i18n: backgroundJobs.kind.{sync,embed,tag,transcribe} zh/en parity. Retroactive Trellis task; trellis-check PASS (tsc clean + 8 tests); spec updated with useSyncExternalStore getSnapshot-stability gotcha (local-only). transcribe still indeterminate by design.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `34302b9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 127: Fix Defuddle malformed schema.org JSON-LD

**Date**: 2026-07-21
**Task**: Fix Defuddle malformed schema.org JSON-LD
**Branch**: `main`

### Summary

Validated and removed malformed application/ld+json nodes before Defuddle extraction; added regression coverage and updated bookmarks documentation.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `91f9aa3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 128: Fix bookmark HTML preload warnings

**Date**: 2026-07-21
**Task**: Fix bookmark HTML preload warnings
**Branch**: `main`

### Summary

Prevent detached bookmark HTML parsing from activating third-party preload/modulepreload hints; add regression coverage and update bookmark module documentation. Type-check and all 436 tests pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `be4ef26` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 129: Redesign bookmark extraction progress

**Date**: 2026-07-21
**Task**: Redesign bookmark extraction progress
**Branch**: `main`

### Summary

Replaced the bookmark extraction spinner with a theme-aware determinate/indeterminate progress panel, preserved i18n and dark-mode contracts, and verified TypeScript plus the full test suite.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0c153bf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 130: Bookmark extraction pause and resume

**Date**: 2026-07-22
**Task**: Bookmark extraction pause and resume
**Branch**: `main`

### Summary

Added cooperative pause, pausing, paused, and resume states for manual bookmark content extraction; preserved current-page progress metadata; verified compile and all 441 tests.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c67f2ac` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 131: Collapse secondary collection filters

**Date**: 2026-07-22
**Task**: Collapse secondary collection filters
**Branch**: `main`

### Summary

Unified all platform category and tag filter rows on the shared collapsible chip contract: default eight items, expand/collapse, and selected-item visibility; added tests, i18n, docs, and future platform onboarding guidance.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6b5740e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 132: Fix bookmark extraction resource-hint leakage

**Date**: 2026-07-22
**Task**: Fix bookmark extraction resource-hint leakage
**Branch**: `main`

### Summary

Moved arbitrary bookmark page fetches from app.html to the background service worker, retained inert DOM parsing, added boundary regression tests, and verified 447 tests plus MV3 production build.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8f5f308` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
