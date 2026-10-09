# sections/douyin

抖音收藏页（`/collections/douyin`，公开收藏夹经 chips 筛选，无详情路由）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel、状态组件）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection-states/CLAUDE.md`；这里只记抖音的不同之处。

## 约束

- 每个请求都注入到用户自己已打开、已登录的 www.douyin.com 标签页里发，由页面 SDK 签名（docs/33 D3 / D4）。favbase 从不自己开、刷新、导航或激活抖音标签页；页面上的「打开抖音」只是用户自己点的普通链接。凭据没有 UI，无 Connections 卡。
- 标签页门在 Platform Sync funnel **之前**：`findDouyinTab()` 为 null 就抛 `DouyinAuthError('missing')`——不联网就能判定，不算尝试、不写 Platform Sync Record（docs/32 §5.2）。标签页开着但没登录只有发了请求才知道，那在 funnel 里，算一次尝试。
- `douyinAutoSyncPolicy.probeReady` 必须和前门、transport 用同一个解析器 `findDouyinTab`（docs/33 D-c）：被丢弃或加载中的标签页不能烧掉当天的自动同步名额。未登录对自动同步是静默完成（`isSilentError`）。
- 处理 lane 在 adapter 里逐页派发，交给 funnel 的 `newItemIds` 恒为 `[]`（docs/33 D-b）：首次全量每百条约 2 分钟（docs/33 Step 3 实测），而 funnel 只在成功时派发，第 80 页失败不能留下 79 页已入库却永不处理的条目。
- `onPagePersisted` 派发的 `itemId` 是 platformItemId（`aweme_id`），不是 `items.id`。
- 断点 `douyinBackfillStorage` 在 funnel 内读取，每次变化都写回；断点语义见 `lib/douyin/CLAUDE.md`。
- 同步只由按钮触发，不在挂载时跑：需要用户的抖音标签页，首次全量很慢。
- 限流错误有两条文案，按 `resetAt` 有无区分，不要合并（用户决定）：`null` 是验证页，提示去抖音标签页完成验证，不锁按钮；非空是 favbase 自定的冷却，并把标题栏获取按钮锁成倒计时。
- 库空态也带「打开抖音」（同 X，对比知乎）：库只能经已打开的抖音标签页填满。
- scaffold 的两个可选 slot（`pipeline`、`configurationNotice`）都要显式传：漏传 `tsc` 不报，漏了 `configurationNotice`，Tags 积压就没有恢复入口。
- 只有 `status === 1` 的公开收藏夹是 Source；不在任何公开夹里的收藏只出现在「全部」下（docs/33 D1 / D-a），chips 计数之和小于总数不是 bug。
- 抖音不给逐条收藏时间，排序用作品发布时间，caption 必须如实写出（`douyin.sortedByPublishTime`）。
- 导航键是 `nav.douyinFavorites`，不是 docs/33 写的 `nav.douyinCollections`：`Collection` 是 favbase 自己的领域词（根 `CONTEXT.md`）。抖音 API 里 `collect*` 才是收藏，`favorite*` 是喜欢 / 点赞，与本平台无关。

## 转录与处理 lane（docs/37 Step 3）

- 可转录视频以 `'pending'` 入库（门在 `lib/douyin`），正文由 Transcript lane 流式转录后才有：sync adapter 在 funnel 内动态 import `auto-transcribe-runtime.ts`（转录 runtime 不进启动 chunk），`runDouyinStreamingSync` 把每页 `onVideosPending` 的视频喂进共享的 `hooks/transcript-lane.ts`。
- 两条输入源不能混：`onPagePersisted`（图文、无时长视频、治愈的幽灵）经 `douyin-processing-adapter.ts` 逐条派发 Embed / Tag；`onVideosPending`（本页新插入的可转录视频）进 Transcript inbox。视频转录落库后由 `transcribe-and-persist` 经同一个 processing adapter 派发。
- D7 积压（`getDouyinPendingVideos()`）只在 sync **成功**结算前追加，失败 / 验证页不追加（挡住 sync 的也会挡住转录）；session 按 id 去重，本次刚入库的不会排两次。积压读取失败只记 error，不把成功的 Platform Sync 变成失败。
- sync 开始时若已有抖音转录 session 在跑，本次跳过 D7 积压（`isActive()` 在入口判，不在 sync 之后）：此刻读出的列表要排在那个 session 后面，等轮到时已过期，已转录的条目会被重放（cache 命中，但重写正文、替换 chunk 清掉 embedding、重新 embed、每条再等 10–15 s）。代价：前一次失败的 sync 没追加的残留，要等下一次开始时没有 session 在跑的 sync。
- Fetch 不 await Transcript；producer 在 `finally` 里 close，失败的 sync 仍排空已发布的条目。
- v1 没有卡片上的手动转录 / 取消按钮（docs/37 D-e）；`'error'` 的条目没有重试入口。
- 标签筛选网格不画 CC / ASR 角标：tagged card 从 tagging 行重建 `PagedItemRow`，没有 `subtitleSource`（`undefined` ≠ 没有字幕）。
- 缺前置条件的横幅：`prerequisiteBlocked` 来自 `douyinAutoTranscribePipeline` 的状态；`'platform-tab'` 的文案要用户打开 / 登录 / 验证后**刷新**标签页，页内完成验证不刷新不会恢复（`lib/douyin/CLAUDE.md`）。
- SW 侧 job registry 一个 tab 只记一个转录 job，B站与抖音 session 并发时会串台：已知缺口，见 `entrypoints/app/hooks/CLAUDE.md`「Transcript lane」。

## 已知缺口

- 冷却锁只在内存里（刷新即解），只锁标题栏按钮；错误态的 Retry 与每日自动同步都不看它。
- 封面 URL 原样使用，可能带会过期的签名参数 `[UNKNOWN]`；目前只靠卡片外壳的破图回退，没有刷新机制。

## 指针

- transport、节奏器、断点续传：`lib/douyin/CLAUDE.md`；逐页入库 + 逐条派发的契约：`.trellis/spec/frontend/platform-onboarding.md` §4.6。
- 测试：`douyin-view.test.tsx`、`douyin-card.test.tsx`、`douyin-sync-adapter.test.ts`、`auto-transcribe-runtime.test.ts`、`douyin-processing-adapter.test.ts`。
