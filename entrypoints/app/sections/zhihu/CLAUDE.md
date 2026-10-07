# sections/zhihu

知乎收藏页（`/collections/zhihu`，收藏夹经 chips 筛选，无详情路由）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel、状态组件）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection-states/CLAUDE.md`；这里只记知乎的不同之处。

## 约束

- 凭据没有 UI：无 Connections 卡，认证就是浏览器自己的知乎会话 cookie（`credentials: 'include'`）。
- 登录态不联网判断不了，所以 adapter 没有 funnel 之前的凭据检查：未登录的 `ZhihuAuthError` 在 Platform Sync funnel 里抛出，算一次尝试并记 `'failure'`。代价是登录后当天不再自动补拉，手动按钮不受限（docs/32 §5.2）。别为了对齐 X / 抖音把检查提到 funnel 前。
- `zhihuAutoSyncPolicy` 的 `probeReady` 恒为 true，靠 `isSilentError` 让自动同步遇到未登录时静默完成；手动同步的同一个错误进未登录态。
- 同步必须在 app.html 里跑：HTML 转 Markdown 用的 turndown 需要 DOM。
- 同步只由按钮触发，不在挂载时跑（限流远程端点）。
- 未登录态带「打开知乎」；库空态刻意不传 `site`（对比 X / 抖音）：应用内获取就是主路径。
- 知乎不报限流 reset，所以没有 `rateLimitedUntil` 文案，也不锁获取按钮。
- 排序用内容自己的创建 / 更新时间：知乎 web v4 的收藏条目不带收藏时间。

## 指针

- `platform_meta` 形状、四种条目类型与分页节奏：`lib/zhihu/CLAUDE.md`。
- 测试：`zhihu-sync-adapter.test.ts`。
