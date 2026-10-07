# lib/bookmarks

浏览器书签收录领域：读本地 `chrome.bookmarks` 树入库，再由提取管线抓书签网页 → Defuddle 转 Markdown → 切块。没有远程凭证，所以没有 auth / rate-limit 错误类，平台接入契约的凭证半边不适用（`.trellis/spec/frontend/platform-onboarding.md`）。

## 信任边界（抓取与解析）

- 任意站点的 fetch 只在 background SW 执行。app.html 经 `lib/background/client.ts` 的 `sendBackgroundMessage({ type: 'FETCH_BOOKMARK_PAGE', url })` 请求，由 client 负责 envelope 与 `FetchPageResult` 的 runtime decode。
- 禁止直接 `browser.runtime.sendMessage`，禁止把响应强转成 `FetchPageResult`；也不要在 app.html 侧直接调 `fetchBookmarkPage`（底层 `fetchFn` 只给网络模块单测用）。
- 第三方 HTTP 响应必须在没有 Document 的 SW 里读，第三方 HTML 必须用 `linkedom` 的 inert DOM 解析。两半缺一不可：HTTP `Link` hints 在正文解析前就生效，HTML 里的 `<link>` / script / media 在解析阶段生效。
- 提取 fetch 必须 `credentials: 'omit'`：`<all_urls>` host 权限下 fetch 默认携带用户 cookie。
- `<all_urls>` 是已接受安装警告与 CWS 深审的决定（书签可以指向任意站点，SingleFile 先例）。
- `linkedom.parseHTML` 必须传入自带的无布局 `getComputedStyle`：否则 linkedom 的 `defaultView` 代理会落到宿主的 `window.getComputedStyle`（branded 方法；inert 文档本来就没有布局和 computed style）。
- 决不经 linkedom 的 `defaultView` 代理赋值：它的 setter 会改写 `globalThis`。
- `extractMarkdown` 必须传 `url`：inert document 没有 base URL，相对链接靠 Defuddle 的 `url` 选项解析。
- Defuddle 只用同步 `parse()`。`parseAsync` / `fetchAsyncVariables` 的站点 extractor 会去请求第三方 API，其中 B 站 extractor 还会回退到会串字幕的非 wbi `x/player/v2`（docs/29 §3「连带影响」）；换异步入口之前必须先处理。
- Defuddle 对非文章页会回退成整个清洗后的 `<body>`，所以「无正文」靠字符阈值判定（SPA 壳、challenge 页、落地页）。
- 调 Defuddle 前移除无法解析的 `application/ld+json` 节点（坏的 schema.org 数据会让 Defuddle 报控制台错误）；合法的 JSON-LD 保留。
- `defuddle/full` 内嵌自己的 Turndown 规则，与 zhihu 的独立 `turndown` 依赖并存是依赖内嵌，不是 copy-paste，别去「去重」。

## 同步与提取

- 去重键是 `normalizeUrl` 的结果（即 `platformItemId`），不是 chrome 节点 id：节点 id 跨设备不稳定。
- 文件夹 = Source，`platformSourceId` 是 chrome 文件夹节点 id（profile 内稳定）。删掉重建的文件夹得到新 id → 新 Source，旧的保留（已接受）。
- 没有直接书签的文件夹不建 Source（含只含子文件夹的）；非 http(s) 书签在扁平化时就过滤掉。
- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`：删除的书签不删行、标题不刷新、跨文件夹移动保留双 link。唯一 upsert 是 `sources` 文件夹行（`title` / `platformMeta.path` / `lastFetchedAt`，文件夹重命名经此反映）。
- 新书签以 `'pending'` 入库等待提取。永久失败（死链、429 以外的 4xx、非 HTML、空正文、内网 URL）→ `'no_content'`；瞬时失败（5xx、429、超时、网络）保持 `'pending'`，下次再试。
- 提取成功的正文不刷新、不重抓（insert-only 快照，有意决策）。
- `'chunked'` 不许没有 chunk 行：`saveBookmarkContent` 返回 chunk 行是否真实落库，只有 `true` 才能进 `chunkedItemIds` 并触发 `onItemExtracted`；零 chunk 一律落 `'no_content'`。
- 写正文并落定状态只经 `lib/ingest` 的 `settleItemContent`（`saveBookmarkContent` 是它的薄包装），不要在本目录另写一份。
- 提取队列同时领取 pending 与「已有 `item_contents`、缺 `item_chunks`」的幽灵行；后者从已存正文重建，不重抓网页。
- 提取 worker 串行；`control` 的 checkpoint 在每条 item 领取前执行，暂停与 abort 都保持 item 边界。每条落定后发 `item-content-updated`。
- `getFolders` 按 `createdAt`（树序）排、不计数，形状与 `sourceItemCounts` 不同，刻意不走它。
- `platformMeta` 形状：`{ domain, dateAdded }`（`dateAdded` 是 ms epoch）。唯一 decoder 是 `narrowBookmarkMeta`，唯一 Row mapper 是 `toBookmarkItem`（查询与 `sections/bookmarks` 的 tagged card 共用）。
- decoder 的回退：`domain` 缺失回退 `authorName`，`dateAdded` 缺失回退 `publishedAt`（同步把两对都写成同值）；不要回退成 `null`。
- favicon 不入库，UI 用 MV3 本地 `_favicon` API 渲染。
- `SyncBookmarksResult` 与 `lib/x` 的同名类型刻意不改名：统一只发生在 app 侧 adapter 的 `PlatformSyncOutcome`。
