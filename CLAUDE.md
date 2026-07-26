# favbase

Turn your social media Favorites into a searchable knowledge base just with a local-first browser extension

## 技术栈

- **框架**: WXT 0.20.26 (Vite) + React 19 + TypeScript 5.9
- **架构**: Chrome MV3 (Service Worker + Content Script + Shadow DOM UI + Extension Page)
- **UI 框架**: MUI v7 (Extension Page) + 原生 CSS + `--fb-*` design tokens (Content Script Shadow DOM)；Chat 回答用 `react-markdown` + `remark-gfm` 渲染（无 rehype-raw，XSS 安全）
- **AI SDK**: Vercel AI SDK v6（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`）
- **存储**: WXT `storage.defineItem`（设置/缓存） + PGlite 0.5 + Drizzle ORM 0.45 + pgvector（知识库）
- **包管理**: pnpm

## 当前状态

MVP 阶段，首个功能：B站视频收藏夹知识库。未来会支持多个平台收藏夹, 集成更多知识库. 

## 入口点

WXT 入口点及运行时角色总览，详细结构见对应目录 `CLAUDE.md`（见下方[目录文档索引](#目录文档索引)）。

- `entrypoints/background.ts` — Background Service Worker（→ `lib/background/`）
- `entrypoints/bilibili-inject.content.ts` — B站视频页 Main World 脚本（`world:'MAIN'` → `lib/bilibili/inject/`）
- `entrypoints/bilibili-video.content/` — B站视频页 Content Script（Shadow DOM React UI，Isolated World）
- `entrypoints/app/` — Extension Page 主界面（`app.html`，MUI v7 Dashboard）
- `entrypoints/popup/` — Popup 跳板：打开/聚焦 app.html 标签页

## 关键文档
- 使用wxt框架进行开发, 必须使用 `context7 mcp`查询 wxt文档.
- `docs/03_favbase-prd.md` — 完整 PRD（知识库全功能）
- `docs/04_bilibili-transcription-spec.md` — B站视频转录功能实现规格
- `.trellis/` — Trellis 开发工作流配置

## 参考项目

- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato` — Bilitato 开源项目，B站视频 AI 助手，是视频转录功能的主要参考实现
- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\06_material-kit-react` — Material Kit React，MUI v7 Dashboard 模板，app.html UI 风格参考

## 目录文档索引

各模块的详细结构与约定已下沉到对应代码目录的 `CLAUDE.md`。改动某模块时，同步维护该目录的 `CLAUDE.md`（没有就建）。i18n 是唯一横切全局的例外，保留在本文件（见下方 [i18n](#i18n)）。

### Extension Page（app.html）
- `entrypoints/app/CLAUDE.md` — 主界面入口、Hash Router、路由结构
- `entrypoints/app/theme/CLAUDE.md` — MUI v7 主题系统（palette/typography/shadows/components）
- `entrypoints/app/layouts/CLAUDE.md` — 仪表盘布局系统 + 侧边栏 Pin/Unpin
- `entrypoints/app/components/iconify/CLAUDE.md` — Iconify 离线图标系统
- `entrypoints/app/components/collection/CLAUDE.md` — 平台 section 共享展示哑组件（StateBox/标题栏/搜索框/卡片网格+分页/chip 行外壳）
- `entrypoints/app/components/tags/CLAUDE.md` — 平台无关标签 UI 子系统（hooks + popover + 筛选 chips + render-prop 网格）
- `entrypoints/app/hooks/CLAUDE.md` — app.html 共享 hooks（useCollectionLibrary 平台无关收藏页状态机，github/x/zhihu/youtube 数据 hook 的底座）
- `entrypoints/app/utils/CLAUDE.md` — app.html 共享纯函数工具（formatDuration 时长格式化）
- `entrypoints/app/pages/CLAUDE.md` — 页面组件（lazy loaded）
- `entrypoints/app/sections/overview/CLAUDE.md` — 只读 Collection Analytics Dashboard（六平台构成、标签与平台原生维度）；数据导出工具仅由设置页消费
- `entrypoints/app/sections/settings/CLAUDE.md` — 设置页（AI 配置/账号连接/通用/存储 Tab）
- `entrypoints/app/sections/bilibili/CLAUDE.md` — B站收藏夹页（sidebar+grid）
- `entrypoints/app/sections/github-stars/CLAUDE.md` — GitHub Stars 收藏页（语言 chips + 仓库卡片 grid + 一键全量同步）
- `entrypoints/app/sections/bookmarks/CLAUDE.md` — 浏览器书签收藏页（文件夹 chips + 书签卡片 grid + 挂载自动同步，无同步按钮；同步后自动链式正文提取——单例 worker 路由切换不中断 + 进度 caption + 逐条 auto-embed/auto-tag）
- `entrypoints/app/sections/x/CLAUDE.md` — X（Twitter）书签收藏页（作者 chips + 推文卡片 grid + 手动同步按钮 + 未登录空态，凭据无 UI 半 D6）
- `entrypoints/app/sections/zhihu/CLAUDE.md` — 知乎收藏页（收藏夹 chips + 4 类型卡片 grid + 手动同步按钮 + 未登录空态，cookie 直读无 Connections 卡）
- `entrypoints/app/sections/youtube/CLAUDE.md` — YouTube 公开播放列表收藏页（播放列表 chips + 视频卡片 grid + 手动同步按钮 + 未配置空态，API key + 频道经 Connections 卡配置）
- `entrypoints/app/sections/chat/CLAUDE.md` — Chat 一级页面（Agentic RAG 知识库助手，只读 PGlite）：多步 tool-calling agent + 流式回答 + hybrid 检索 + 可点来源卡片 + 工具四态 + 多会话持久化（WXT storage）+ markdown 渲染

### B站视频页 Content Script
- `entrypoints/bilibili-video.content/CLAUDE.md` — 右侧栏面板 UI 挂载 + Shadow DOM 约定
- `entrypoints/bilibili-video.content/components/CLAUDE.md` — 面板子组件（字幕 / AI 总结 / 设置三 Tab + Markdown 渲染器）
- `entrypoints/bilibili-video.content/hooks/CLAUDE.md` — 字幕检测/获取/转录 hooks

### 平台领域（lib）
- `lib/ingest/CLAUDE.md` — 共享收藏收录管线（`ingestCollection` 五阶段 insert-only 事务骨架 + 两段式 content 写入，github/bookmarks/x/zhihu/youtube 五平台 sync-service 共用）
- `lib/bilibili/CLAUDE.md` — B站 API、字幕获取、领域同步服务
- `lib/bilibili/inject/CLAUDE.md` — Main World 注入状态机 + SPA 路由监控
- `lib/github/CLAUDE.md` — GitHub Star 收录领域（REST API + 新仓库差集串行拉 README + 同步/查询服务，insert-only，README markdown chunk）
- `lib/bookmarks/CLAUDE.md` — 浏览器书签收录领域（`chrome.bookmarks` 本地读取 + normalizeUrl 去重 + 同步/查询，insert-only，无远程凭证；内容提取管线：串行 fetch 书签网页（`<all_urls>` + `credentials:'omit'`）→ defuddle 转 Markdown → chunk 入库，pending→chunked/no_content）
- `lib/x/CLAUDE.md` — X（Twitter）书签收录领域（私有 GraphQL `Bookmarks` 操作 + webRequest 捕获认证 header + 防风控游标分页 + 同步/查询，insert-only，tweet 文本 chunk）
- `lib/zhihu/CLAUDE.md` — 知乎收藏收录领域（公开收藏夹 v4 API + cookie 直读认证 + 串行防限流分页 + 4 类型归一化 + turndown 转 Markdown + 同步/查询，insert-only，Markdown chunk）
- `lib/youtube/CLAUDE.md` — YouTube 公开播放列表收录领域（官方 Data API v3 `playlists.list?channelId=` + API key（无 OAuth，`@handle`/`UC...` ID 经 `channels.list` 解析）+ 全量重拉（位置序无增量游标）+ 多列表 membership（1 item + N link，镜像 zhihu）+ 同步/查询，insert-only，description chunk）

### 转录 / 后台
- `lib/subtitle/CLAUDE.md` — 通用字幕共享类型（平台无关）
- `lib/summary/CLAUDE.md` — AI 视频总结领域（字幕 → 一次流式 LLM 调用 → Markdown 总结 + 章节分段/广告标记；合并输出协议 + 行号映射时间戳，结果落 `local:vs:` storage 不入 DB；LLM 调用只能在 Background SW）
- `lib/transcription/CLAUDE.md` — 转录核心管线（cache → 官方字幕 → ASR）
- `lib/offscreen/CLAUDE.md` — Offscreen Document + FFmpeg 分块 + PGlite 持有者
- `lib/cache/CLAUDE.md` — 视频字幕缓存（平台感知）
- `lib/auto-transcribe/CLAUDE.md` — 自动转录状态机（平台无关）
- `lib/background/CLAUDE.md` — Background SW dispatcher + 消息桥 + CDN 请求头

### 数据库
- `lib/database/CLAUDE.md` — PGlite + Drizzle RPC Proxy 架构
- `lib/database/entities/CLAUDE.md` — Per-table Drizzle schema
- `lib/database/bridges/CLAUDE.md` — RPC 桥接层
- `lib/database/migrations/CLAUDE.md` — 自定义迁移系统

### 基础设施
- `lib/ai/CLAUDE.md` — Vercel AI SDK 集成（LLM + Embedding provider/client）+ Provider 定义（`lib/providers.ts`）
- `lib/chat/CLAUDE.md` — Chat（Agentic RAG 助手）平台无关 lib：`config.ts`（`resolveChatModel` 复用主 LLM）+ `retrieval.ts`/`rrf.ts`（hybrid：语义 `semanticSearchChunks` + trigram 关键词 word_similarity + RRF）+ `tools.ts`（3 只读工具）+ `agent.ts`（`streamText`+`stepCountIs(8)`）+ `prompts.ts` + `history.ts`（WXT storage 多会话），全程只读 PGlite
- `lib/permissions/CLAUDE.md` — 运行时 host 权限授权：自定义 API 域名的 CORS 解法（内置域名派生进静态 `host_permissions` + `optional_host_permissions` 运行时授权）
- `lib/sync/CLAUDE.md` — WebDAV 双向同步领域（第一期：配置整体 LWW 同步）：`webdav` 包客户端 + 跨设备锁（sys.json 超时夺锁）+ 内容哈希防 ping-pong + AES-GCM 凭据混淆 + `chrome.alarms` 后台三触发（周期/防抖/启动补偿），引擎只在 Background SW。数据（PGlite 主键并集）留第二/三期
- `lib/embedding/CLAUDE.md` — Embedding 领域层：pgvector 向量存储 + 语义检索 + chunker（字幕/文本）+ 配置解析（转录管线 + x/zhihu/youtube/github 同步收尾自动 embed + bookmarks 提取逐条自动 embed 已接线，语义搜索 UI 待接）
- `lib/events/CLAUDE.md` — 领域事件总线（DB 数据变更 → UI 实时刷新，app.html 单 context）
- `lib/tagging/CLAUDE.md` — AI 标签（转录/收藏同步后自动打标 + 标签 CRUD）
- `lib/export/CLAUDE.md` — PGlite 全量导出（JSON/CSV）
- `lib/hooks/CLAUDE.md` — 共享 Hooks（useSettings/useRetryCountdown）
- `lib/storage/CLAUDE.md` — 存储命名空间统一管理
- `lib/format.ts` — 跨 context 纯格式化（`formatClock`：秒 → `m:ss`/`h:mm:ss`），app.html 时长角标 / CS 面板时间戳 / summary prompt 共用，无 CLAUDE.md（单文件）

## i18n

- i18n 架构: `lib/i18n/` 自研轻量方案（无外部依赖），observable locale + `useSyncExternalStore`。`localeStorage`（`local:locale`，`lib/storage/ui-state.ts`）持久化用户偏好 `'auto' | 'zh-CN' | 'en'`（默认 `'auto'` 跟随 `navigator.language`）。`t()` 读可变 `currentMessages` 引用，DEV 模式对 missing key 输出 `console.warn`。React 消费者通过 `useTranslation()`（`lib/i18n/use-translation.ts`）订阅 locale 变化驱动 re-render，返回 `{ t, locale, preference, setLocale }`。`storage.watch()` 跨 context 同步（Content Script ↔ app.html）。有模块级 helper 的组件保留 `import { t } from '@/lib/i18n'` + 在组件内 `useTranslation()` 订阅；纯 JSX 组件用 `const { t } = useTranslation()`。locale 文件在 `lib/i18n/locales/{zh-CN,en}.ts`，`LocaleKeys` 类型从 zh-CN 推导。**seam 在 UI 边界**：lib 层只传结构化数据（TranscribeErrorCode + params / TranscribeStage + stageParams），UI 层通过 `t()` 翻译。新增 error/stage locale key 时需同时更新 zh-CN.ts 和 en.ts
- i18n 复数: `t(key, { count })` 传入 `count` 时用 `Intl.PluralRules(currentLocale).select(count)` 选变体 key `{key}.{category}`（如 `.one`/`.other`），缺失回退 `{key}.other`，再回退 base key。非 count 调用行为不变（向后兼容）。需单复数区分的 key 同时定义 base（=other 语义）+ `{key}.one` 变体，**zh 与 en 都要有 `.one`**（zh `.one` 与 base 同值，保持 parity 与类型安全）。已用：`collections.videoCount`、`autoTranscribe.pendingCount`、`bookmarks.count`
- i18n 数字格式化: `formatCompactNumber(n)`（`lib/i18n/index.ts`）用 `Intl.NumberFormat(currentLocale, { notation: 'compact', maximumFractionDigits: 1 })`，zh → `1.2万/1.2亿`，en → `1.2K/1.2M`。消费者须通过 `useTranslation()` 订阅以在切换语言时 re-render（如 `video-card.tsx` 播放量）
- i18n 日期格式化: `formatDateTime(ts)`（`lib/i18n/index.ts`）用 `Intl.DateTimeFormat(currentLocale, { dateStyle: 'short', timeStyle: 'short' })`。消费者同样须经 `useTranslation()` 订阅（如设置页 `save-actions.tsx` 已保存徽标）
- i18n 硬编码守卫: `tests/i18n-no-hardcoded.test.ts`（vitest，非 ESLint——项目零 linter）。扫描全部 `entrypoints/**/*.tsx`，剥离行/块注释后若含 CJK（`[一-鿿]`）即 fail 并列出 file:line。行内 `// i18n-ignore` 可豁免单行。**仅拦 CJK**（英文展示文案靠 review）。`pnpm test`（`vitest run`）跑全部测试
- Collection pipeline 的共享短标签统一放在 `pipeline.*`；视图翻译后传给零 `t()` 的共享 strip。
