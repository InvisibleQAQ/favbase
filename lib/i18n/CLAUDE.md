# i18n

用户可见文案集中在 `locales/`：`zh-CN.ts` 是 `LocaleKeys` 类型源，`en.ts` 以 `Record<LocaleKeys, string>` 保证键集合一致。React 组件通过 `useTranslation()` 订阅语言变化；非 React 调用经 `index.ts` 的 `t()`，禁止业务层直接拼接翻译文本。

ASR quota 文案只消费结构化 `ASR_QUOTA_EXCEEDED/resetAt`：自动转录 UI 使用 `autoTranscribe.quotaPaused*`，设置页使用 `settings.asr.groq*`；Groq 原始 429 message 只作 debug，不进入可见文案。

缺 ASR 配置的自动转录等待使用 `autoTranscribe.configurationRequiredTitle/configurationRequired/configureAsr`，不得复用“API Key 无效”错误标题；只在视频确实无可用官方字幕且 resolver 无 key 时显示，按钮深链 AI / ASR 设置。不得把“未配置 ASR”做成 Fetch 前置门。

## 平台命名

- Bilibili 页面标题使用 `collections.sidebarTitle`，主分类标题使用 `collections.foldersTitle`；两者职责不可混用。
- Bilibili 全量同步进度使用 `collections.bilibiliSyncProgress`，插值固定包含累计条目、收藏夹序号/总数/标题和页码/总页数；中英文键集合必须同步。
- 本地浏览器书签平台显示名固定为 `Browser Bookmarks` / `浏览器书签`；`nav.bookmarks` 与 `bookmarks.title` 必须一致，后台任务提示复用 `nav.bookmarks`。
- X 平台显示名固定为 `X Bookmarks` / `X 书签`，不得与浏览器书签平台合并。
- `bookmarks.*`、`x.*` 是稳定翻译键命名空间；显示名调整不改键、路由、数据库 platform 或任务 ID。
- Collection 页面紧凑处理条统一使用 `pipeline.*`。全局任务提醒的 `extract` kind 与 pausing/paused phase 使用 `backgroundJobs.*`；共享 collection UI 只收预翻译 label，不调用 `t()`。`backgroundJobs.kind.sync` 与 `pipeline.fetch` 指同一件事（从平台拉取收藏），文案必须一致（获取 / Fetch），不得再引入第二个「同步」说法——六平台的获取按钮统一 `pipeline.fetchNow`（立即获取 / Fetch now）+ `pipeline.fetching`（获取中... / Fetching...），旧的 per-platform `*.sync/*.syncing` 与 `common.syncNow` 已删除。知识库闸门按钮固定 `pipeline.pauseLibrary` / `pipeline.resumeLibrary`（暂停/继续构建知识库），暂停中获取按钮的禁用提示为 `pipeline.fetchBlockedByPause`；段级暂停控件（`pipeline.control.*`）已下线，不得复活。
- 普通名词 `bookmark` / `书签` 按语境翻译，不机械替换为平台显示名。

## 验证

- 修改 locale 后运行 `pnpm.cmd test -- lib/i18n/index.test.ts` 与 `pnpm.cmd compile`。
- `index.test.ts` 通过公开 `t()` 覆盖双语平台名、插值、复数和数字格式化。
- Dashboard 与聚合标签筛选的所有可见文案使用 `dashboard.*` / `allCollections.*`；`overview-view.tsx` 不再享有硬编码守卫豁免。
