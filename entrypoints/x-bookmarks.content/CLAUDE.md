# x-bookmarks.content

x.com 书签页（`/i/bookmarks`）右下角常驻「获取书签」浮层按钮（第二个 X 同步触发点，对标 supermemory 的页面内导入 UX，但驱动 favbase 本地 `syncBookmarks`）。与 app.html `/collections/x` 的手动同步按钮**共存**，两者调同一个 `syncBookmarks`（`lib/x/x-sync-service.ts`）。

## 为什么浮层按钮不能自己抓/自己落库

三条硬约束（见 `lib/database/CLAUDE.md` + `lib/background/port-bridge.ts`）：content script **无法直连 PGlite**（PortBridge 只放行 `chrome-extension://` 扩展页）、**读不到** webRequest 捕获的认证（`chrome.storage.session` 是 trusted-context-only，本仓未开 `setAccessLevel`）。故按钮只是 UI，把整个同步委托给 **Offscreen 文档**（它直连 PGlite + 扩展上下文 fetch 回放捕获的 header，无需 DNR）。**注意 offscreen 文档也没有 `chrome.storage`（Chrome 限制其只有 runtime 消息 API）**，认证由 background SW（webRequest 写入方）`getXAuth()` 代读后随 `OFFSCREEN_X_SYNC` 消息传入（同 `apiKey` 之于 CHUNK_TRANSCRIBE），经 background SW 中转，**镜像转录管线的 CS→bg→offscreen→tab 路由**：

```
CS  --X_SYNC_START-->  bg(handleXSyncStart, getXAuth)  --OFFSCREEN_X_SYNC{auth}-->  offscreen(runXSync→syncBookmarks(auth))
offscreen --OFFSCREEN_X_SYNC_PROGRESS--> bg(handleXSyncProgress) --X_SYNC_PUSH--> CS(浮层状态机)
```

消息契约在 `lib/x/x-messages.ts`（`X_SYNC_START`/`X_SYNC_PUSH` + `XSyncError`/`classifyXSyncError`）；offscreen 侧 `OFFSCREEN_X_SYNC*` 在 `lib/offscreen/types.ts` + `lib/offscreen/x-sync.ts`；background 侧 `lib/background/x-handlers.ts`（session→tab 映射用 `ctx.registerXSyncSession`/`resolveXSyncTab`）。

## 模块结构

- `index.ts` — `defineContentScript({ matches:['*://x.com/*'], cssInjectionMode:'ui' })`。Shadow host **只挂载一次**（`anchor:'body'`，`position:'inline'`，`ui.mount()`），不做 remove/remount——避免 x.com 重 React SPA 下的挂载竞态。是否显示按钮由 `<App/>` 内的路由判断（见下）。
- `use-on-bookmarks-page.ts` — 追踪 `location.pathname === '/i/bookmarks'`，订阅 WXT 的 `wxt:locationchange`（window 事件）+ `popstate`。仅在书签页返回 true。
- `use-x-fetch.ts` — 消息状态机：点击 → `browser.runtime.sendMessage({type:'X_SYNC_START'})` → 监听 `X_SYNC_PUSH`（fetching 更新 `fetchedCount` / done 存 result 后 5s 自动收起 / error 存 `XSyncError`）。按钮不碰 PGlite/X API。
- `App.tsx` — hooks 无条件调用（`useTranslation`/`useOnBookmarksPage`/`useXFetch`），非书签页 `return null`（shadow host 常驻但不渲染按钮）。四态文案：idle=`x.fab.fetch` / fetching=`x.fab.progress`(count 复数) / done=`x.fab.done`(count=inserted 复数) / error=`errorLabel`（auth 按 `reason` 分流：`no-token`→`x.fab.authError`「刷新页面」、`rejected`→`x.fab.authRejected`「重新登录」；rate-limit→`x.rateLimitedNoReset`、其余→`x.fab.error`）。error push 同时 `console.warn` 结构化错误到页面控制台（F12）供诊断。
- `style.css` — `:host` 固定右下角（`position:fixed !important` + `z-index:2147483647`）+ pill 按钮 + spinner。`--fb-*` token 从 `entrypoints/app/theme/theme-config.ts` 手动同步（改调色板需同步，与 bilibili CS 同约定）。

## 约定

- **认证走同一条捕获链**：background `handleXSyncStart` 用 `getXAuth()` 读 session 存储（bg 自己就是 `webRequest` 捕获的写入方，见 `lib/x/x-auth.ts`），随 `OFFSCREEN_X_SYNC` 传给 offscreen 的 `syncBookmarks(auth)`——offscreen 无 `chrome.storage` 读不了。用户在 `/i/bookmarks` 页 x.com 自身的 Bookmarks 请求即被捕获，故点击时通常已有 token；极早点击（token 未捕获）→ bg 直接推 `X_SYNC_PUSH` auth 错误（不唤起 offscreen）→ 浮层显示 `x.fab.authError`（刷新重试）。**未采用同源 fetch 优化**（drop webRequest+DNR）——列为未来项。
- **i18n**：浮层文案全部 `x.fab.*`（zh/en 齐全，`progress`/`done` 有 `.one` 复数变体），无硬编码 CJK（`tests/i18n-no-hardcoded.test.ts` 守卫 `entrypoints/**/*.tsx`）。
- **SPA 挂载纪律**：不 anchor x.com 内部选择器（固定定位不依赖页面 DOM），故无需 bilibili 那样的 remount 轮询；路由感知在 React 层（`useOnBookmarksPage`）。
- **长同步与 SW 存活**：offscreen 每页发 `OFFSCREEN_X_SYNC_PROGRESS` 会持续唤醒 background SW，避免同步中途 SW 空闲挂起（同转录管线）。session map 为内存态，SW 若被杀则进度路由丢失（增量 stop-on-known-id 使 re-sync 很短，可接受）。
- **本路径不自动打标（docs/16 MEDIUM-2 显式欠账）**：offscreen 读不到 LLM 配置，bg 转发又受 SW 空闲回收风险；经此路径入库的推文保持无标签（app.html `/collections/x` 同步按钮路径会打标，但只覆盖它自己新插入的 item）。决策记录见 `lib/x/CLAUDE.md`。
