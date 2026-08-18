# sections/github-stars

GitHub Stars 收藏页（`/collections/github`），视觉结构对齐 B站收藏页（`sections/bilibili/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 语言 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/github/github-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读 GitHub API**；同步（`syncStars`）在 app.html context 跑，经 RPC proxy 写 Offscreen PGlite。

## 模块结构

- `github-stars-view.tsx` — scaffold Adapter；常驻 pipeline 为 Fetch → README → Embedding/Tagging 并行。Search 后注入共享 provider Configuration Blocker notice；token 整页配置门仍优先。Fetch/README/runtime、phase、标签和错误职责不变。
- `github-sync-adapter.ts` — 共享 Sync Adapter（audit #6）：`runGithubStarsSync(onProgress, control)` 单点定义「github 同步成功意味着什么」——settings token 解析（无 token 静默 no-op）、Stars/README 两阶段进度映射（`ReadmePhaseProgress` 携带 `fetchedCount` 供 view 保留 Fetch 完成值）、同步收尾把 `newItemIds` 一次交给 `startCollectionProcessingJobs`（job namespace 经 `jobPlatformForCollection` SSOT，`'github-stars'` 与领域 platform `'github'` 分离）。手动页面 `syncFn` 与 daily auto-sync registry 引用**同一函数**；进度类型（`SyncProgress` 等）在此定义。契约测试 `github-sync-adapter.test.ts`
- `use-github-stars.ts` — 数据 hook：共享 `useCollectionLibrary` 的薄 adapter；`syncFn` 直接引用 `runGithubStarsSync`（模块级引用稳定），并 re-export 进度类型供 view。token UI 门（无 token 时 `sync()` 静默 no-op）、query/facets/lastSynced/error classifier 留在本 hook。
- `language-chips.tsx` — 语言 chip 行：共享 `ChipRowShell`（github icon + `githubStars.languagesTitle`）+ `FilterChip`（maxWidth 220），本文件保留内容逻辑——「全部(N)」chip + 各语言(count)（服务层已按数量降序），chip icon 为语言色点 `LanguageDot`。库空时由 view 隐藏整行
- `repo-card.tsx` — 仓库卡片（不复用 VideoCard）：owner 头像（Avatar，无图回退 GitHub icon）+ full_name（2 行截断）+ description（2 行 clamp）+ 底部行（语言色点+名、`mdi:star`+`formatCompactNumber(star数)`、`formatDateTime(starredAt)`）+ 标签行（共享 `TagRow`（`components/tags/`），CardActionArea **之外**防误触 `window.open` 跳转；`tags?` undefined 时整个区域不渲染（向后兼容），`[]` 时只显示编辑按钮）。`RepoCardProps { repo, tags?, onEditTags? }`。点击 `window.open(htmlUrl)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `tagged-repo-card.tsx` — `TaggedRepoCard`：TaggedItemGrid `renderCard` 的 GitHub 卡片 adapter。`toGithubRepoItem` 把平台无关 `TaggedItem` 映射回 `GithubRepoItem`（htmlUrl 取 `item.originalUrl`；platformMeta 收窄委托 sync-service 导出的 `narrowGithubMeta`（SSOT，mapRow 与本 adapter 共用），本文件只装 envelope 字段 + spread）。**adapter 知识归 adapter**：`GithubRepoItem` 类型导入只在本文件
- `language-colors.ts` — 常见语言 → GitHub linguist 品牌色小色表（TS/JS/Python/Go/Rust/Java/C/C++ 等，未知回退灰）。**数据常量非主题色**（双模式恒定，同 flagpack 国旗色值），不受「禁止 raw hex」约束

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 语言主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 starred_at 降序（MVP 无排序控件）；platformMeta 形状见 `lib/github/CLAUDE.md`
- 三种空态：无 token（引导设置）/ 库空（引导同步）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`（`components/collection/`，`varAlpha(grey['500Channel'], 0.24)` 暗色安全边框，全平台统一）
- 路由/导航：`main.tsx` 路由 `collections/github` + `nav-config.tsx` Collections children 叶子（`nav.githubStars`）；兄弟叶子 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配）
- AI 后处理由 `github-sync-adapter.ts` 在 sync 收尾 enqueue `github-stars:embed|tag` 共享 lanes（手动/自动两触发同源）；view 只通过 `backgroundJobRuntime` 适配 phase 与百分比（纯展示；暂停/继续走闸门按钮）。
