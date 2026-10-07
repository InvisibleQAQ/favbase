# lib/douyin

抖音收藏收录领域（docs/33）。同步登录用户的**全部收藏**，`status === 1` 的公开收藏夹是 Source；正文 = 作品 `desc`，同步时即得。app 侧接线（标签页门、断点读写、逐页派发）见 `entrypoints/app/sections/douyin/CLAUDE.md`。

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

## 坑

- 本目录非测试文件里不要写含「斜杠 + 星号」的字符串字面量（如 URL 匹配模式）：env 常量守卫与裸 fetch 守卫用朴素正则剥块注释，这种字面量会把其后到下一个块注释结尾之间的代码从扫描里藏起来。标签页 URL 因此从 descriptor 的 `hostPermissions` 读。

## 失败形态 → 动作

按形态分类，不按状态码表（`classifyResponse` + 分页解码）；绝不信任 200。

| 形态 | 动作 / 错误 |
|---|---|
| `sdk-not-ready` | `Error`（刷新抖音标签页），不重试 |
| 403 + body 含 `ArgusSecurityPlugin` | `Error`，不重试（签名问题：favbase 或 SDK 变了） |
| 403 / 429 无 Argus | `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)`，不重试 |
| 200 空 body | 重试；耗尽 → `DouyinRateLimitError`（冷却） |
| 5xx / `unreachable` | 重试；耗尽 → `Error`（与空 body **共用**一份 `MAX_RETRIES` 预算） |
| 其他非 2xx | `Error`，不重试 |
| 非 JSON（挑战页）/ 验证标记 | `DouyinRateLimitError(resetAt: null)`——用户去抖音标签页完成验证 |
| JSON 不是对象 / 无 `status_code` | `Error`（未知形状） |
| `status_code: 8` +「未登录」/ `2483` /「请先登录」 | `DouyinAuthError('missing')`（favbase 从不预先确认抖音登录，恒 `missing`） |
| 其他非零 `status_code`（含 count 超限的 `5`） | `DouyinStatusError` |
| `status_code: 0` + 列表空 + `has_more` 真 | 有失效 id（`disabled_item_ids` / `invalid_item_id_list`）→ 整页失效，继续翻；否则 `DouyinRateLimitError`（冷却）软停 |
| `has_more` 缺失或不是 bool / 0 / 1 | `Error`——没有它不能翻页，不猜 |
| `has_more` 真但 cursor 不可用 / 不前进 / 回退 | `Error`；续传段第一次请求的「不前进 / 回退」另清断点（见「断点状态」） |

- 合法零结果：`status_code: 0` + 列表 `[]` / `null` / 缺键 + `has_more` 假。无夹 = `collects_list: null` 有实测；`aweme_list: null` + `has_more: 0` 无直接样本 `[UNKNOWN]`，按同一规则放行。
- 验证码检测不扫用户内容：四个标记作为**键名**带非空值时任意层级命中，作为**字符串值**只在信封层算、不进 `aweme_list` / `collects_list` 条目——否则一条讲 captcha 的视频会让整次同步以「去验证」停掉。
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
