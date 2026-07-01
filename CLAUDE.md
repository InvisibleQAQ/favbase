# favbase

Turn your social media Favorites into a searchable knowledge base just with a local-first browser extension

## 技术栈

- **框架**: WXT 0.20.26 (Vite) + React 19 + TypeScript 5.9
- **架构**: Chrome MV3 (Service Worker + Content Script + Shadow DOM UI + Extension Page)
- **UI 框架**: MUI v7 (Extension Page) + 原生 CSS + `--fb-*` design tokens (Content Script Shadow DOM)
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
- `entrypoints/app/pages/CLAUDE.md` — 页面组件（lazy loaded）
- `entrypoints/app/sections/overview/CLAUDE.md` — Dashboard 概览卡片 + 数据导出 UI
- `entrypoints/app/sections/settings/CLAUDE.md` — 设置页（AI 配置/通用/存储 Tab）
- `entrypoints/app/sections/collections/CLAUDE.md` — B站收藏夹页（sidebar+grid）

### B站视频页 Content Script
- `entrypoints/bilibili-video.content/CLAUDE.md` — 右侧栏面板 UI 挂载 + Shadow DOM 约定
- `entrypoints/bilibili-video.content/components/CLAUDE.md` — 面板子组件
- `entrypoints/bilibili-video.content/hooks/CLAUDE.md` — 字幕检测/获取/转录 hooks

### B站领域（lib）
- `lib/bilibili/CLAUDE.md` — B站 API、字幕获取、领域同步服务
- `lib/bilibili/inject/CLAUDE.md` — Main World 注入状态机 + SPA 路由监控

### 转录 / 后台
- `lib/subtitle/CLAUDE.md` — 通用字幕共享类型（平台无关）
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
- `lib/ai/CLAUDE.md` — Vercel AI SDK 集成 + Provider 定义（`lib/providers.ts`）
- `lib/export/CLAUDE.md` — PGlite 全量导出（JSON/CSV）
- `lib/hooks/CLAUDE.md` — 共享 Hooks（useSettings/useRetryCountdown）
- `lib/storage/CLAUDE.md` — 存储命名空间统一管理

## i18n

- i18n 架构: `lib/i18n/` 自研轻量方案（无外部依赖），observable locale + `useSyncExternalStore`。`localeStorage`（`local:locale`，`lib/storage/ui-state.ts`）持久化用户偏好 `'auto' | 'zh-CN' | 'en'`（默认 `'auto'` 跟随 `navigator.language`）。`t()` 读可变 `currentMessages` 引用，DEV 模式对 missing key 输出 `console.warn`。React 消费者通过 `useTranslation()`（`lib/i18n/use-translation.ts`）订阅 locale 变化驱动 re-render，返回 `{ t, locale, preference, setLocale }`。`storage.watch()` 跨 context 同步（Content Script ↔ app.html）。有模块级 helper 的组件保留 `import { t } from '@/lib/i18n'` + 在组件内 `useTranslation()` 订阅；纯 JSX 组件用 `const { t } = useTranslation()`。locale 文件在 `lib/i18n/locales/{zh-CN,en}.ts`，`LocaleKeys` 类型从 zh-CN 推导。**seam 在 UI 边界**：lib 层只传结构化数据（TranscribeErrorCode + params / TranscribeStage + stageParams），UI 层通过 `t()` 翻译。新增 error/stage locale key 时需同时更新 zh-CN.ts 和 en.ts
- i18n 复数: `t(key, { count })` 传入 `count` 时用 `Intl.PluralRules(currentLocale).select(count)` 选变体 key `{key}.{category}`（如 `.one`/`.other`），缺失回退 `{key}.other`，再回退 base key。非 count 调用行为不变（向后兼容）。需单复数区分的 key 同时定义 base（=other 语义）+ `{key}.one` 变体，**zh 与 en 都要有 `.one`**（zh `.one` 与 base 同值，保持 parity 与类型安全）。已用：`collections.videoCount`、`autoTranscribe.pendingCount`
- i18n 数字格式化: `formatCompactNumber(n)`（`lib/i18n/index.ts`）用 `Intl.NumberFormat(currentLocale, { notation: 'compact', maximumFractionDigits: 1 })`，zh → `1.2万/1.2亿`，en → `1.2K/1.2M`。消费者须通过 `useTranslation()` 订阅以在切换语言时 re-render（如 `video-card.tsx` 播放量）
- i18n 硬编码守卫: `tests/i18n-no-hardcoded.test.ts`（vitest，非 ESLint——项目零 linter）。扫描 `entrypoints/**/*.tsx`，剥离行/块注释后若含 CJK（`[一-鿿]`）即 fail 并列出 file:line。行内 `// i18n-ignore` 可豁免单行。**仅拦 CJK**（英文展示文案靠 review）。`overview-view.tsx` 占位页在 `EXCLUDED_FILES` 中豁免。`pnpm test`（`vitest run`）跑全部测试
