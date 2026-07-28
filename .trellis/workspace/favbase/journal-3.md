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


## Session 133: Fix Defuddle Illegal invocation

**Date**: 2026-07-22
**Task**: Fix Defuddle Illegal invocation
**Branch**: `main`

### Summary

Fixed the linkedom virtual Window boundary so Defuddle never calls Chromium's branded host getComputedStyle; added the exact regression test, updated bookmark docs and Trellis quality guidance, and verified 448 tests, TypeScript, and the production build.

### Main Changes

- Isolated linkedom's virtual Window from Chromium's branded host `getComputedStyle` at document construction.
- Added a regression test that reproduces `TypeError: Illegal invocation` and guards against host API calls or mutation.
- Updated bookmark ownership docs and the inert HTML parsing quality contract.

### Git Commits

| Hash | Message |
|------|---------|
| `8bbf85b` | (see git log) |

### Testing

- [OK] 51 test files / 448 tests
- [OK] `tsc --noEmit`
- [OK] WXT production build

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 134: Bilibili embedding and tagging concurrency

**Date**: 2026-07-22
**Task**: Bilibili embedding and tagging concurrency
**Branch**: `main`

### Summary

Persist Bilibili transcript chunks before independently starting Embedding and Tagging; UI waits only for Embedding. Added concurrency, failure-isolation, and compatibility regression coverage and updated module and Trellis contracts.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `39720bd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 135: Add collection submenu icons

**Date**: 2026-07-23
**Task**: Add collection submenu icons
**Branch**: `main`

### Summary

Added offline-registered icons to every Collections sidebar child item and preserved existing nav behavior. Verified pnpm compile, targeted nav-active test, and full pnpm test.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `817dd30` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 136: Unify Collections page structure

**Date**: 2026-07-23
**Task**: Unify Collections page structure
**Branch**: `main`

### Summary

Unified the six Collections views around CollectionPageScaffold with consistent title, search, operations, categories, tags, optional secondary categories, and list ordering; added scaffold coverage and updated affected documentation.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `379abb9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 137: Converge Bilibili ingestion

**Date**: 2026-07-23
**Task**: Converge Bilibili ingestion
**Branch**: `main`

### Summary

Converged Bilibili folder and video persistence on ingestCollection; retained transcription as the content preparation step; added delayed-content replacement contracts and regression coverage.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d8fb9b3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 138: Fix sidebar Collections navigation

**Date**: 2026-07-24
**Task**: Fix sidebar Collections navigation
**Branch**: `main`

### Summary

Split pinned Collections sidebar into a /collections RouterLink and an independent accessible chevron toggle. Added happy-dom interaction regression coverage, updated layout docs, passed compile, 470 Vitest tests, and WXT production build.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1e6cdfb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 139: Bilibili favorites full and incremental sync

**Date**: 2026-07-24
**Task**: Bilibili favorites full and incremental sync
**Branch**: `main`

### Summary

Implemented full first sync, source-scoped incremental cutoff, paced pagination, progress UI, and regression coverage.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4a57d15` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 140: Bilibili route sync throttle

**Date**: 2026-07-24
**Task**: Bilibili route sync throttle
**Branch**: `main`

### Summary

Stopped Bilibili route mount from triggering all-folder pagination; retained explicit full/incremental sync and increased page jitter to 7-10 seconds with regression coverage.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3fa8cd4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 141: Collection analytics dashboard

**Date**: 2026-07-25
**Task**: Collection analytics dashboard
**Branch**: `main`

### Summary

Implemented read-only six-platform collection analytics Dashboard, aggregate single-tag drill-down, typed analytics queries, locale coverage, tests, and docs; verified test/compile/build and archived task 07-24-unified-processing-dashboard-progress.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cae62a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 142: Compact collection pipeline progress

**Date**: 2026-07-25
**Task**: Compact collection pipeline progress
**Branch**: `main`

### Summary

Added compact idle-visible pipeline progress to six Collection platform pages with DB-backed Processing Coverage, independent Embedding/Tagging lane observation, domain-event refresh, i18n, tests, and directory docs. Full Vitest, TypeScript compile, and production build passed; browser visual inspection remains unperformed in this environment.

### Main Changes

- Added one compact, idle-visible pipeline strip to all six platform Collection pages.
- Centralized DB-backed Processing Coverage and platform stage mapping.
- Added independent Embedding/Tagging lifecycle observation and domain-event refresh.
- Updated i18n, tests, code-spec, and directory CLAUDE.md documentation.

### Git Commits

| Hash | Message |
|------|---------|
| `5f6b396` | (see git log) |

### Testing

- [OK] Full Vitest: 72 files, 525 tests.
- [OK] TypeScript compile and production build.
- [OK] Final focused regression run: 2 files, 12 tests.
- [UNKNOWN] Browser visual inspection was unavailable.

### Status

[OK] **Completed**

### Next Steps

- Optional manual visual inspection on desktop/narrow and light/dark themes.


## Session 143: Collection pipeline progress controls

**Date**: 2026-07-26
**Task**: Collection pipeline progress controls
**Branch**: `main`

### Summary

Unified Fetch, Embed, and Tags progress plus cooperative pause and resume across six Collection platforms; added shared runtime controls, adapters, regression tests, and synchronized documentation.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `881eca9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 144: Daily first-open auto-sync for all platforms

**Date**: 2026-07-26
**Task**: Daily first-open auto-sync for all platforms
**Branch**: `main`

### Summary

Added platform-neutral daily auto-sync: on first app.html open each day (mount + visibilitychange, 30s throttle) all ready platforms auto-sync once. Per-platform daily gate reuses sources.lastFetchedAt (no new table/storage); unready platforms skip silently, become-ready-later back-fills on next visibility. New: daily-sync-gate.ts (pure gate), auto-sync-registry.ts (6-platform contract), use-daily-auto-sync.ts (coordinator on App.tsx). bookmarks/bilibili return [] (own async pipelines); X cooldown folded into probe; zhihu isSilentError swallows logged-out. trellis-implement -> trellis-check (all PASS) -> spec sinkage in platform-onboarding.md. 17/17 new tests, 573 assertions pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ad65ce7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 145: bilibili AI summary panel (worktree, rebased onto main)

**Date**: 2026-07-26
**Task**: bilibili AI summary panel (worktree, rebased onto main)
**Branch**: `main`

### Summary

在 B 站面板加 AI 总结 Tab：仿 Bilitato 的 prompt 工程与合并输出协议，一次流式 LLM 调用同时产出 Markdown 总结与章节分段(含广告标记)，章节时间由字幕行号映射而非模型生成。LLM 调用落在 background SW(MV3 CS 受宿主页 CORS 限制)，结果按 subtitleHash 缓存在 local:vs:。顺带去重三处既有重复：resolveLlmConfig 提到 lib/storage/resolve.ts、background job registry 抽取、formatClock 收敛到 lib/format.ts。trellis-check 抓出 job registry 陈旧 finish 注销后继任务的竞态与 isAbort 正则吞真实失败两个 bug 并修复。工作在 worktree bilibili-summary 分支，已 rebase 到 main(0076d00)，86 文件 614 测试全绿。未做浏览器实测。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `48de223` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 146: Obsidian Markdown vault export

**Date**: 2026-07-26
**Task**: Obsidian Markdown vault export
**Branch**: `main`

### Summary

为收藏库新增「导出为 Obsidian vault」：每条 item 一个带 YAML frontmatter 的 .md，按 favbase/<平台 slug>/<收藏夹>/ 打包 ZIP。新增 lib/export/obsidian/{sanitize,query,serialize}.ts，UI 在 export-card 内分「数据库备份」与「Obsidian Vault」两区（不复用 format 枚举，避免 includeEmbedding 长出条件分支），busy 用 'backup'|'vault'|null 单值表达两者互斥。关键决策：多对多 item 只产出一个文件（复制成多份会让 Obsidian 视作两条独立笔记），目录归码位序第一的收藏夹、其余进 frontmatter sources；平台目录名与排序均不本地化，否则导出结构随 UI 语言变；YAML 标量无条件加引号，仅日期与白名单清洗后的 tag 裸写；主线程 zipSync 不上 Worker（MV3 CSP 拦 blob: worker）。Obsidian 文件名/tag 硬约束经实测调研落在 research/obsidian-export-conventions.md。新增 64 条测试（query 层用真 in-memory PGlite + runMigrations）。代码在 worktree C:/tmp/favbase-obsidian-export 分支 feat/obsidian-export，已 rebase 到 969e04b，全量 91 文件 682 测试与 tsc 均通过；未合入 main。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `082dc00` | (see git log) |
| `9bbd707` | (see git log) |
| `20a9905` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 147: Chat Agentic RAG 知识库助手（app.html，只读 PGlite）

**Date**: 2026-07-26
**Task**: Chat Agentic RAG 知识库助手（app.html，只读 PGlite）
**Branch**: `main`

### Summary

app.html 新增与 Collections 平行的 Chat 一级页面：客户端多步 tool-calling agent（AI SDK v6 streamText + stepCountIs(8)），全程只读 PGlite。Hybrid 检索（语义 semanticSearchChunks + trigram word_similarity + RRF）、3 只读工具、token 流式、工具四态、可点来源卡片（开 originalUrl）、多会话持久化（WXT storage）、react-markdown 渲染（无 rehype-raw）。5 阶段各一 trellis-implement 子代理 + 两次 trellis-check（P1-4 + P5 补审），只读/i18n PASS，全量测试绿。并行 obsidian 导出 WIP 被外部进程清除（非本次提交造成，i18n 混杂文件已 hunk 级分离只提交 chat）。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `969e04b` | (see git log) |
| `a76c39e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 148: Pause ASR on Groq quota exhaustion

**Date**: 2026-07-26
**Task**: Pause ASR on Groq quota exhaustion
**Branch**: `main`

### Summary

Added Groq daily quota guidance and quota-exhaustion detection; pause Bilibili auto transcription with a persisted provider-scoped reset guard while independent embed/tag lanes continue; merged verified changes into main as 7ebd56d.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `67ae02d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## Session 149: settings 页给账号连接/通用/存储各加左侧二级 rail

**Date**: 2026-07-26
**Task**: settings 页给账号连接/通用/存储各加左侧二级 rail
**Branch**: `main`

### Summary

将 AI 专用的 AiConfigNav 泛化为通用 SectionRail<T>，四个设置 tab 共用；账号连接 GitHub/YouTube 从上下堆叠拆成两个 rail 区段，通用/存储各加单项 rail；新增本地 RailLayout 消除 4× Grid 样板。顶部胶囊 Tab 保留（用户先选聚合方案、实现后纠正为每 tab 各加 rail）。i18n 全复用现有 key 零新增。合并进 main 为 60ae343。

### Main Changes

- `entrypoints/app/sections/settings/section-rail.tsx`：AiConfigNav → 泛型 SectionRail<T>（四 tab 共用，rename 保留 75% 相似度）
- `entrypoints/app/sections/settings/settings-view.tsx`：保留顶部 Tab，每 tab 套 RailLayout（左 md:3 rail + 右 md:9 内容）；账号连接拆 github/youtube 区段
- `entrypoints/app/sections/settings/CLAUDE.md`：同步导航结构

### Git Commits

| Hash | Message |
|------|---------|
| `60ae343` | feat(settings): 账号连接/通用/存储 tab 各加左侧二级 rail |

### Testing

- [OK] `tsc --noEmit`：exit 0
- [OK] vitest（i18n-no-hardcoded + settings dir）：13 passed

### Status

[OK] **Completed**

### Next Steps

- 通用/存储 rail 当前各单项，后续加区段直接扩 rail items 数组


## Session 150: WebDAV 配置同步第一期提交并合进 main

**Date**: 2026-07-26
**Task**: WebDAV 配置同步第一期提交并合进 main
**Branch**: `feat/welcome-onboarding`

### Summary

验证 worktree webdav-sync 第一期(配置 LWW 同步)健康(compile+758 测试全过)后，提交为 0dec527(只含 lib/sync/ + 7 接线文件，不含 welcome)。经 stash→ff-merge→pop 合进 main，仅 keys.ts(可加性 key 合并)+pnpm-lock.yaml(重生成)两处冲突，其余自动合并。welcome 在制品由用户另提交为 421568a 在 feat/welcome-onboarding 分支。数据同步(主键并集+embedding)留二三期。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0dec527` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 151: 首装引导页 welcome.html（滚动叙事 + 平台多选 → app.html）

**Date**: 2026-07-26
**Task**: 首装引导页 welcome.html（滚动叙事 + 平台多选 → app.html）
**Branch**: `feat/welcome-onboarding`

### Summary

新增 WXT unlisted page entrypoints/welcome/，用户第一次安装时由 background onInstalled 弹出。叙事顺序：Hero（六平台图标绕本地数据库核心公转，纯 SVG/DOM 零图片）→ 滚动驱动能力跑马灯 → 三步 sticky 叠卡（收录收藏 → 整合为知识库 → Chat 提问）→ Chat 主功能流式作答演示 → B 站视频页 CS 面板演示（字幕/AI 总结双 tab）→ 六平台多选后进入 app.html。动画用 motion 12 仅进 welcome chunk。弹页闸门是 local:onboarding 记录而非 onInstalled reason；平台选择纯信息性不做 gating，只决定 CTA 落地路由。

### Main Changes

- `entrypoints/welcome/`（新，20 文件）：WXT unlisted page，目录内 `index.html` → 产物 `welcome.html`。`main.tsx` 复用 app 的 ThemeProvider + `global.css`，外层 `MotionConfig reducedMotion="user"`。`components/`（`motion-box` 唯一定义 MotionBox/MotionButtonBase、`fade-in`、`animated-text` 逐字滚动点亮、`magnet`、`orbit-core` Hero 主视觉、`section-shell`、`feature-list`）+ `sections/`（`top-bar` 复用 dashboard HeaderActions、`hero`、`capability-marquee` 滚动驱动、`how-it-works` sticky 叠卡、`chat-showcase`、`bilibili-showcase`、`platform-picker`）+ `landing.ts` 落地路由纯函数 + `use-onboarding-exit.ts`
- `lib/storage/{keys,ui-state,index}.ts`：新增 `local:onboarding` + `onboardingStorage`（`OnboardingState { completedAt, platforms }`），`CollectionPlatform` 从纯判别符模块取避免牵进 DB
- `lib/background/app-handlers.ts`：新增 `openWelcomePage()`（自带 onboarding 闸门）；抽出 `focusOrCreateTab(pageUrl, navigateTo?)` 合并与 `handleOpenAppPage` 的重复逻辑，顺带修掉前者漏掉的 `windows.update` 抬窗
- `entrypoints/background.ts`：`onInstalled` 增加 `details.reason === 'install'` 分支
- `entrypoints/app/collection-platform-registry.ts`：判别符改从 `@/lib/collections/platforms` 纯模块取——barrel 经 `collections-query` 会把 drizzle + `@/lib/database` 拖进静态图，而 welcome.html 根本不碰数据库（构建已验证 welcome chunk 仅依赖 wxt-html-plugins/browser/Button/Container/Stack）
- `lib/i18n/locales/{zh-CN,en}.ts`：约 100 个 `welcome.*` key 双语补齐（含 `welcome.picker.selected` 复数变体）
- `package.json`：新增 `motion` 12（framer-motion 现名），仅 code-split 进 welcome chunk（168KB），app.html 与 Content Script 不受影响
- 文档：新增 `entrypoints/welcome/CLAUDE.md`；同步根 / `lib/storage` / `lib/background` / `entrypoints/app` 四份 CLAUDE.md

**两个关键决定**

- 弹页闸门用 `local:onboarding` 记录而非 `onInstalled` 的 `reason`：unpacked 扩展每次 reload 都报 `'install'`，只看 reason 会在整个开发期反复弹标签页。顶栏「跳过引导」同样写记录
- 平台选择纯信息性、不做任何 gating，只决定 CTA 落地路由（需凭证 → `#/settings`，否则 → 该平台收藏页，零选择 → dashboard）。真做启用开关需横切 registry + nav + daily auto-sync 并给老用户迁移，属产品级改动，已明确排除

**参考输入**：`motion_prompts.md`（3D portfolio 落地页提示词）只取动画手法——渐变裁字、逐字滚动点亮、sticky 叠卡、magnet、marquee；图片全部丢弃，视觉改为纯 SVG/DOM 并对齐项目 MUI minimal 风格与明暗双主题。

**质量检查过程**：`/trellis-check` 抓出 4 个问题并全部修掉——(1) 特性清单在 chat/bilibili 两个 showcase 间 copy-paste 18 行（提成 `FeatureList`）；(2) `openWelcomePage` 漏 `windows.update` 抬窗且与 `handleOpenAppPage` 逻辑重复（合并为 `focusOrCreateTab`）；(3) 新函数零测试（补 28 例）；(4) `@/entrypoints/app/...` 是项目首个跨入口 import 形式、约定未记录（补进 `entrypoints/welcome/CLAUDE.md`）。

### Git Commits

| Hash | Message |
|------|---------|
| `421568a` | feat(welcome): 首装引导页（滚动叙事 + 平台多选 → app.html） |

### Testing

- [OK] `pnpm compile`（tsc --noEmit）：exit 0
- [OK] `npx vitest run --exclude "**/.claude/**" --exclude "**/node_modules/**"`：103 files / 788 tests passed（新增 28 例：`landing` 9 / `use-onboarding-exit` 6 / `use-typewriter` 6 / `app-handlers` 7）
- [OK] `pnpm build`：welcome.html + welcome chunk 168KB 正常产出；grep 确认 chunk 内无 drizzle/pglite（唯一 "pglite" 命中是文案 key `welcome.tags.pglite`）
- [NG] **视觉未验证**：需浏览器实机查看，本会话无浏览器工具（用户未安装 Claude in Chrome）

### Status

[OK] **Completed**（代码层面；视觉待实机确认）

### Next Steps

- 实机 `pnpm dev` 检查 welcome.html 视觉与动画——唯一未验证项
- 分支 `feat/welcome-onboarding` 待合并进 `main`
- `.claude/worktrees/webdav-sync/` 应移出仓库（放 `C:/tmp`）：vitest 扫到它会产生 97 个 transform 假失败，必须靠 `--exclude "**/.claude/**"` 绕开
- `.trellis/spec/` 仍为空——`/trellis-check` 的 spec 比对步骤目前无对象可执行
- 20 个 active task 积压（多个对应已发布功能），建议单独过一轮批量归档


## Session 152: 统一后台任务提醒的 sync 文案为「获取」

**Date**: 2026-07-26
**Task**: 统一后台任务提醒的 sync 文案为「获取」
**Branch**: `main`

### Summary

Header 提醒栏的 backgroundJobs.kind.sync 由「同步」改为「获取」，与各收藏页处理条 pipeline.fetch 对齐；删除零消费者死键 pipeline.sync；lib/i18n/CLAUDE.md 与 .trellis/spec/frontend/i18n-conventions.md 记下「同一操作只用一种说法」约定。

### Main Changes

- `lib/i18n/locales/zh-CN.ts` / `en.ts`：`backgroundJobs.kind.sync` 由 `同步`/`Sync` 改为 `获取`/`Fetch`。Header 提醒栏（`background-jobs-indicator.tsx` 的 tooltip）与各收藏页处理条（`pipeline.fetch`）指的是同一件事——从平台拉取收藏——此前两处用词不同，用户读到「B站收藏夹 · 同步」会以为是另一种操作。
- 同两文件删除 `pipeline.sync`（`同步`/`Sync`）：全仓零 `t('pipeline.sync')` 消费者的死键，正是第二种说法的来源，留着下一个人还会用错。
- `lib/i18n/CLAUDE.md` + `.trellis/spec/frontend/i18n-conventions.md`：记下契约——`backgroundJobs.kind.sync` 与 `pipeline.fetch` 文案必须一致，不得再引入第二个「同步」说法；spec 的 key 命名表补 `pipeline.*` / `backgroundJobs.*` 两行。

### Git Commits

| Hash | Message |
|------|---------|
| `adad77a` | fix(i18n): 后台任务提醒的 sync 文案统一为「获取」 |

### Testing

- [OK] `pnpm compile`（tsc --noEmit）通过——en.ts 的 `Record<LocaleKeys, string>` 保证两边删键同步
- [OK] `pnpm test` 全量：103 files / 788 tests 全过（含 `lib/i18n/index.test.ts` 与 `tests/i18n-no-hardcoded.test.ts` CJK 守卫）
- 备注：首次全量跑时 `lib/bilibili/transcribe-utils.test.ts` 有 2 个失败（超时 + 事件泄漏到相邻用例），单独跑该文件 6/6 通过，复跑全量也全绿——并行下的既有 flake，与本次纯文案改动无关，但确实存在，值得单独查

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 153: 统一六平台获取按钮 + 知识库构建闸门（born-paused）

**Date**: 2026-07-27
**Task**: 统一六平台获取按钮 + 知识库构建闸门（born-paused）
**Branch**: `main`

### Summary

per-platform 持久闸门（local:library-gate + setJobGate DI + born-paused 派发，绝不 started:false 防 startBatchLane/wakeLane 递归）；六平台统一「立即获取」+ strip 尾部暂停/继续构建知识库按钮，段级暂停控件与平台启停面板下线；获取后自动接续转录/提取（知情推翻 5a04c87 与 quota ADR，spec 同步反转）；bilibili auto-transcribe 收进 startJob 模块级单例（切路由不中断、quota guard 竞态修复、次日 daily auto-sync 自然重评）。105 测试文件/820 用例全绿。待跟进：embedding 静默跳过诊断（tag 启动 embed 不启动，等环境事实）

### Main Changes

- 闸门核心：`lib/storage`（`local:library-gate` 存暂停平台列表，`[]`=默认全运行）+ `hooks/library-gate.ts`（模块镜像 + useSyncExternalStore + jobPlatform 映射 + 5-kind fan-out 下沉 `applyPaused`，跨 context watch 同路径）+ `pipeline-run-control.ts`（`initialPhase` + checkpoint 守卫翻转 `=== 'running'`）+ `background-jobs-store.ts`（`setJobGate` DI，born-paused 仍 `started:true`）
- UI：`CollectionPageScaffold` 持有 strip 外包 flex 行 + `LibraryGateButton`（新 `components/library-gate/`，智能组件保住 collection 目录零 t() 铁律）；`SectionTitleBar` 加 `syncDisabledTooltip`；7 处 scaffold 调用点统一 `pipeline.fetchNow/fetching`；段级 `PipelineSegmentControl`/`readRuntimeControl`/`pipelineControlLabels` 全删；i18n 删 14 增 5
- 自动接续：bookmarks sync 末尾恢复 `startBookmarkExtraction()`（推翻 5a04c87）+ extract runner 接 checkpoint；bilibili 新 `auto-transcribe-runtime.ts` 模块级单例经 `startJob('bilibili','transcribe')`（与手动路径 kind 复用：observation vs ownership + settled 重派发 + isActive 防重），`start()` 先 await 持久 quota guard（竞态修复）；`auto-sync-registry` 两平台 sync 后动态 import 链内容阶段
- spec：`state-management.md` 两节知情反转、`processing-queue.md` 新增 Library Gate Scenario（含 started:false 递归禁令）、13 个 CLAUDE.md 同步

### Git Commits

| Hash | Message |
|------|---------|
| `5686571` | feat(app): 知识库构建 per-platform 持久闸门（born-paused 派发） |
| `4eee9c5` | feat(app): 六平台统一「立即获取」+ 闸门开关，段级暂停控件下线 |
| `8afa71d` | feat(app): 获取后自动接续内容管线；bilibili 转录收进 startJob |
| `530909a` | docs: CLAUDE.md 全量同步（闸门/统一按钮/自动接续） |

### Testing

- [OK] `pnpm test`: Test Files 105 passed / Tests 820 passed（含 i18n CJK 守卫、born-paused 无递归、跨 context fan-out、quota guard 竞态、checkpoint 暂停续跑）
- [OK] `pnpm compile`: tsc 零错误（zh/en locale parity 类型校验）
- [OK] trellis-check 全量交叉核查通过，抓修 1 个真实缺口（applyPaused 跨 context 不联动现役 run）

### Status

[OK] **Completed**

### Next Steps

- 待跟进（独立小任务）：embedding 静默跳过诊断——tag 启动但 embed 不启动，根因二选一（embedding key 未配置 `config.enabled=!!apiKey` / `contentState!=='chunked'`），等用户提供环境事实；候选修法 = strip 显式「未配置」态


## Session 154: bilibili 转录全夹自动接续（对齐 bookmarks 提取）

**Date**: 2026-07-27
**Task**: 07-27-bilibili-transcribe-auto-continue-parity-with-bookmarks（已归档 archive/2026-07/）
**Branch**: `main`（经 worktree 分支 `feat/bili-transcribe-auto-continue` fast-forward 合入）

### Summary

消除 bilibili 转录两个不对称：挂载不接续存量 pending、单夹批次。startBiliAutoTranscribe 改收有序夹列表，派发前 listFoldersWithPending 本地 DB 过滤（稳态零 job 零网络），runner 串行逐夹跑 pipeline，quota_paused/cancelled 中断；三条链（挂载/立即获取/每日 auto-sync）全部全夹覆盖，born-paused 闸门语义不变。新增 8 测试用例 + 3 CLAUDE.md 同步，833 测试全绿。

### Main Changes

- `lib/bilibili/bili-sync-service.ts` — 新增 `listFoldersWithPending(mediaIds)`：sources ⋈ item_sources ⋈ items 单查询（双侧 platform 过滤），返回保持输入顺序的含 pending 夹子集，零网络
- `entrypoints/app/sections/bilibili/auto-transcribe-runtime.ts` — `startBiliAutoTranscribe(folderIds: readonly string[])`：initDbProxy → 过滤 → 空则不派发；runner 串行逐夹 `pipeline.start`，quota_paused/cancelled 中断剩余夹；`started:false` 重派发保留
- `entrypoints/app/sections/bilibili/use-bili-fav-folders.ts` — `orderFolderIds`（路由夹置前）；mount effect 成功后新增挂载接续链；sync 链改全夹
- `entrypoints/app/hooks/auto-sync-registry.ts`、`use-auto-transcribe.ts` — 调用点同步（每日 auto-sync 传全夹列表）
- 新测试：`auto-transcribe-runtime.test.ts`（6 例：零派发/查询失败/active 短路/串行+checkpoint/quota/cancelled）、`list-folders-with-pending.test.ts`（in-memory PGlite：顺序保持/platform-scoping/distinct 折叠）
- 文档：`entrypoints/app/sections/bilibili/CLAUDE.md`、`entrypoints/app/hooks/CLAUDE.md`、`lib/bilibili/CLAUDE.md`

### Git Commits

| Hash | Message |
|------|---------|
| `2466feb` | feat(app): bilibili 转录全夹自动接续（挂载/获取/每日同步三链，对齐 bookmarks 提取） |

### Testing

- [OK] `pnpm test`：107 文件 / 833 测试全绿（含 i18n 硬编码守卫）
- [OK] `pnpm compile`（tsc --noEmit）通过
- [OK] trellis-check 核查：startJob same-key 去重闭合 async 过滤竞态窗口、born-paused 铁律完好、StrictMode 双挂载无双 job、平台 scoping 有测试锁定

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 155: chat 页面 UI 优化：响应式会话列表 + logo + 回车发送

**Date**: 2026-07-26
**Task**: chat 页面 UI 优化：响应式会话列表 + logo + 回车发送
**Branch**: `main`

### Summary

chat-view.tsx：<md 时会话 rail 收进临时 Drawer（标题行历史按钮唤出，选中/新建/视口跨回 md+ 自动关闭防 Modal 滚动锁残留）；标题行 32px + 空态 56px 项目 logo（/icon/128.png）；composer 键位反转为 Enter 发送（IME isComposing 守卫）、Ctrl+Enter 光标插换行、Shift+Enter 默认换行；新增 chat.openHistory locale（zh/en）。tsc + 833 vitest 全绿，trellis-check 通过并自修 Drawer Modal 残留 bug。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e5f5234` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 156: 工具栏任务 badge（app 写 / SW 清道夫擦）

**Date**: 2026-07-27
**Task**: 工具栏任务 badge（app 写 / SW 清道夫擦）
**Branch**: `main`（feat/jobs-badge worktree rebase 后 ff 合入）

### Summary

浏览器工具栏图标 badge 实时显示运行中后台任务数：app.html 侧 use-jobs-badge hook 写 badge+悬停 title（复用 backgroundJobs.reminder，主题 warning 琥珀底色），SW 侧 jobs-badge 清道夫在 tabs.onRemoved/冷启动查无 app.html 页即擦除（sweep 排除正在关闭的 tabId 防竞态）。附带修 popup 脚手架残留 Default Popup Title。TDD 10 单测，843/843 全绿。

### Main Changes

- `entrypoints/app/hooks/use-jobs-badge.ts`（新增 + 单测）：`useRunningJobs().length` → `browser.action.setBadgeText`/`setTitle`/`setBadgeBackgroundColor`；0 清空；badge 底色 = 主题 `warning.main` `#FFAB00`（**非** MUI 默认 `#ED6C02`，theme-config.ts 有覆盖）；action 失败吞掉只 warn。挂 `DashboardLayout`（与提醒 Chip 同源同生命周期）
- `lib/background/jobs-badge.ts`（新增 + 单测）：SW 清道夫。badge 文本会话级持久而任务随页死 → `tabs.onRemoved` + SW 冷启动 `sweepJobsBadge()` 查无 app.html 标签页即擦 badge+title；`sweepJobsBadge(closedTabId)` 排除正在关闭的 tab（onRemoved 时 `tabs.query` 可能仍含它）。自家 chrome-extension:// URL 的 `tabs.query({url})` 免 `tabs` 权限（同 app-handlers 模式）
- 接线：`layouts/dashboard/layout.tsx` 挂 `useJobsBadge()`；`background.ts` 调 `initJobsBadgeJanitor()`。无新权限、无新消息类型（两 context 只通过 badge 状态通信）
- `popup/index.html`：`<title>Default Popup Title</title>` 脚手架残留 → `favbase`（它就是 manifest `default_title`，title 清空路径会回退到它）
- CLAUDE.md 同步：app/hooks、app/layouts、lib/background 三处
- 「点图标进 app.html」无需实现——popup 壳跳板本来就有

### Git Commits

| Hash | Message |
|------|---------|
| `4eef3a6` | feat(app): 工具栏图标 badge 显示运行中后台任务数（app 写 / SW 清道夫擦，防说谎 badge） |

### Testing

- [OK] TDD：新增 10 单测（use-jobs-badge.test.ts 3 + jobs-badge.test.ts 7）先红后绿
- [OK] rebase 到 e5f5234 后全量 `pnpm test` 843/843、`tsc --noEmit` 干净、`wxt build` 通过（manifest `action` 键确认）

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 157: Chat 会话历史迁入 PGlite 持久化

**Date**: 2026-07-26
**Task**: Chat 会话历史迁入 PGlite 持久化
**Branch**: `feat/chat-history-pglite`（worktree C:/tmp/favbase-chat-pglite，基于 4eef3a6）

### Summary

chat 多会话历史从 WXT local storage 迁到 PGlite：新表 chat_conversations（整会话 jsonb upsert）+ v005 迁移；history.ts 换 db 首参后端存全量、trimMessages 移到喂模型前；载入失败 rail 错误态；删 chatConversations 死 key；只读铁律收窄为表级边界（CONTEXT.md 词条 + ADR 0001）。844 测试 + tsc 绿，工作在 worktree feat/chat-history-pglite（74e01c6）待合并

### Main Changes

- **决策（PRD ADR-lite D1–D4）**：D1 动机=归属统一+备份 → 单表 jsonb 非归一化两表（无消费者的行级粒度是过度设计；EXPORT_TABLES 从 schema 派生，备份零改动自动覆盖）；D2 存全量、trim 移到喂模型前（trim 的存储动机随迁移死亡）；D3 无存量数据零迁移代码；D4 防说谎错误处理（载入失败显错误态、save 失败不打断已上屏回答）
- 新 entity `lib/database/entities/chat-conversations.ts`（uuid PK defaultRandom / title text / model_messages jsonb $type<ModelMessage[]> type-only import / timestamptz×2）+ schema.ts/types.ts（行类型 `ChatConversationRow` 避开 barrel 与 lib/chat 域类型撞名）
- `migrations/v005-chat-conversations.ts`：IF NOT EXISTS + 复用 v001 `update_updated_at_column()`；触发器幂等用 DROP IF EXISTS + CREATE（PG 无 CREATE TRIGGER IF NOT EXISTS）
- `lib/chat/history.ts` CRUD 换 PGlite 显式 `db` 首参（镜像 retrieval.ts，亦是 in-memory PGlite 测试前提）；`onConflictDoUpdate` excluded.* 三列，createdAt 不被覆盖；timestamptz ↔ ms 经 RPC Date 标记序列化安全
- `use-chat-agent.ts`：喂模型前 `trimMessages`（持久留全量）；mount 载入失败 `historyError` → rail 错误态（i18n `chat.historyLoadFailed` zh+en）；check 阶段修复粘滞 historyError（成功刷新必清错，`refreshConversations` 收敛为唯一列表刷新路径，顺带消除 delete 路径复制）
- 删 `STORAGE_KEYS.chatConversations` 死 key；5 个 CLAUDE.md + CONTEXT.md（Conversation 词条）+ `docs/adr/0001-chat-conversations-in-pglite.md` 同步

### Git Commits

| Hash | Message |
|------|---------|
| `74e01c6` | feat(chat): 会话历史迁入 PGlite（chat_conversations 整会话 jsonb，只读铁律收窄表级；存全量、喂模型时 trim） |

### Testing

- [OK] `pnpm test`（vitest run）109 files / 844 tests 全绿（含 history.test.ts 改真 in-memory PGlite：CRUD + save 不 trim 全量往返断言；export-schema-sync 零改动通过；i18n CJK 守卫绿）
- [OK] `pnpm compile`（tsc --noEmit）零错误
- [OK] trellis-check 全项通过：D1–D4 对照 / 迁移幂等 / upsert 语义 / timestamptz 往返 / 只读边界（chat_conversations 唯一写入方 history.ts）/ 文档一致性

### Status

[OK] **Completed**

### Next Steps

- 已快进合并 main（74e01c6）并清理 worktree 与分支——无遗留


## Session 158: Platform Request 外链入口（nav 叶子 + welcome 尾节）

**Date**: 2026-07-26
**Task**: Platform Request 外链入口（nav 叶子 + welcome 尾节）
**Branch**: `feat/platform-request-entry`（已 rebase 后 ff 合入 main）

### Summary

grill-with-docs 收敛四决策（预填 new-issue / 加号+外链箭头淡化叶 / 请求新平台术语 / welcome 页尾独立小节）。lib/repo.ts 单源仓库 URL；NavItem.external 外链叶子永不 active；welcome PlatformRequest 尾节；CONTEXT.md 新增 Platform Request 术语；platform-onboarding 契约补唯一外链叶条款。compile/test(844)/build 全绿。已 rebase 到 74e01c6 之上（CONTEXT.md 术语冲突两侧保留）ff 合入 main（99526f5），worktree 与分支已清理

### Main Changes

- `lib/repo.ts`（新）：`REPO_URL` + `PLATFORM_REQUEST_ISSUE_URL`（预填 new-issue），header-actions 改为 import，全库仓库 URL 单源
- `nav-config.tsx`：`NavItem.external?: true`；Collections children 末尾追加 Platform Request 外链叶（不进 collectionPlatformRegistry）
- `nav.tsx` NavChildLeaf：external 时渲染 `<a target="_blank" rel="noopener noreferrer">` + `text.disabled` 淡化 + 尾部 `eva:diagonal-arrow-right-up-fill` 箭头
- `icon-sets.ts`：离线注册 `eva:diagonal-arrow-right-up-fill`
- `entrypoints/welcome/sections/platform-request.tsx`（新）+ welcome-view 装配：页尾引导小节（outlined 按钮，不抢 picker 主 CTA）
- i18n：`nav.requestPlatform` + `welcome.request.*` 双语；`collection-platform-registry.test.ts` 新增「外链叶唯一且居末」不变量测试
- 文档：根/layouts/welcome/iconify 四处 CLAUDE.md、CONTEXT.md（Platform Request 术语）、platform-onboarding.md 契约

### Git Commits

| Hash | Message |
|------|---------|
| `99526f5` | feat(app): Collections 侧边栏与 welcome 尾节新增 Platform Request 外链入口 |

### Testing

- [OK] `pnpm compile` 零错
- [OK] `pnpm test` 109 文件 844 条全过（含更新后的 registry/nav 不变量测试与 i18n 守卫）
- [OK] `pnpm build` chrome-mv3 成功

### Status

[OK] **Completed**

### Next Steps

- None - 已合入 main（99526f5），worktree 已清理


## Session 159: fix(embedding): ghost chunked elimination + backlog embed lane

**Date**: 2026-07-26
**Task**: fix(embedding): ghost chunked elimination + backlog embed lane
**Branch**: `main`

### Summary

Root-caused zero-vector library: ingest declared 'chunked' in-tx while chunks were written outside the tx - interrupted runs mass-produced ghost items invisible to both the embed batch and settings rebuild. Fixed write order (has_content interim, chunked only after chunk rows land), added sync-time ghost self-heal (textOf -> plainText -> no_content; github refetches ghost READMEs via getReposNeedingReadme), replaced embedNewItems with embedPlatformBacklog (embed lane always dispatches and drains the platform chunked backlog; failures throw so the job shows failed), bookmarks sync dispatches the backlog lane too. Specs updated (processing-queue, database-bridge); 851 tests + tsc + build green.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ec588b5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- 用户重载扩展后跑一次「立即获取」验证：幽灵计数在 console、embed 覆盖开始推进、rebuild 不再误报 Nothing to rebuild


## Session 160: Bilibili streaming processing

**Date**: 2026-07-27
**Task**: Bilibili streaming processing
**Branch**: `main`

### Summary

Bilibili Favorites逐页持久化并流式驱动Transcript；缺ASR和quota可恢复等待；Embed/Tag保持独立lane；同时提交embedding provider串行/超时与durable统计刷新。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1906a02` | (see git log) |
| `75e018d` | (see git log) |
| `81fa054` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 161: Fix stalled collection embedding pipeline

**Date**: 2026-07-28
**Task**: Fix stalled collection embedding pipeline
**Branch**: `main`

### Summary

Removed the app-wide embedding promise FIFO, restored provider-owned batch concurrency, fixed resume-before-checkpoint lost wakeups, and released Bilibili transcription after durable content while observing late indexing results. Full compile, 860 tests, and production build passed.

### Main Changes

- Removed the module-level Embedding promise FIFO so independent platform lanes no longer head-of-line block each other.
- Restored provider-owned `embedMany` batch concurrency while retaining the 60-second request deadline.
- Fixed resume commands received during `pausing` so the next checkpoint cannot park forever.
- Released Bilibili Transcript after durable content and handled late Embedding settlement in coordinator state.

### Git Commits

| Hash | Message |
|------|---------|
| `7272119` | (see git log) |

### Testing

- [OK] `pnpm.cmd compile`
- [OK] `pnpm.cmd test` - 110 files, 860 tests
- [OK] `pnpm.cmd build`

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 162: Repair bookmark chunk persistence and embedding completion

**Date**: 2026-07-28
**Task**: Repair bookmark chunk persistence and embedding completion
**Branch**: `main`

### Summary

Added embedding pipeline diagnostics, identified zero-chunk false completion, repaired Bookmark stored-content ghosts without refetching, gated downstream enqueue on durable chunks, and propagated single-item embedding failures truthfully. Full tests, compile, and production build pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3331a50` | (see git log) |
| `5e80543` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 163: Fix shared PGlite chunk persistence

**Date**: 2026-07-28
**Task**: Fix shared PGlite chunk persistence
**Branch**: `main`

### Summary

Fixed cross-proxy PGlite transaction ownership so chunk writes survive commit, enforced strict durability and truthful Embedding failure semantics, added stored-content recovery and regression coverage, and captured the debugging contract in Trellis specs.

### Main Changes

- Reproduced cross-proxy transaction loss with two production RPC proxies over
  one handler and one real PGlite session: INSERT returning succeeded, a foreign
  rollback erased the transaction, and the later COMMIT resolved with no rows.
- Moved transaction ownership into the Offscreen handler with explicit
  transaction identities, Port ownership, dispatch deadlines, disconnect/stop
  rollback, and Port-scoped request correlation.
- Disabled relaxed IndexedDB durability, enforced exact chunk INSERT returning
  counts, and made missing chunks plus Provider/DB failures reject truthful
  Embedding jobs.
- Preserved stored-content Bookmark recovery so existing content-without-chunk
  rows can be rebuilt locally without refetching.
- Captured the durable-success and `job:completed` diagnostic contracts in the
  local Trellis database bridge, processing queue, and cross-layer specs.

### Git Commits

| Hash | Message |
|------|---------|
| `6ea9be3` | (see git log) |

### Testing

- [OK] Focused regression suite: 6 files, 72 tests
- [OK] Full Vitest suite: 113 files, 888 tests
- [OK] TypeScript `tsc --noEmit`
- [OK] Chrome MV3 production build
- [OK] `git diff --check`

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 164: README redesign and Chinese visual localization

**Date**: 2026-07-29
**Task**: README redesign and Chinese visual localization
**Branch**: `main`

### Summary

Redesigned the bilingual repository README, added English and Simplified Chinese hero/workflow SVG assets, preserved the Favbase mascot, and verified XML safety, responsive rendering, type-check, and the full test suite.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `594ec03` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
