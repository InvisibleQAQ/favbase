# sections/youtube

YouTube 公开播放列表收藏页（`/collections/youtube`，播放列表经 chips 筛选，无详情路由）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel、状态组件）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection-states/CLAUDE.md`；这里只记 YouTube 的不同之处。

## 约束

- 凭据是 API key + 频道（无 OAuth），在设置页 Connections 的 YouTube 卡填写。`youtube-sync-adapter.ts` 导出的 `youtubeCredentials(settings)` 是「是否已配置」的唯一判定：adapter 的 run 门、`youtubeAutoSyncPolicy.probeReady` 与页面门（`useCredentialGatedLibrary`）必须读同一个函数。
- 未配置时 adapter 在 Platform Sync funnel 之前静默 return：不算尝试、不写 Platform Sync Record。
- 配置门早退分支先渲染带面包屑的 `SectionTitleBar`，再渲染 `NeedsConfigState`：早退与加载后是同一条路由，必须保持唯一 h1 和同一条面包屑。守卫 `sections/configuration-heading.test.tsx`。
- 密钥被拒（`YoutubeAuthError`）也用 `NeedsConfigState`，但多传 `sync`：用户改完设置回来可以就地重试。
- Google 不报限流 reset，所以没有 `rateLimitedUntil` 文案，也不锁获取按钮；限流文案复用 `settings.youtube.rateLimited`，不造 `youtube.*` 副本。
- 同步只由按钮触发，不在挂载时跑：有配额的远程端点，而且每次都是全量重拉（播放列表是位置序，没有增量游标）。
- 同一视频属于多个播放列表时，会出现在每个所属列表的 chip 下；chips 计数之和大于总数不是 bug。

## 指针

- `platform_meta` 形状、全量重拉与多列表 membership：`lib/youtube/CLAUDE.md`。
- Connections 卡：`entrypoints/app/sections/settings/CLAUDE.md`。
- 测试：`youtube-sync-adapter.test.ts`。
