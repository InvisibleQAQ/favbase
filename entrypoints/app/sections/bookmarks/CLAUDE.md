# sections/bookmarks

浏览器书签收藏页（`/collections/bookmarks` + `/collections/bookmarks/:folderId`）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection/CLAUDE.md`；这里只记书签页的不同之处。

## 约束

- 路由是文件夹的唯一事实源：`folderId` 经 `controlledFilter` 注入，`useBookmarks` 的返回类型刻意去掉 `filter` / `setFilter`（受控模式下 `setFilter` 是 no-op），chip 点击走 `navigate`。
- 文件夹是带「全部」chip 的可选筛选，不是必经层级（bilibili 相反）：`:folderId` 不进面包屑，默认路由也不自动跳到第一个文件夹（docs/25 Step 8）。
- 挂载即同步，是各平台里唯一不等按钮的：本地数据，无凭据、无限流。`startJob` 去重让它与获取按钮、daily 协调器互不冲突。这个触发留在 `use-bookmarks.ts`，不进共享 hook。
- 同步成功后自动链式启动正文提取（`startBookmarkExtraction`）。没有平台私有的启停按钮，提取面板只展示进度；暂停 / 继续只归 per-platform 闸门。
- 链式调用在 funnel 成功返回之后、funnel 之外：抓书签网页不是联系平台，不属于 Platform Sync。
- adapter 用动态 `import('./use-bookmark-extraction')`，别改成静态：adapter 被 app 根的 daily registry 静态引用，静态 import 会把 defuddle / linkedom 拖进启动 chunk。
- adapter 交给 funnel 的 `newItemIds` 恒为 `[]`，funnel 因此只补跑 embed 积压：提取只领 `'pending'`，早前中断留下的 `'chunked'` 未嵌条目只能靠这条 lane。
- 提取是独立的 `extract` job，不与元数据的 `sync` job 互相去重。每条正文落盘后立刻 enqueue embed / tag，不等整轮结束——`'chunked'` 条目不会被再次领取，中途关页会留下永不处理的条目。
- 库空用本地无按钮的 `EmptyState`，不用共享 `EmptyLibraryState`：挂载时已经同步过，库空表示一条 http(s) 书签都没有，而不是「从未同步」（docs/32 Step 6 D-c）。
- 同步错误没有凭据 / 限流两类，view 把原始 `message` 原样显示，不走 `syncErrorMessage`。
- favicon 走 MV3 本地 `_favicon` 端点（`bookmark-display.ts`，manifest 的 `favicon` 权限），不要换成第三方 favicon 服务：那会把用户的书签域名泄露出去。
- `FolderChips` 不迁到共享 `FacetChips`：形状不同（无 per-chip 计数，选中态来自路由）。

## 指针

- `use-bookmark-extraction.ts` 是 `.trellis/spec/frontend/platform-onboarding.md` §4.4「Deferred content」的模板实现。
- `platform_meta` 形状与正文提取管线：`lib/bookmarks/CLAUDE.md`。
- 测试：`use-bookmarks.test.tsx`、`bookmarks-sync-adapter.test.ts`、`use-bookmark-extraction.test.ts`。
