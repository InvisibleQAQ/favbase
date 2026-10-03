# lib/douyin

抖音收藏收录领域（第 7 个平台，docs/33）。同步登录用户的**全部收藏**（`aweme/listcollection`），`status === 1` 的公开收藏夹是 Source；正文 = 作品 `desc`，同步时即得。复用现有表（`platform='douyin'`），零新表零迁移。

**状态：Step 1 已落地（2026-10-03，代码 + 单测，已复核），判别符未翻**——`'douyin'` 不在 `COLLECTION_PLATFORMS`，没有 app 侧接线；`lib-import-smoke`、env 守卫的「平台目录无裸数值常量」、sleep 守卫要到 docs/33 Step 2 翻判别符后才自动覆盖本目录，在那之前按它们的规则自律（Step 1 落地时临时跑过一遍，全绿）。transport 实现、标签页门、断点 storage、处理 lane 派发都在 Step 2 的 `entrypoints/app/sections/douyin/`。

## 为什么是注入的 transport（docs/33 D4）

2026-08-16/17 起三个收藏接口都在页面 SDK 的 `webSign` 受保护表里，扩展直连 → `403 Blocked by ArgusSecurityPlugin`。请求在用户**已打开**的 www.douyin.com 标签页 MAIN world 里发，由页面 SDK 自动补 `a_bogus` / `x-secsdk-web-signature`。所以本目录**零 chrome、零 storage、零裸 `fetch`**：`douyin-api.ts` 只定义 `DouyinTransport`（`(req) => Promise<DouyinTransportResult>`，transport 自己不抛，失败折成 `kind: 'sdk-not-ready' | 'unreachable'`），分类全在 lib，测试用 fake transport 覆盖每一种失败。deadline 由 lib 给（`timeoutMs = resolveHttpDeadlineMs()`），transport 负责执行。

## 请求构造铁律（`build*Request`，纯函数）

- **绝不预填签名参数**（`a_bogus` / `X-Bogus` / `verifyFp` / `fp` / `uifid` / `timestamp` / `x-secsdk-web-signature` / `msToken`）：签名覆盖精确 query，SDK 签完再多一个参数就是 `403 Sign Invalid`。只发业务参数 + `device_platform=webapp&aid=6383&channel=channel_pc_web`，测试按集合断言
- 路径一律相对 www.douyin.com、带尾斜杠；listcollection 是 POST，`count`/`cursor` 在 form，`publish_video_strategy_type=2` 在 query；另两个是 GET
- id 一律字符串：`aweme_id`、`collects_id_str`（`collects_id` 是 int64 number，`JSON.parse` 后已丢精度；夹内条目参数拼作 `collects_id`）
- **`collect*` = 收藏，`favorite*` = 喜欢 / 点赞**：`aweme/favorite`、`favorite_permission`、`show_favorite_list` 与本平台无关

## 失败形态 → 动作（`classifyResponse` + 分页解码，按形态不按码）

| 形态 | 动作 / 错误 |
|---|---|
| `sdk-not-ready` | `Error`（刷新抖音标签页），不重试 |
| 403 + body 含 `ArgusSecurityPlugin` | `Error` + 片段，不重试（签名问题，是 favbase 或 SDK 变了） |
| 403 / 429 无 Argus | `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)`，不重试 |
| 200 空 body | `retryAfter`；耗尽 → 同上 |
| 5xx / `unreachable` | `retryAfter`；耗尽 → `Error`（与空 body **共用** `MAX_RETRIES` 一份预算，D-d） |
| 其他非 2xx | `Error` + 片段，不重试（手册未列，按「绝不信任 200」补） |
| 非 JSON（挑战页）/ 验证标记 | `DouyinRateLimitError(resetAt: null)`——去抖音标签页完成验证 |
| JSON 无 `status_code` / 不是对象 | `Error`（未知形状） |
| `status_code: 8` + 「未登录」/ `2483` / 「请先登录」 | `DouyinAuthError(…, 'missing')`（favbase 从不预先确认抖音登录，同知乎恒 `missing`） |
| 其他非零 `status_code`（含 count 超限的 `5`） | `DouyinStatusError`（带 `statusCode` / `statusMsg`，`extends Error`） |
| `status_code: 0` + 列表空/`null` + `has_more` 真 | 有 `disabled_item_ids` / `invalid_item_id_list` → 整页失效、继续翻；否则 `DouyinRateLimitError(cooldown)` 软停（F8） |
| `has_more` 缺失或不是 bool / 0 / 1 | `Error`——没有它不能翻页，不猜 |
| `has_more` 真但 cursor 不可用 / 不前进 / 回退（listcollection 回到 `0` 也算） | `Error`（F10）；续传段第一次请求的「不前进 / 回退」另触发 D-e |

- **合法零结果**：`status_code: 0` + 列表 `[]`/`null`/缺键 + `has_more` 假（列表键若存在但既不是数组也不是 `null` → `Error`）。依据：probe #3 实测无夹 = `collects_list: null` + `has_more: false`；`aweme_list: null` + `has_more: 0` **无直接样本** `[UNKNOWN]`，按同一规则放行（风控扣数据的已知形态都带 `has_more: 1`）
- **验证码检测不扫用户内容**（`findVerifyMarker`，一次遍历）：键名 `verify_check` / `verify_center_decision_conf` / `verify_ticket` / `captcha` **带非空值**时任意层级命中；字符串值含这四个词只在信封层算，**不进** `aweme_list` / `collects_list` 条目——否则一条讲 captcha 的视频会让整次同步以「去验证」停掉。依据：唯一的字符串值真实样本 `search_nil_info.search_nil_type: 'verify_check'` 在信封层（MediaCrawler #358）；`verify_center_decision_conf` 样本是合成数据，收藏接口上的真实验证形态 `[UNKNOWN]`
- 每个错误消息带 HTTP 状态 + 300 字符片段（`textSnippet` 取 transport 原文，**不**重新 `JSON.stringify` 1.6 MB 的页）+ `status_code` / `status_msg`
- `2154` / `2156` / `10000` / `10001` 不单独分类（证据弱，docs/33 §2.3），统统走 F9

## 节奏器（`createDouyinPacer`，docs/33 §4.5 + 设计 A）

一次运行一个实例，三个接口共用一条串行链。**放在 `withRetries` 的 attempt 里**：每次真实请求（含重试）都先 `pacer.beforeRequest()`、都计入 `REST_EVERY_PAGES`（风控按请求计数，重试也是请求），所以一次重试的等待 = 退避 + 页间隔。语义：第一个请求不等；之后每个请求前 `jitteredDelayMs(PAGE_DELAY_MIN, PAGE_DELAY_JITTER)`；每满 `REST_EVERY_PAGES` 次请求，下一个请求前再加 `jitteredDelayMs(REST_MIN, REST_JITTER)`（`REST_EVERY_PAGES=0` 关闭）。`requestEnvelope` 每次 attempt：`withRetries` 的 checkpoint → 节奏器等待 → **再 checkpoint 一次**（3 分钟休息期间按下暂停，不应在休息结束后照发请求）→ transport → 分类；**每次请求 2 次 checkpoint 是有意的**（zhihu 锁「两页两次」，抖音不同不是 bug）。`sleep` / `random` 可注入；`withRetries` 内部的退避 sleep 不可注入，相关测试用 fake timers

数值全部 `envNumber('VITE_DOUYIN_*', default)`：11 个在 `douyin-api.ts`，`TITLE_MAX_CHARS` 在 `douyin-sync-service.ts`；`EXPECTED_ENV_CONSTANTS`、`.env.example` 抖音块同步

## 分页游走

| 端点 | cursor | `has_more` | 列表键 |
|---|---|---|---|
| `walkCollection` → listcollection | 首页 `'0'`，之后用响应 16 位微秒时间戳，逐页**递减**（BigInt 比较） | 0/1 | `aweme_list` |
| `fetchPublicFolders` → collects/list | 偏移，**递增** | bool | `collects_list`（只留 `status === 1`；其他值一律不当公开） |
| `walkFolderItems` → collects/video/list | 偏移，递增，无 `max_cursor` | 0/1 | `aweme_list` |

一页条数 < `count` 不代表到底（失效作品被剔除），只看 `has_more`。`MAX_PAGES` 是**每段**的失控保险丝，触发时静默返回 `'fuse'`（同 zhihu）。listcollection 的下一页 cursor 必须 `> 0` 且小于上一页（首页 `'0'` 除外）：`'0'` 是「从头开始」，接受它会把游走送回最新一页、一路循环到保险丝，所以按 F10 停。`walkCollection` 的 `onStartCursorRejected` 只在**第一次请求**（携带起始 cursor 的那次，含它在 `withRetries` 里的重试）出现 F8（无失效 id）/ F9 / F10（返回的 cursor 没有越过起始 cursor）时、抛出前调用，只有续传段传它（D-e）

## 同步编排（`douyin-sync-service.ts`，唯一的 schema 知识持有者）

`syncDouyinCollections(transport, { backfill, onBackfill?, onPagePersisted?, onProgress?, control? })`（测试用 `syncDouyinCollectionsToDb(db, …)` + 注入 `pacer` / `now`）。一次运行的顺序：

1. `collects/list` 全量 → 公开夹 → 一次 `ingestCollection({ sources, items: [] })`（空夹也是 Source）
2. **头部段**：从 `'0'` 翻 listcollection，每页 `ingestCollection({ sources: [], links: [] })`
3. **续传段**：仅当本次以断点开跑（`resumeCursor` 非空、未完成）
4. 每个公开夹全量走 collects/video/list，入库并写 links（夹里有、全量列表还没拉到的照样入库）
5. 返回 `{ fetched, inserted, folders, newItemIds }`——`fetched` 是各页收到的作品数之和，一条同时在全量列表和公开夹里会计两次（同知乎的 `total`）；进度回调 `(fetchedCount, page)` 报的也是这个累计数

- **D-a 全部收藏条目不挂 Source**：X / GitHub 的合成 Source 在它们 `dimensions.source: null` 时无害；抖音的 Source 维度是收藏夹，合成「全部收藏」会在 chip 与 Dashboard 细分里冒出一个假夹，还和「全部」chip 重复。所以存在没有任何 link 的条目，`getDouyinItems` 照查（测试锁住）
- **D-b 逐页入库 + 逐页回调**：每页 `onPagePersisted(result.contentPersisted)`（非空才调），app 侧逐条 `enqueueCollectionProcessingItem`、funnel 收 `newItemIds: []`——逐页入库下中途失败的运行已写进库的条目不会经 funnel 派发（funnel 只在成功时派发）
- 已知集合开跑时 `platformItemIds` 读一次，每页入库后并入（减去 `droppedItemIds`）；**整页**（剔除失效后非空）都已知才停，不用「首个已知 id 即停」——重新收藏的旧视频会顶到最前面压住新的

## 断点状态机（设计 B：两个字段）

`DouyinBackfillState = { resumeCursor: string | null; backfillDone: boolean }`，调用方传入、每次变化经 `onBackfill` 回写（lib 零 storage）。手册原有的第三个字段 `restartBackfill` 已删：「全量走」直接由 `fullWalk = !backfillDone && resumeCursor === null` 判定，D-e 写回 `{ null, false }` 自然进入全量走；而按手册字面「只有 `restartBackfill` 才关早停」有真 bug——首次全量某页已入库、`onBackfill` 还没写回就中断 → 下次头部第一页整页已知即停、又无断点可续 → 回填永远完不成。

- 头部段：`fullWalk` 时不早停，**每页入库成功之后**把响应 cursor 写成 `resumeCursor`（先入库后写 cursor：崩在中间只是多一次 insert-only 空跑，反过来会丢页）；非 `fullWalk` 时整页已知即停，**不改** `resumeCursor`
- 任一段走到 `has_more: 0` → `{ null, true }`
- 续传段：从 `resumeCursor` 翻到底，每页推向更旧（只取更小者）。续传段只在本次以断点开跑时运行，所以 `fullWalk` 撞保险丝的那次运行**不**接着续传，下次运行再续
- **D-e（仅续传段第一次请求，即携带存储断点的那次）**：F8（无失效 id）、F9，或 F10（返回的 cursor 不前进 / 回退——服务端没认这个断点，比如从头返回）→ 写回 `{ null, false }` 再抛原错误；下次全量走。16 位 cursor 跨天是否有效、失效时服务端怎么回应都 `[UNKNOWN]`，若按限流或普通错误处理，续传会永远卡死（UI 无重置入口），代价是多一次全量。**续传段第 2 页起**用的是本次刚从服务端拿到的 cursor，那里的 F8 / F9 多半是真风控、F10 是服务端分页本身出错，都按普通错误处理、断点留在最后一页成功入库之后——此时清空断点等于在被限流时安排一次约 115 页的全量重走（Step 1 复核时收窄到第一次请求，并经主会话决定纳入首请求 F10，测试锁住）。头部段的 F8 / F9 / F10 不动断点（头部段不传回调）
- **存储断点在边界校验**：`resumeCursor` 经 `decodeCursor` 读入，不是纯数字串（存储损坏、旧格式）就当 `null`——等同 D-e，本次全量走；否则它会在游走里以 `BigInt` 的 `SyntaxError` 冒出来（测试锁住）
- 中途抛错：已入库保留（insert-only），断点停在最后一页成功入库之后
- 已知限制：非 `fullWalk` 的头部段若一天新增超过 `MAX_PAGES` 页（> 4000 条）撞保险丝，那一段之后不会被补上

## items 行映射

- `platformItemId = aweme_id`；`title` = `desc` 首个非空行截断 `TITLE_MAX_CHARS`，空则作者昵称（再空则 id）
- `originalUrl`：`images` 非空 → `https://www.douyin.com/note/<id>`，否则 `/video/<id>`
- 作者 `platformAuthorId = author.sec_uid`（`uid` 会轮换）、`authorName = nickname`；**`sec_uid` 为空的条目剔除作者行，ingest 随之丢掉该条目**（同 X 剔除空 restId）
- `publishedAt = create_time * 1000`（作品发布时间；抖音无逐条收藏时间，同知乎妥协）
- `contentState`：`desc` 非空 `'chunked'`、空 `'no_content'`，**从不** `'pending'`；切块 `charSplit(text, { preferParagraph: false })`（叶子导入 `@/lib/embedding/char-split`）
- `platform_meta`：`{ desc, authorName, authorSecUid, avatarUrl, coverUrl, durationMs, mediaKind, folderId, folderTitle }`——`durationMs` 毫秒（图文为 null），`folderId`/`folderTitle` 是**首见**公开夹、仅展示（从全量列表首见则为 null），筛选走 `item_sources`。不存 `statistics.play_count`（网页恒 0）

## 查询

`getDouyinItems({ folderId?, search?, page, pageSize })`：`publishedAt DESC NULLS LAST`，夹筛选 `sourceMembership`，搜索 `searchCondition`（title、authorName、`platform_meta->>'desc'`）。`getFolderCounts()` 走 `sourceItemCounts` 映射成 `folderId`。防御式收窄 `narrowDouyinMeta(meta, { title, authorName })` 与整个 mapper `toDouyinItem`（Row → `DouyinItem`）都只有一份，Step 2 的 tagged card 直接复用 `toDouyinItem`
