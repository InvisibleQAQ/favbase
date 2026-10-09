# bilibili

app.html B站收藏夹页（`/collections/bilibili[/:mediaId]`）的平台 adapter：夹内浏览、显式同步、手动与自动转录。页面编排必须经共享 `CollectionPageScaffold`；scaffold、pipeline hook、面包屑 hook 的通用约定见 `entrypoints/app/components/collection/CLAUDE.md` 与 `entrypoints/app/hooks/CLAUDE.md`，这里只写 B站独有的。

## 约束

### 浏览（远端 API，不读本地库）

- 夹内网格走远端 API 分页（docs/32 D4）：`use-bili-fav-videos.ts` 只调 fetch-only 的 `fetchFavoriteVideosPage`，不写库、不污染全量同步基线。别改成本地优先；重开的触发条件是浏览路径第一次观察到 412。
- 所以 B站没有 lib 分页查询与 `mapRow`：`toBiliFavVideo` 留在 `tagged-video-card.tsx`，其余平台的 mapper 是 lib 导出的，这里没有可共用的。
- 视频排序：服务端排序，不做客户端排序（`order` 一路传到 `fetchFavVideos`）。显式增量同步有意固定 `mtime` + 空关键词：其他排序或搜索结果会破坏「遇到旧条目即截断」的语义。
- 视频搜索：服务端搜索（`keyword` 同一条链路），只影响 UI 浏览，不影响全量同步。
- 只做公开收藏夹：私密夹由 `lib/bilibili` 在 API 层过滤（见 `lib/bilibili/CLAUDE.md`），页面不要自己再判，也不要绕过。
- 失效视频的判定与 `platform_meta` 的收窄归 `lib/bilibili/video-eligibility.ts`（`isProcessableVideo` / `narrowBiliVideoMeta`），本目录不自己读 `attr`。

### 同步

- 「B站同步成功意味着什么」只在 `bilibili-sync-adapter.ts` 的 `runBilibiliSync` 定义一处；手动 runner 与 daily auto-sync registry 引用同一个函数。
- `runBilibiliSync` 先 `checkAuth()`（读 cookie、零网络）再进 funnel `runPlatformSync`：未登录在 funnel 之前抛 `BiliAuthError`，不算一次尝试、不写 Platform Sync Record（docs/32 §5.2）。页面的未登录态就靠这个错误类识别。
- 它回报 `newItemIds: []` 是故意的：逐条转录自己 enqueue embed/tag，funnel 只需派发 backlog lane。
- `auto-transcribe-runtime` 在 adapter 里动态 import：转录 runtime 不进 App 启动 chunk。
- 挂载时拉夹列表（`use-bili-fav-folders.ts` 的 `fetchAndSyncFolders()`）不是 Platform Sync：不经 adapter/funnel、不算尝试。别把它接进 funnel，否则每次打开页面都会占掉当天的自动全量同步名额。mount 也不扫历史 pending。
- 路由选中的夹经 `preferFolderId` 排到 Fetch producer 首位；优先级只属于 Fetch，Transcript 不维护第二套排序。
- 持久化是 insert-only：只把 `result.inserted` 对应的视频发布去转录，新增 membership 不重复转录。
- 「上次同步」读 Platform Sync Record，caption 用 `formatDateTime`：只显示时刻会把上周的同步显示成「10:32」。

### 转录与处理 lane

- Fetch 不 await Transcript；多个 Fetch producer 只在 Transcript lane 串行，Fetch 不被锁。producer / 派发机制是共享的 `hooks/transcript-lane.ts`（docs/37 Step 3）；本目录的 `auto-transcribe-runtime.ts` 只留 pipeline 单例、`isProcessableVideo` + 有 bvid 的资格判定和到 `AutoTranscribeVideo` 的映射。
- 转录 session 用 `startJob(..., 'queue')` 派发：手动转录占着 `transcribe` job key 时由 job store 排队并自动接续，不要写重派发循环。
- 自动批转录与手动单视频共用同一个 `transcribe` job key；pipeline strip 的 Transcription 段（共享的 `transcriptionStage`）读这个 job，闸门暂停时才会正确显示 paused。禁止用 `indexing` 冒充 Tagging 段。
- 进度条 `AutoTranscribeBar` 与订阅 hook `useAutoTranscribe(pipeline)` 住 `components/auto-transcribe/`（与抖音共用，docs/37 D-d），view 传 `biliAutoTranscribePipeline`；hook「纯订阅、零副作用」的规则在那里的 `CLAUDE.md`。
- 转录成功且 chunks durable 后 enqueue Embed / Tag 双 lane 并立即返回，两者都不阻塞下一条 Transcript；卡片的「已索引」标记由晚到的回调独立刷新。
- Embed / Tag 经 `bilibili-processing-adapter.ts` 进共享处理 inbox：它是 app/lib 边界，领域层因此不依赖 app 的 job store。
- job 命名空间一律是 `jobPlatformForCollection(PLATFORM)` 派生的 `JOB_PLATFORM`，不手写 `'bilibili'`；守卫 `tests/platform-completeness-contract.test.ts`。
- 转录写入是 `.trellis/spec/frontend/platform-onboarding.md` §4.4「延迟正文」的流式变体。

### 错误与状态

- 错误先经共享 `classifyCollectionSyncError`，再用 `syncErrorMessage(…, SYNC_ERROR_COPY)` 翻译后才喂 scaffold（浏览错误与同步横幅都是）：412 风控显示限流文案，而不是原始 HTTP 文本。
- `auth` 变体走 `loginState`，从不进 `error`。B站不报 reset 时间，所以没有限流按钮锁。
- `NotLoggedIn` / `EmptyFolderState` / `SelectFolderState` 三态刻意留在本地，不迁 `components/collection-states/`（docs/32 Step 6 D-c）：未登录的动作是「重试」而不是打开站点 + 获取，空夹无图标无按钮，未选夹高度不同。它们仍消费 `StateBox`，不自画 heading。
- 认证门隐藏 pipeline strip。

### 刻意的 UI 决定

- 页面 h1 固定 `collections.sidebarTitle`，主分类标题 `collections.foldersTitle`；当前夹名只出现在面包屑末项，不进 caption、不冒充页面标题。
- 页面各区块保持纵向堆叠；压成三行的方案已被用户否决（docs/19 P0-1），别重提。
- 收藏夹 chip 只显示名称，不显示每个夹的视频数。
- 缺 ASR 的提醒由页面的 `CollectionConfigurationNotice` 统一出（`prerequisiteBlocked` 来自 pipeline 状态），进度条不重复画 warning；缺 ASR 的条目被停放，后续有官方字幕的视频仍继续处理。进度条自身的规则在 `components/auto-transcribe/CLAUDE.md`。
- 排序控件的选中态是 8% 品牌洗底 + `text.primary`，不用主色做文字。
- 视频卡 Chip 按语义着色（`.trellis/spec/frontend/ui-design-system.md` §9）：可点动作 `primary`、CC/ASR 来源 `info`、已索引 `secondary`；`success` 对比度不过 4.5，已否决。`video-card.test.tsx` 锁。
- 视频卡的操作栏与标签行必须在链接之外（由 `CollectionCard` 外壳保证）；失效视频灰显、无链接、无操作栏。
- 标签筛选跨收藏夹、多选 AND 语义；标签结果网格是知识库视图，卡片不传 `transcribeState`（无操作栏）。只有转录并索引过的视频才有 AI 标签，大部分卡片无标签是正常态。
