# lib/zhihu

知乎收藏收录领域：拉取当前登录用户的全部公开收藏夹及其条目，正文经 turndown 转 Markdown 入库。

## 认证与请求

- 认证是 cookie 直读：扩展 context 的 fetch 带 `credentials: 'include'` + host permission，浏览器自动附带知乎会话 cookie。无 webRequest 捕获、无 `chrome.cookies`、无 Connections 卡、无 session key。
- favbase 从不在请求前检查知乎登录态，所以 `ZhihuAuthError` 的 reason 恒为 `'missing'`。
- 收藏夹相关 API 不校验 `x-zse-96` 签名；唯一特殊 header 是 v4 items 端点的 `x-api-version`。
- Referer 从 fetch 设不了（forbidden header），也没做 DNR 改写。知乎是否硬要求 Referer [UNKNOWN，待实测]；若是，加 `public/rules.json` 的 DNR 规则。
- `/api/v4/me` 的 200 响应是否总带 `url_token` [UNKNOWN]；缺失时抛 Error，不猜。
- 只收公开收藏夹：`is_public` 为 `false` / `0` 的夹被过滤。该字段的形态未证实，缺失时按公开处理。
- 严格串行 + 页间抖动。不要抄 RSSHub 的 `Promise.all` 并发：403 限流真实存在。
- 403 是反爬的主要形态，不重试，直接抛 `ZhihuRateLimitError`；知乎没有 reset header，`resetAt` 恒 null。429 与 5xx 经 `withRetries` 共用一份预算。
- `fetchZhihuJson` 刻意不把 `control` 传给 `withRetries`：分页调用方每页已 checkpoint 一次，传进去就翻倍（`zhihu-api.test.ts` 的「fetchCollectionItems cooperative control」锁住）。
- HTTP 200 决不盲信：200 + 非 JSON body（challenge HTML）、`error` body 或无 `data` 数组，一律抛带 body 片段的 Error，绝不吞成空数组。
- 条目分页的停止条件有三重（`paging.is_end`、`totals`、空页），收藏夹列表防御式跟随 `paging.next`；别精简成一个条件。
- 全量重拉，没有增量 stop-on-known-id。

## 归一化与入库

- `platformItemId = '{type}:{id}'`：answer / article / pin / zvideo 四种类型的 id 命名空间互相独立，裸 id 会碰撞。
- 四种类型各取哪个字段作标题、URL、正文、时间，只在 `zhihu-api.ts` 的 `mapCollectionItem`；新类型加在那里。
- 未知 type、缺 id、缺 content 的条目返回 null 跳过（知乎随时可能加类型），不要抛错中断同步。作者缺失回退 `anonymous`。
- `publishedAt` 是内容自身的 updated / created 时间，不是收藏时间：web v4 items 不给收藏时间。
- zvideo 与空正文 → `'no_content'`。不要用 `'pending'`：那会把条目喂给 auto-transcribe。
- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`：取消收藏不删行，条目跨夹收藏 = 1 item + N link，唯一 upsert 是 `sources` 收藏夹行（`title` / `lastFetchedAt`）。
- 同步不 inline embed：chunk 写成即 `'chunked'`，embed / tag lane 由 app 侧 Sync Adapter 经 Platform Sync funnel 派发。本目录不 import tagging / embedding。
- 共享查询片段在 `lib/database/collection-queries.ts`，勿在本目录再拷贝。
- `platformMeta` 形状：`{ type, excerpt, authorName, avatarUrl, thumbnailUrl, collectionId, collectionTitle }`。`collectionId` / `collectionTitle` 是首见归属，只供卡片展示；按收藏夹筛选一律走 `item_sources`。
- 唯一 decoder 是 `narrowZhihuMeta`（未知 type 回退 `answer`），唯一 Row mapper 是 `toZhihuFavoriteItem`（分页查询与 `sections/zhihu` 的 tagged card 共用）。

## 坑

- `zhihu-markdown.ts` 的 turndown 依赖 DOM（app.html 用真实 document，vitest 用它内置的 domino）：不要把它放进 background SW 的执行路径。同步因此只在 app.html 页面 context 跑。
- `htmlToMarkdown` 转换失败时降级为 `stripHtmlToText`，不中断同步。
- 知乎正文 HTML 的怪癖都在 `zhihu-markdown.ts` 处理：图片真实地址在懒加载属性里且带尺寸后缀，公式是 data-URI 占位图（LaTeX 在 alt），`noscript` 里有重复图，外链包了一层 `link.zhihu.com/?target=`。
- 剥图片尺寸后缀只用 `zhihu-api.ts` 导出的 `stripImageSizeSuffix`，不要在别处再抄一份。
- 不做：私密收藏夹、他人的收藏夹。
