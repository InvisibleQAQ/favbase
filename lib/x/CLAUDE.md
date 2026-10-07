# lib/x

X（Twitter）书签收录领域：X 无免费官方 API，所以读 web 客户端书签页的私有 GraphQL `Bookmarks` 操作，回放从真实请求里捕获的认证 header。防风控是一等需求。

认证与请求构造照搬 supermemory 浏览器插件（`supermemory/apps/browser-extension`）；改动这两部分之前先对照它。

## 认证（webRequest 捕获 + 原样回放）

- 认证来自 background 的 `webRequest.onBeforeSendHeaders`（注册在 `entrypoints/background.ts`，只观察不拦截）：`captureXTokens` 从 x.com 真实请求逐字取 `cookie` / `x-csrf-token` / `authorization`，三者齐备才写存储。
- 三个 session key（`session:x-cookie` / `session:x-csrf` / `session:x-auth`）注册在 `lib/storage/keys.ts`，读写方只有 `x-auth.ts`。浏览器关闭即清空，所以用户须在本 session 访问过 x.com 才有凭据。
- 不要改回 `chrome.cookies` 读 `ct0` + `auth_token` 再手拼：X 对残缺 cookie 返回空或拒绝，一条书签都抓不到。
- fetch 决不传 `credentials` 选项，尤其不是 `'omit'`：`omit` 会让 Chromium 把显式设置的 `Cookie` header 整个丢掉，X 收到无 cookie 的请求 → 401 / 403。
- 不需要 DNR 规则改写 Origin / Referer：有 host permission 的扩展 fetch 被当 same-site，Chromium 也不把 `chrome-extension://` referrer 发给 web origin。别加回来。
- `x-client-transaction-id` 刻意省略，靠 pacing + backoff + 增量兜底。
- webRequest filter 由 `PLATFORM_DESCRIPTORS.x.hostPermissions` 派生（import descriptor 文件，不走 `lib/collections` barrel）；x 新增 host permission 时捕获范围随之扩大。
- `getXAuth()` 只能在 storage-capable context 调（扩展页、background SW）。`x-sync-service.ts` 自身零 storage 访问：auth 由调用方解析后传入，`syncBookmarks` 只收非空 `XAuth`。
- 「会话未捕获」由 app 侧 `x-sync-adapter.ts` 在 Platform Sync funnel 之前抛 `XAuthError(…, 'missing')`（不算尝试、不写记录）；本目录只抛 `'rejected'`（401 / 403）。两者的用户动作不同：打开 x.com 让扩展捕获 vs 重新登录。
- 无 Connections 卡、无 `UserSettings` 字段：登录态只在同步时校验。

## 请求与响应

- 列全部书签必须用 `Bookmarks` 操作。`BookmarkSearchTimeline` 是书签搜索，它的 `querySource` 是服务端校验的枚举，不能用于 list-all。
- queryId 与 `TWITTER_API_FEATURES` 硬编码（取自 supermemory），不发 `fieldToggles`，不在运行时解析 queryId。X 会轮换 queryId 但旧 id 长期保活；sync 抛 404 或 queryId 错误时，从实时的 x.com 书签请求刷新这两个常量。
- HTTP 200 决不盲信：X 把服务端拒绝当 200 返回。`fetchPageWithBackoff` 对含非 88 错误码的 `errors[]`、以及既无 `errors` 也无 `data.bookmark_timeline_v2` 的未知形状都抛错，绝不吞成空数组。supermemory 会吞，这一处别照抄。
- 200 + `bookmark_timeline_v2` + 空 instructions 是合法的「零书签」，不抛。
- 这类抛错消息尾部带 `[queryId=…]`：一次实测报错就能判断是不是 queryId / features 需要刷新，别删。
- 非 2xx 的 Error 附响应 body 片段：X 的错误 body 含精确诊断（如缺失的 feature 清单）。
- 防风控：严格串行、页间抖动、`x-rate-limit-remaining` 触底时主动等到 reset、429 与 `code:88` 等到 reset 后重试同一页、增量遇已知 id 即停。数值都经 `envNumber('VITE_X_*')`。
- 重试循环是 `lib/http/retry.ts` 的 `withRetries`（429、`code:88`、5xx 共用一份 `MAX_RETRIES` 预算，每次尝试前 checkpoint）；本目录不再写循环或私有的 body 片段 helper。
- `cooldown.ts` 单独成 leaf（只 import `@/lib/env`）：app 侧 `sections/x/cooldown.ts` 及其测试 import 它时不会拖进 DB 层。

## 入库

- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`：取消书签不删行、metadata 不刷新，唯一 upsert 是 `sources` 的 `'bookmarks'` 单行。共享查询片段在 `lib/database/collection-queries.ts`，勿在本目录再拷贝。
- `x-sync-service.ts` 禁止 import `@/lib/tagging` 和 `@/lib/embedding` barrel：config → storage 链在加载期触碰 `chrome.runtime`，`tests/lib-import-smoke.test.ts` 会红。`char-split`、`vector-store` 的 leaf 导入不受限。
- 单一触发点是 app.html 的 Sync Adapter（手动按钮与 daily auto-sync 同一函数），返回后由 Platform Sync funnel 派发 embed / tag lane，所以恒打标、恒 embed。x.com 页面浮层触发点已删除，不要加回；auth 捕获链与它无关，必须保留。
- 同步不 inline embed（数千书签会打爆 embedding provider）：chunk 写成即 `'chunked'`，向量化由 embed lane 排空积压。
- 增量同步遇已知 id 即停，所以写 chunk 中途断掉留下的幽灵不会出现在下一批里，靠 ingest 的 sweep 从已存 `plainText` 重切（`lib/ingest/CLAUDE.md`；`x-sync-service.test.ts` 有复现用例）。
- 推文切块用 `charSplit(text, { preferParagraph: false })`（只认句末标点），与其余平台的 `paragraphSplit` 不同是刻意的，不要统一。
- `platformMeta` 形状：`{ text, authorHandle, authorName, avatarUrl, media: [{ type, url }], likeCount, retweetCount, replyCount, lang }`。
- 唯一 decoder 是 `narrowXMeta`，唯一 Row mapper 是 `toXBookmarkItem`（分页查询与 `sections/x` 的 tagged card 共用），改形状只动这一处。`text` / `authorName` 的回退只在值非 string 时触发，空串保留。
- 不做：Premium 书签文件夹（一律当扁平单集合）、写或删书签、媒体下载、thread 展开、多账号。
