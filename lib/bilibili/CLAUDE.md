# lib/bilibili

B站领域层：公开收藏夹同步、字幕获取（Main World 拦截优先，API 降级）、转录落库 seam。字幕串行事故的完整诊断与证据在 `docs/29`。

## 字幕获取与归属校验（`fetchSubtitle` / `ownsSubtitleUrl`）

- 字幕列表只走不签名的 `x/player/wbi/v2`。非 wbi 的 `x/player/v2` 会给已登录请求返回别的视频的 AI 字幕（docs/29 C1），任何调用点都不许换回去。
- wbi/v2 目前不需要 WBI 签名；B 站日后对它返回 -352 / -403 才需要加。签名、rows 指纹、删掉 Content Script 的 API 降级等路径都已否决，清单与理由在 docs/29 §4，别重提。
- 拉 CDN 前用 `ownsSubtitleUrl` 校验响应里的每一条轨道，不只是选中的那条：被选中的中文轨可能是不声明归属的翻译轨，只有旁边的原始轨说得出这份响应属于谁。
- 归属标记有三态。原始 AI 轨文件名 `{aid}{cid}{md5}` 声明归属：只比前缀 + 32 位 hex 尾巴，不按数字切分（md5 可能以数字开头）；`aid` 缺失时这类名字 fail-closed。
- 两类名字不声明归属、放行：不在 `/bfs/ai_subtitle/prod/` 下的 URL（上传者 CC）与恰为 32 位 hex 的裸名（机器翻译轨）。把裸名当外来会误拒所有翻译中文轨（docs/29 Step 1b）。
- 任一轨声明属于别的视频即整批拒收：返回 `status:'error'`、不请求 CDN。错判的代价是一次 ASR，漏判是数据损坏；别降级成「仅日志」。日志点名那条轨时不带 `auth_key`。
- 已知残留：响应里没有任何轨声明归属时整批放行，外来的也照收；B 站换 URL 形状时校验会静默失效（docs/29 Step 1b「残留」、§7）。
- 比对键里的 `cid` 取自我们自己的请求，不取自响应（`aid` 只能从响应拿）：整份外来的响应也因此对不上。
- `need_login_subtitle:true` 且无轨道时仍返回 `no_subtitle`（调用方照旧降级 ASR）；UI 提示未做（docs/29 §8）。
- 字幕 / cid 路径返回 status 对象、不抛错；只有收藏夹接口抛 `BiliAuthError` / `BiliRateLimitError`。
- `bilibili-transcription-adapter.ts` 的字幕重试循环重试的是抛出的异常与 `status:'error'`，耗尽返回 `null` 让管线落 ASR；形状与 `lib/http/retry.ts` 的 `withRetries` 不同，刻意不迁入。
- 休眠的非 wbi 调用点：`defuddle` 的 B 站 extractor 在 wbi/v2 无轨道时回退 `x/player/v2`，只经异步入口 `parseAsync` / `fetchAsyncVariables` 可达，今天无人调用（docs/29 §3「连带影响」；`lib/bookmarks/CLAUDE.md`）。
- 守护测试 `bilibili-api.test.ts`，夹具取自真实响应；改规则时别用自造的文件名。

## B 站认证

- 所有 B 站请求一律 `credentials: 'include'`，不手拼 `Cookie` header（docs/29 Step 4）。登录态来自 cookie jar：Content Script 与 `api.bilibili.com` 同站，app.html 与 Background SW 靠 host permission（docs/29 §9.5）。
- `getBiliAuth()`（`chrome.cookies` 读 SESSDATA / DedeUserID）不进任何请求。用途只有两个：无网络的登录判定（`checkAuth()`、daily auto-sync 的 `probeReady`）与 `fetchFavFolders` 的 `up_mid`。
- `fetchFavVideos` 不收 auth，但它的两个调用方（`fetchFavoriteVideosPage`、`syncAllFavoriteVideos`）仍先 `await checkAuth()`。那是门，不是凭据，别当死代码删：公开夹匿名可读，删掉它登出用户照样能浏览和同步。
- 这道门由 `bili-sync-service.test.ts` 的两个「refuses to … without a Bilibili login」用例锁住。
- 收藏夹请求必须保持登录态：匿名 `list-all` 返回 `data: null`（docs/29 §9.5）。`credentials: 'omit'` 路线已否决，别重提。
- `BiliAuthError` 的 `'missing'` = 本地无 SESSDATA（`checkAuth()`），`'rejected'` = 过了那道门后 API 仍回 `-101`。
- 收藏夹接口收到 HTTP 412（风控拦截）抛 `BiliRateLimitError`，`resetAt` 恒 null。JSON 层风控码（HTTP 200 里的 `-352` / `-412`）是否出现 [UNKNOWN]，目前只认 HTTP 412。

## 收藏夹同步

- 只做公开收藏夹（用户决定，`CONTEXT.md` Flagged ambiguities）：`fetchFavFolders` 在 API 层按 `attr & 1` 滤掉私密夹，下游都看不到它。过滤放 API 层而非 sync-service，因为「favbase 看得见哪些夹」是平台事实。
- 已知残留两处：已入库的私密夹条目不追溯删除；手输 `#/collections/bilibili/<私密夹 id>` 仍能只读浏览（`fetchFavVideos` 不加第二道过滤，UI 从不生成这种链接）。
- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`，守护测试 `videos-sync.test.ts`。本平台的有意例外：`sources` upsert、`items.contentState` 推进、`item_contents` / `item_chunks` 重转录重建。
- 浏览与入库分离：`fetchFavoriteVideosPage` 只读当前 UI 页、不入库；只有显式同步才遍历全部公开夹（空关键词、`mtime` 序）。
- 每页 durable 写入后才取下一页。后页失败保留前页，但该 Source 不写 `videos_sync_complete`；缺这个标记的夹下次强制全量回填（insert-only 使重试安全）。
- `syncFavFoldersToDb` 刷新 Source 的远端字段时必须保留本地写的 `platformMeta.videos_sync_complete`。
- 已完成历史的夹按该 Source 自己的 BVID 集合增量截断（source-scoped，大小写无关）：视频在别的夹里已入库不算已知。
- 新增 membership 不算新条目：`newItemIds` 只含真正 inserted 的视频，否则会触发重复转录。
- app runtime 只经 `syncAllFavoriteVideos` 的 durable callback 消费新条目，subscriber 抛错不能让 Fetch 失败。service 不 import app job store，adapter 不反查 favorites page 或 pending。
- 页间延迟（`VITE_BILIBILI_PAGE_DELAY_*`，默认 7–10 s 抖动）调小有 HTTP 412 风控风险，出过事故。

## 失效视频与 `platform_meta`

- 失效视频（`attr=9`）既不能转录也不能进 Embedding / Tagging，但首次入库照存。判定只许调 `isProcessableVideo` / `bilibiliDownstreamEligibleSql`（`video-eligibility.ts`），别处禁止裸写 `9`。
- 内存判定与 SQL 谓词必须同语义（缺失的 `attr` 视为可处理），由 `video-eligibility.test.ts` 用同一组夹具锁 parity；改一边必须改另一边。
- `INVALID_VIDEO_ATTR` 是 B 站协议事实，不是可调参数：不经 `envNumber`（`tests/platform-env-constants-guard.test.ts` 的显式允许项）。
- `video-eligibility.ts` 是 item `platform_meta` 形状的唯一 owner：写侧 `satisfies BiliItemMeta`，读侧只经 `narrowBiliVideoMeta`，调用方不写内联 `typeof`。

## 转录落库

- 入库只有 app.html 的两个转录入口，都经 `transcribeAndPersist` 这一个 seam；视频页 Content Script 面板只写字幕缓存、不入库。
- `transcribe-utils.ts` 只是 `lib/transcription/transcribe-and-persist.ts`（docs/37 D-c）绑定 `platform: 'bilibili'` + `persist: persistContentChunks` 的薄包装，对外签名不变。videoId 闸门逐字节、`item-content-updated` 事件、`startProcessing` 交接、durable 后立即返回这些规则随核心搬到 `lib/transcription/CLAUDE.md`；`PersistContentResult` 的 owner 也是那里，本目录只 re-export。`transcribe-utils.test.ts` 经包装对真实 PGlite persist 测核心，不要改它来迁就核心。
- B 站专属的仍在这里：BV 号在 API 调用与消息传递里保留原始大小写（`extractBvid` 不折叠）——闸门不能放宽成大小写无关正是因为 BV 号是大小写敏感的 base58。`lib/cache/video-cache.ts` 的 `normalizeVideoId` 与 `lib/background/job-registry.ts` 把 id 转小写是已知缺陷，别照抄。
- `persistContentChunks(bvid, rows, source)` 的 `source`（`'official'|'asr'`）必须如实透传进 `item_contents.subtitle_source`，与正文同一条 upsert 写入（docs/29 Step 5）。它不是收藏夹那个 Source。
- 重复转录覆盖 content、事务重建 chunks 并把状态退回 `'chunked'`。切块只用带时间戳的 `chunkSubtitleRows`。
- 领域层不 import app queue / store，也零 value import `@/lib/embedding`、`@/lib/tagging`：Embed / Tag 经必填注入的 `startProcessing` 交给 app 层，没有 fallback。
- `bili-sync-service.ts`、`transcribe-utils.ts` 的加载图必须 storage-free，守卫 `tests/lib-import-smoke.test.ts`。
- `auto-transcribe-adapter.ts` 合法 import `@/lib/storage`（ASR 设置、quota pause），所以不在 import-smoke 清单里；它测试里的 storage mock 是功能性的，别当防御性 mock 删。
- Content Preparation durable 后 `transcribeAndPersist` 立即返回：Embed / Tag ticket 不得阻塞下一条 Transcript，`onIndexed` 只是晚到的异步通知。
- ASR 日额度耗尽只暂停 Transcript session；已 enqueue 的 Embed / Tags ticket 继续跑，adapter 不向 processing queue 传播 quota pause。
- 缺 ASR 配置时，auto-transcribe adapter 先注册 `settingsStorage.watch` 再读初值；反过来有 initial-read / watch 竞态。
- Background 转录 handler 只经 `prepareBiliTranscription` 拿平台碎片，不直接 import `bilibili-api` / `subtitle-processor`。

## 页面桥与字幕后处理

- `url-utils.ts`、`messaging.ts` 被 Main World 脚本 import，必须保持零 `chrome.*` / `browser.*` 依赖。
- 同页 `postMessage` 认证不了发送者，`messaging.ts` 只能做形状、路由和容量约束：所有输入先 decode，畸形或未知消息丢弃，不进字幕处理或缓存。
- 新增消息必须同时改 `BiliMessageMap`、Zod schema 和测试，不能只改 TypeScript union。decoder 要继续接受不带 `channel` / `protocolVersion` 的 legacy wire shape。
- `processSubtitles` 是 B 站特有的后处理（过滤点赞、投币等交互话术），每条字幕保持独立行、不合并；经 `PipelineDeps.postProcess` 注入平台无关管线，别搬进 `lib/transcription`。

## 指针

- Main World 状态机与防串台守卫：`lib/bilibili/inject/CLAUDE.md`。
- 平台目录的通用守卫（请求走 `fetchWithDeadline`、等待走 `sleep`、数值常量走 `envNumber`）：`lib/http/CLAUDE.md`、`lib/env.ts`。
- 平台错误基类：`lib/collections/sync-errors.ts`。
