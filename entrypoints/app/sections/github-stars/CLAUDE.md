# sections/github-stars

GitHub Stars 收藏页（`/collections/github`）。共享骨架（scaffold、`useCollectionLibrary`、Platform Sync funnel、状态组件）的规则见 `entrypoints/app/hooks/CLAUDE.md` 与 `entrypoints/app/components/collection-states/CLAUDE.md`；这里只记 GitHub 的不同之处。

## 约束

- `github-sync-adapter.ts` 导出的 `githubCredentials(settings)` 是「是否已配置」的唯一判定：adapter 的 run 门、`githubAutoSyncPolicy.probeReady` 与页面门（`useCredentialGatedLibrary`）必须读同一个函数。
- 无 token 时 adapter 在 Platform Sync funnel 之前静默 return：不算尝试、不写 Platform Sync Record。
- 配置门早退分支先渲染带面包屑的 `SectionTitleBar`，再渲染 `NeedsConfigState`：早退与加载后是同一条路由，必须保持唯一 h1 和同一条面包屑。守卫 `sections/configuration-heading.test.tsx`。
- 没有 auth 相位（传给 scaffold 的 `authFailed` 恒为 `false`）：无 token 走配置门，token 被拒按普通同步失败显示。
- 同步是两相位（Stars → README）共用一个 sync job：进入 README 相位时 view 把 Fetch 段提前标成完成（`settledFetchRuntime`），README 段只在自己的相位里显示进度。这个特例是 GitHub 专属，留在 view，不要搬进共享 `useCollectionPipeline`。
- GitHub 会报限流 reset：带 `resetAt` 时标题栏获取按钮锁到那一刻。锁只在内存里，刷新即解。
- 同步错误文案复用 `settings.github.*`（与设置页 token 测试同一套语义），不造 `githubStars.*` 副本。
- `language-colors.ts` 里的 hex 是数据常量（linguist 语言色，亮暗两个 scheme 都不变），不受「颜色只走主题 token」约束，别替换成 palette。
- `LanguageChips` 不迁到共享 `FacetChips`：形状不同（chip 带语言色点）。

## 指针

- `platform_meta` 形状、README 拉取：`lib/github/CLAUDE.md`。
- 测试：`github-sync-adapter.test.ts`。
