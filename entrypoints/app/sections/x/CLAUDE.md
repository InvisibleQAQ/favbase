# sections/x

X（Twitter）书签收藏页（`/collections/x`，扁平单集合，无详情路由）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel、状态组件）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection-states/CLAUDE.md`；这里只记 X 的不同之处。

## 约束

- 凭据没有 UI：无 Connections 卡、无 `UserSettings` 字段。会话由 background 从用户浏览 x.com 的真实请求里捕获（`lib/x/x-auth.ts`），所以空态与未登录态都把「打开 X 书签页」排在获取按钮前面——用户得先访问 x.com。
- `x-sync-adapter.ts` 先 `getXAuth()`；没有会话就在 Platform Sync funnel **之前**抛 `XAuthError('missing')`：读 storage 就能判定，不算尝试、不写 Platform Sync Record（docs/32 §5.2）。
- storage 读取必须留在 adapter：lib 的 `syncBookmarks` 只收显式 `XAuth`、自己不碰 storage（它要在没有 `chrome.storage` 的 offscreen 里也能 import）。
- 未登录态有两套文案，由 view 按 `reason` 选键：`'missing'` → `x.notLoggedIn*`，`'rejected'`（X 拒绝了已捕获的会话）→ `x.sessionRejected*`。共享状态组件不认识 `reason`。
- 同步只由按钮触发，不在挂载时跑（限流远程端点）。X 同步的唯一入口是 app.html：x.com 页面上不放同步按钮，别加回来。
- 冷却是 X 专属：成功同步后锁获取按钮 `COOLDOWN_MS`（值归 `lib/x/cooldown.ts`）。锚点是 Platform Sync Record 的 `last_success_at`，所以失败的同步不锁按钮、刷新后锁仍在。逻辑留在 `use-x-bookmarks.ts` + `cooldown.ts`，不要搬进共享 `useCollectionLibrary`。
- 按钮锁取冷却与限流 reset（`XRateLimitError` 带 `resetAt`）中较晚的一个；只锁标题栏按钮，空态 / 未登录态里的获取按钮不受锁。
- `xAutoSyncPolicy` 也查冷却：daily 闸门按自然日算，23:58 同步后 00:01 的评估否则会落在冷却窗里。
- 「本次新增 N」读 Platform Sync Record 的 `last_inserted`，按 sync job 的 `generation` 重读（只在成功时变，自动同步完成也会刷新）。只有本页显示；扩到其他平台是未排期的新功能，不是遗漏（docs/32 Step 6 D-e）。
- 推文正文经 `normalizeTweetText` 把连续空行压成一个换行，不要改用 `pre-wrap`：否则行数 clamp 里会出现孤立的「…」行。

## 指针

- `platform_meta` 形状、会话捕获与分页防风控：`lib/x/CLAUDE.md`。
- 测试：`x-sync-adapter.test.ts`、`cooldown.test.ts`。
