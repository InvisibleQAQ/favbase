# lib/douyin

抖音收藏收录领域（docs/33）与字幕 / 转录接入（docs/37）。同步登录用户的**全部收藏**，`status === 1` 的公开收藏夹是 Source。Content 按作品形态两分（docs/37 D1）：可转录的视频以 `'pending'` 入库、转录后才有正文；图文与无时长的视频，正文 = 作品 `desc`，同步时即得。app 侧接线（标签页门、断点读写、逐页派发）见 `entrypoints/app/sections/douyin/CLAUDE.md`。

## 约束

- 私密夹里的作品也是 Collection Item（经全部收藏列表进来）：这是对 bilibili / zhihu「私密夹条目不入库」的有意偏离（docs/33 D1），别「修正」。
- 请求只能从用户**已打开**的 www.douyin.com 标签页 MAIN world 发出：自 2026-08-16/17 起三个收藏接口要页面 SDK 签名，扩展直连是 `403 ArgusSecurityPlugin`（docs/33 D4）。
- `douyin-api.ts` / `douyin-sync-service.ts` 的加载图零 `chrome.*`、零 storage、零裸 `fetch`：只认注入的 `DouyinTransport`，断点状态由调用方传入、经 `onBackfill` 回写。
- `chrome.*` 只在 `douyin-tab.ts`，且上面两个文件不得 import 它。该文件加载期不碰 chrome，`tests/lib-import-smoke.test.ts` 发现不了这条边，由 `douyin-tab.test.ts` 守。
- `douyin-tab.ts` 放在 `lib/douyin/` 而不是 `sections/douyin/` 是刻意的（用户决定）：平台真实的请求与计时代码必须留在平台目录守卫（sleep、env 常量、裸 fetch 白名单）的扫描范围内。
- `findDouyinTab()` 是唯一的标签页解析器，Sync Adapter 的标签页门、daily `probeReady`、transport 三处共用：「就绪」才不会指向 transport 注不进去的被丢弃 / 加载中的标签页。
- transport 每次请求都重新解析标签页，且从不碰标签页本身（不 reload、不导航、不激活）。
- 同一个 `req.timeoutMs` 在页内与页外各执行一次：被冻结的后台页里，页内的 `AbortSignal` 不会触发。不要为此新增 env 键。
- `douyinPageFetch` 被 `executeScript` 用 `toString()` 序列化进页面，必须自包含：零闭包、零 import、零模块级常量、零 helper，只读参数与页面全局。
- **绝不预填签名参数**（`a_bogus` / `X-Bogus` / `verifyFp` / `fp` / `uifid` / `timestamp` / `x-secsdk-web-signature` / `msToken`）：签名覆盖精确 query，SDK 签完再多一个参数就是 `403 Sign Invalid`。
- id 一律字符串：收藏夹用 `collects_id_str`——`collects_id` 是 int64，`JSON.parse` 后已丢精度。
- 抖音 API 里 `collect*` = 收藏（本平台），`favorite*` = 喜欢 / 点赞（与本平台无关，别调）。

## 内容模型与转录落库（docs/37 Step 1）

- 入库门是 `isTranscribableAweme`（`douyin-media.ts`：`mediaKind === 'video' && durationMs > 0`）：为真 → `'pending'`、不写 `item_contents`、不派发；其余（图文、无时长视频）`desc` 即正文，`'chunked'` / `'no_content'`，逐页派发。用 D-f 的谓词而不是 D1 字面的「`mediaKind === 'video'`」：否则无时长的视频永远 `'pending'`、永远进不了转录 producer（Step 1 的有意偏离）。
- 视频不能以文案入库的原因：Tag 候选 = 尚无标签，转录替换正文后不会重新打标签；Coverage 的 content 段也会在转录前就算 done。
- `ingestPage` 的 `textOf` 对可转录视频恒 `''`：幽灵清扫对 `'has_content'` 零 chunk 的条目调它，被中断（正文已写、chunk 未写）的转录正是这种幽灵——返回 `desc` 会用文案覆盖已存的转录正文；`''` 让清扫退到已存 `plainText`，用 `charSplit` 原样重切（时间戳丢失、正文保留）。守卫：`douyin-sync-service.test.ts`「a transcription cut short …」。
- `persistDouyinTranscript(awemeId, rows, source)` 是本平台转录写正文的唯一 seam：非空 rows → `persistExistingItemContent` + `chunkSubtitleRows`，`source` 如实透传进 `subtitle_source`；全空白 rows 视为空转录；空转录 → 正文退回 `desc`（`subtitle_source: null`、`charSplit` 切块），`desc` 也空 → 结算 `'no_content'`、返回 `null`（D6）。它不发事件、不派发 lane，那是 `lib/transcription/transcribe-and-persist.ts` 的活。
- 上一条里一个函数出现两个 ingest 入口是刻意的：`persistExistingItemContent` 是写正文的唯一入口（docs/37 铁律 3），`settleItemContent` 在这里只结算无正文条目的状态、不写正文；两者都是 `lib/ingest/CLAUDE.md` 许可的事务外入口，别把其中一个「统一」掉。
- `getDouyinPendingVideos()` 是 D7 积压的查询：只看 `content_state = 'pending'`，不再按 `mediaKind` 过滤——入库门保证 `'pending'` 只有可转录视频。
- `markDouyinError` 翻 `'error'`，fire-and-forget（镜像 bilibili）；`'error'` 的条目不再进积压，也没有重试入口（v1 无手动按钮）。
- `douyin-media.ts` 是零 I/O 纯模块，Background SW 的转录 handler（docs/37 Step 2）会 import 它：只许 import `./douyin-api` 与 `@/lib/http/response-body`，不得 import `douyin-sync-service` / `@/lib/database` / `@/lib/ingest` / `@/lib/storage`；在 `tests/lib-import-smoke.test.ts` 清单里。
- `isTranscribableAweme` 是内存判定，不进 `PLATFORM_DOWNSTREAM_ELIGIBILITY`：它不是下游排除（图文照样要 Embed / Tag），与 B 站 `isProcessableVideo` 语义不同。
- `pickAudioSourceUrls` 把三级候选**全部**按序拼成一个列表（纯音轨 `main_url → backup_url → fallback_url` → 最低 H.264 mp4 档的 3 条 → `play_addr.url_list`），下载侧逐条 fall-through（对 D-g 措辞的有意偏离：只给一级会把「主机 403」变成整条失败）。
- 上一条里纯音轨三条的顺序不可改：`main_url` 的主机对无 Referer 的 SW 请求 403，`backup_url` / `fallback_url` 200（Step 0 实测）。
- 纯音轨 `bit_rate_audio[].audio_meta.url_list` 是**对象**（三个命名 URL），`bit_rate[].play_addr.url_list` 才是数组；别按同一形状解析。
- 上一条的第二级只在 `format === 'mp4'` 里选、优先 `is_h265 === 0`、`bit_rate` 非有限数的档不参与：按 `bit_rate` 升序取第一档会选到 h265 + bytevc1 的 dash 档。
- `aweme/detail` 的 `cla_info`（AI 字幕轨）v1 不读：Step 0 实测 136 个样本全空。形状记在 docs/37 §4.2。

## Background 转录 handler（docs/37 Step 2）

- `douyin-transcription-handler.ts` 在 Background SW 的静态图上，import 白名单：`./douyin-api`、`./douyin-tab`、`./douyin-media`、`@/lib/background/transcription-utils`、pipeline / types / cache 与 `@/lib/storage/settings` 这几个 leaf。禁止 `./douyin-sync-service`、`@/lib/database*`、`@/lib/ingest*`、`@/lib/collections` / `@/lib/storage` barrel、`@/lib/background/transcription-handlers`（成环）。守卫：`tests/agent-bridge-background-bundle-contract.test.ts`（源码级）+ `pnpm build` 的 bundle 检查（产物级）。
- detail 请求懒到 ASR 路径的 URL extractor 里取，不是 pipeline 之前的 prepare：cache 命中（D7 积压重开后）与缺 ASR key 都不发签名请求、不等节奏器、不需要标签页。别把它搬回 handler 入口。
- extractor 的顺序固定：T1 查 `findTab()` → 节奏器 → `requestEnvelope` → `decodeDetail` → `aweme_id` 回声闸门 → `pickAudioSourceUrls`。T1 在节奏器之前：标签页明显不在时零等待、零请求；模块级节奏器用真实 `sleep`，`douyin-transcription-handler.test.ts` 的默认导出用例正是靠这个顺序才不等 5–8 s。
- detail 走 `requestEnvelope` 的共享瞬时预算（unreachable / 5xx / 空 200 共用 `MAX_RETRIES`，403 / 429 不重试），不传 `control`：转录的取消机制是 `signal`，节奏等待与注入请求都不认它，所以 extractor 在 detail 返回后补一次 `signal.aborted` 检查。
- `createDouyinDetailPacer` 是 handler 的模块级单例（每个 SW 生命周期一个，所有抖音 `TRANSCRIBE_AUDIO` 共用）：按上次请求的发送时刻计 `MIN + rand·JITTER`，无长休息；SW 重启丢一次间隔，可接受。不复用同步的 `createDouyinPacer`（docs/37 D4 否决项）。
- 上一条的并发调用（两个 app.html 标签页各跑一个 session）串行排队，后到者从前者的发送时刻起算：不排队的话后到者读到的是前者睡前的 `lastAt`，算出同一个 `due`、一起醒、背靠背发两条签名请求。同步的 `createDouyinPacer` 不排队是因为它每次运行一个实例、运行由 job store 串行。
- 上一条的节奏器在 `withRetries` 的 attempt 里，重试也算请求、也等间隔（与同步节奏器同理：风控按请求计数）。代价：标签页中途关掉后，3 次 unreachable 叠上退避与间隔，约 10–16 s 才报 `DOUYIN_TAB_MISSING`，不是立刻。
- detail 响应的 `aweme_id` 必须逐字节等于请求的 videoId，否则 `ASR_UNKNOWN`（`params.detail` 带两个 id）、不下载不转录（docs/29 的教训）。
- 不缓存 detail、不缓存直链：直链 ≈ 3 h（视频）/ 24 h（纯音轨）过期，每次转录现取现下。
- 上一条的代价（docs/37 Step 4）：ASR 限流后的那次重试会重走 extractor，再发一次 detail 签名请求、重下音频——实测 123 次 detail 里 30 次是重试。
- 纯音轨不保证小：码率两档，约 48–56 kbps 与约 194 kbps（多见于 ≥ 256 s 的作品）；194 kbps 下 > 约 16.5 min 的纯音轨超过 24 MB，照样走 Offscreen 分块（Step 4 实测可用）。别因为「有纯音轨」就省掉分块路径。
- 错误折算只按类、不按 message 文本——`DouyinSignatureError`（Argus 403 / `sdk-not-ready`）与 `DouyinUnreachableError`（unreachable 耗尽）两个具名子类就是为此存在的；它们直接 `extends Error`，同步侧按两个平台基类分类的逻辑不受影响。
- 折算表（docs/37 §4.3）：T1 无标签页 / T2 unreachable 耗尽 → `DOUYIN_TAB_MISSING` + `reason: 'closed'`；T4′ 验证页（`resetAt: null`）→ `'verify'`；T5 未登录 → `'login'`；T2′ / T3 → `DOUYIN_SIGNATURE_REJECTED` + `reason: 'sdk-not-ready' | 'argus'`；T4 与空 payload（`resetAt` 非空）→ `DOUYIN_RATE_LIMITED` + `retryAfter`（秒，只有这一个字段，不借 ASR quota 的 `resetAt` / `providerId`）；T6 → `DOUYIN_MEDIA_UNAVAILABLE` + `reason`；T7 → `ASR_NO_AUDIO_SOURCE`；T11 `DouyinStatusError` → `ASR_UNKNOWN`。
- `fetchOfficialSubtitle` 恒 `null`（Step 0：`cla_info` 零样本），`postProcess` 恒等（D-b），cache 用 `'douyin'` 命名空间。

## 自动转录 adapter（docs/37 Step 3）

- `auto-transcribe-adapter.ts` 是本平台的 `AutoTranscribeAdapter`，与 B站同形；ASR 半边（有没有 key、等 key、quota guard）是共享的 `lib/storage/asr-prerequisite.ts`，不在这里抄。它合法 import `@/lib/storage` 与 `./douyin-tab`，所以不在 import-smoke 清单里；sync-service 与 SW handler 都不得 import 它。
- `missingPrerequisite` 按此刻判：`DOUYIN_TAB_MISSING` + `closed` 只在 `findDouyinTab()` 为 null 时算前置条件缺失（标签页在、请求抖了一下 = 普通单条失败，否则停放 → 立刻恢复 → 重入队 → 再失败，空转）；`login` / `verify` 与 `DOUYIN_SIGNATURE_REJECTED` 不查标签页就算缺失。
- `DOUYIN_SIGNATURE_REJECTED` 算前置条件缺失、不标 `'error'`（对 docs/37 §4.3 T2′ / T3 的有意偏离）：修复动作是用户刷新标签页，与 login / verify 同类；SDK 一失效就逐条落 `'error'`，v1 没有重试入口。
- 等「用户对标签页做了动作」（login / verify / signature）期间 `transcribe()` 短路返回停放时的那条错误：pipeline 把后续条目一并停放，不再逐条发节奏化的签名请求打到登录 / 验证墙上。`closed` 不短路：SW 的 T1 门零请求，cache 命中仍能成功（D7 重开后不重复转录）。
- 三种等待：ASR key → 共享 settings watcher；`closed` → 轮询 `findDouyinTab()`，间隔 `VITE_DOUYIN_TAB_POLL_MS`（只管这一种）；login / verify / signature → `waitForDouyinTabLoad()`（`tabs.onUpdated` 的下一次 douyin.com 标签页 `complete`）。轮询 `findDouyinTab()` 在登录墙上会立刻 resolve 而空转，所以后者等的是「用户动过标签页」最便宜的证据。
- 上一条的代价：页内完成登录 / 验证而不刷新不会自动恢复，横幅文案明说「完成后刷新该标签页」。`waitForDouyinTabLoad` 从不碰标签页。
- `onVideosPending` 与 `onPagePersisted` 是两条输入源：前者按 `result.inserted` 算（夹内页会重新列出 head 已入库的视频，insert-only 下它们不在 `inserted` 里，不得重复入队），只含 `isTranscribableAweme` 的；后者是图文 / 无时长视频 / 治愈的幽灵。两者共用 `DouyinPendingVideo` 一个形状。

## 坑

- 本目录非测试文件里不要写含「斜杠 + 星号」的字符串字面量（如 URL 匹配模式）：env 常量守卫与裸 fetch 守卫用朴素正则剥块注释，这种字面量会把其后到下一个块注释结尾之间的代码从扫描里藏起来。标签页 URL 因此从 descriptor 的 `hostPermissions` 读。

## 失败形态 → 动作

按形态分类，不按状态码表（`classifyResponse` + 分页解码）；绝不信任 200。

| 形态 | 动作 / 错误 |
|---|---|
| `sdk-not-ready` | `DouyinSignatureError(reason: 'sdk-not-ready')`（刷新抖音标签页），不重试 |
| 403 + body 含 `ArgusSecurityPlugin` | `DouyinSignatureError(reason: 'argus')`，不重试（签名问题：favbase 或 SDK 变了） |
| 403 / 429 无 Argus | `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)`，不重试 |
| 200 空 body | 重试；耗尽 → `DouyinRateLimitError`（冷却） |
| 5xx / `unreachable` | 重试；耗尽 → 5xx 是 `Error`，`unreachable` 是 `DouyinUnreachableError`（与空 body **共用**一份 `MAX_RETRIES` 预算） |
| 其他非 2xx | `Error`，不重试 |
| 非 JSON（挑战页）/ 验证标记 | `DouyinRateLimitError(resetAt: null)`——用户去抖音标签页完成验证 |
| JSON 不是对象 / 无 `status_code` | `Error`（未知形状） |
| `status_code: 8` +「未登录」/ `2483` /「请先登录」 | `DouyinAuthError('missing')`（favbase 从不预先确认抖音登录，恒 `missing`） |
| 其他非零 `status_code`（含 count 超限的 `5`） | `DouyinStatusError` |
| `status_code: 0` + 列表空 + `has_more` 真 | 有失效 id（`disabled_item_ids` / `invalid_item_id_list`）→ 整页失效，继续翻；否则 `DouyinRateLimitError`（冷却）软停 |
| `has_more` 缺失或不是 bool / 0 / 1 | `Error`——没有它不能翻页，不猜 |
| `has_more` 真但 cursor 不可用 / 不前进 / 回退 | `Error`；续传段第一次请求的「不前进 / 回退」另清断点（见「断点状态」） |
| `aweme/detail`：`aweme_detail` 是对象 | `decodeDetail` → `{ kind: 'aweme' }` |
| `aweme/detail`：`aweme_detail` 为 null + `filter_detail` 带值（非空对象 / 字符串） | `{ kind: 'unavailable', reason }`——作品不可用的合法结果（docs/37 D-i：仅自己可见、已删除），不算风控 |
| `aweme/detail`：`aweme_detail` 为 null 且无 `filter_detail` | `DouyinRateLimitError`（冷却）——与列表的 F8 同形 |
| `aweme/detail`：`aweme_detail` 既不是对象也不是 null | `Error`（未知形状） |

- 合法零结果：`status_code: 0` + 列表 `[]` / `null` / 缺键 + `has_more` 假。无夹 = `collects_list: null` 有实测；`aweme_list: null` + `has_more: 0` 无直接样本 `[UNKNOWN]`，按同一规则放行。
- 验证码检测不扫用户内容：四个标记作为**键名**带非空值时任意层级命中，作为**字符串值**只在信封层算、不进 `aweme_list` / `collects_list` / `aweme_detail` 条目——否则一条讲 captcha 的视频会让整次同步以「去验证」停掉，或让那条视频的转录以「去验证」失败（docs/37 D-h）。
- 收藏接口上真实的验证形态 `[UNKNOWN]`。
- `2154` / `2156` / `10000` / `10001` 刻意不单独分类（证据弱，docs/33 §2.3），走 `DouyinStatusError`。

## 节奏与分页

- 节奏器在 `withRetries` 的 attempt 里：每次真实请求（含重试）都等页间隔、都计入 `REST_EVERY_PAGES`——风控按请求计数。
- 每次请求 2 次 checkpoint 是有意的（节奏器等待前后各一次：长休息期间按下暂停，不应在休息结束后照发请求）。与 zhihu「每页一次」不同，不是 bug。
- 403 / 429 不在请求层重试。
- 一页条数少于 `count` 不代表到底（失效作品被剔除），只看 `has_more`。
- listcollection 的 cursor 逐页递减；`'0'` 表示「从头开始」，作为**下一页** cursor 永远非法——接受它会把游走送回最新一页、循环到保险丝。两个收藏夹接口的 cursor 是递增偏移。
- `MAX_PAGES` 是**每段**的失控保险丝，触发时静默返回 `'fuse'`，不抛错。

## 同步编排

- 全部收藏条目不挂 Source，没有合成的「全部收藏」Source：它会在 chip 行与 Dashboard 细分里冒出一个假夹。所以存在零 link 的条目，查询照常返回。
- 逐页入库 + 逐页回调 `onPagePersisted`，由 app 侧逐条派发处理 lane：funnel 只在整次成功时派发，否则中途失败的运行里已入库的条目不会被派发。
- 头部段在**整页**都已知时才停，不用「首个已知 id 即停」：重新收藏的旧视频会顶到最前面，压住新的。
- 运行开头那次 `ingestCollection`（公开夹 → Source）无条件执行并带 `content`：它是本次运行保证有的那一次幽灵清扫，增量运行可能一页都不入库。别改成「有夹才调」，也别去掉 `content`。规则见 `lib/ingest/CLAUDE.md`。
- 作者 id 用 `sec_uid`（`uid` 会轮换）；`sec_uid` 为空的作品没有作者行，ingest 随之丢掉该条目。
- 抖音不给逐条收藏时间：`publishedAt` 是作品发布时间，排序因此是「最新发布」。不存播放数（网页端恒 0）。
- `listCursor` / `listIndex`（docs/33 D5）只写不读：条目首次入库时在全部收藏列表里的位置，为将来按收藏序排序留底——insert-only 下事后补不了。
- 上一条的缺口：首见于公开夹分页的条目两个都是 `null` 且不回填；「cursor = 收藏时间」`[UNKNOWN]`，所以字段名不带时间含义。
- 一页的来源只由 `PageOrigin` 一个参数说清（列表页写序位不写 link，公开夹页写 link 不写序位）；别在它旁边再叠可空参数。

## 断点状态

`DouyinBackfillState = { resumeCursor, backfillDone }`：全部收藏列表的首次全量走到了哪。存在 `local:douyin-backfill`，只由 app 侧 Sync Adapter 读写，lib 零 storage。

| 状态 | 本次运行 |
|---|---|
| `{ null, false }` | 全量走：头部段不早停，从头翻到底 |
| `{ cursor, false }` | 头部段补新（整页已知即停），再从 `cursor` 续传 |
| `{ null, true }` | 只跑头部段 |

- 只有两个字段，不要加第三个「重启回填」标志：「全量走」直接由 `!backfillDone && resumeCursor === null` 判定。加了标志位，「某页已入库、断点还没写回就中断」的运行下次会首页整页已知即停、又无断点可续，回填永远完不成。
- 先入库、后写 cursor：崩在中间只是多一次 insert-only 空跑，反过来会丢页。非全量走的头部段不改 `resumeCursor`。
- 任一段走到 `has_more: 0` → `{ null, true }`。
- 续传段只在本次以断点开跑时运行；全量走撞保险丝的那次运行不接着续传，下次再续。
- **清断点只发生在续传段第一次请求**（携带存储断点的那次，含其重试）：被扣页（无失效 id）、`DouyinStatusError`、或返回的 cursor 没越过断点 → 写回 `{ null, false }` 再抛原错误，下次全量走。
- 上一条的原因：存储的 cursor 跨天是否有效 `[UNKNOWN]`，不清的话续传会永远卡死（UI 无重置入口），代价是多一次全量。
- 续传段第 2 页起、以及头部段的同类失败**不**清断点：那里用的是服务端刚给的 cursor，失败多半是真风控，清空等于在被限流时安排一次全量重走。
- 存储的 `resumeCursor` 在 lib 边界校验（`decodeCursor`）：不是纯数字串就当 `null`，否则会在游走里以 `BigInt` 的 `SyntaxError` 冒出来。
- 中途抛错：已入库的保留，断点停在最后一页成功入库之后；没切块的条目由后面任意一次清扫治愈。
- 已知限制：非全量走的头部段若一次新增超过 `MAX_PAGES` 页撞保险丝，那一段之后的条目不会被补上。
