# sections/github-stars

GitHub Stars 收藏页（`/collections/github`），视觉结构对齐 B站收藏页（`sections/bilibili/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 语言 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/github/github-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读 GitHub API**；同步（`syncStars`）在 app.html context 跑，经 RPC proxy 写 Offscreen PGlite。

## 模块结构

- `github-stars-view.tsx` — scaffold Adapter；常驻 pipeline 为 Fetch → README → Embedding/Tagging 并行。Fetch 运行时总量 unknown，进入 README 后仍保留本次抓取数 + 100%；README 使用真实 done/total，AI lanes 读取共享 background jobs（全部纯展示——段级暂停控件已下线，运行控制归 scaffold 的闸门按钮，README 随同一 sync job 的 cooperative checkpoint 被闸门覆盖）。获取按钮文案统一 `pipeline.fetchNow`/`pipeline.fetching`。token/auth gate 隐藏 strip；phase、标签、错误翻译和卡片职责不变。
- `use-github-stars.ts` — 数据 hook：共享 `useCollectionLibrary` 的薄 adapter；`syncFn` 把 cooperative checkpoint 传给 Stars/README worker，`ReadmePhaseProgress` 同时携带 `fetchedCount` 供 view 保留 Fetch 完成值。同步收尾把 `newItemIds` 一次交给 `startCollectionProcessingJobs`，job namespace `'github-stars'` 与领域 platform `'github'` 分离。token 门、query/facets/lastSynced/error classifier 仍留在 adapter。
- `language-chips.tsx` — 语言 chip 行：共享 `ChipRowShell`（github icon + `githubStars.languagesTitle`）+ `FilterChip`（maxWidth 220），本文件保留内容逻辑——「全部(N)」chip + 各语言(count)（服务层已按数量降序），chip icon 为语言色点 `LanguageDot`。库空时由 view 隐藏整行
- `repo-card.tsx` — 仓库卡片（不复用 VideoCard）：owner 头像（Avatar，无图回退 GitHub icon）+ full_name（2 行截断）+ description（2 行 clamp）+ 底部行（语言色点+名、`mdi:star`+`formatCompactNumber(star数)`、`formatDateTime(starredAt)`）+ 标签行（共享 `TagRow`（`components/tags/`），CardActionArea **之外**防误触 `window.open` 跳转；`tags?` undefined 时整个区域不渲染（向后兼容），`[]` 时只显示编辑按钮）。`RepoCardProps { repo, tags?, onEditTags? }`。点击 `window.open(htmlUrl)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `tagged-repo-card.tsx` — `TaggedRepoCard`：TaggedItemGrid `renderCard` 的 GitHub 卡片 adapter。`toGithubRepoItem` 把平台无关 `TaggedItem` 映射回 `GithubRepoItem`（htmlUrl 取 `item.originalUrl`；platformMeta 收窄委托 sync-service 导出的 `narrowGithubMeta`（SSOT，mapRow 与本 adapter 共用），本文件只装 envelope 字段 + spread）。**adapter 知识归 adapter**：`GithubRepoItem` 类型导入只在本文件
- `language-colors.ts` — 常见语言 → GitHub linguist 品牌色小色表（TS/JS/Python/Go/Rust/Java/C/C++ 等，未知回退灰）。**数据常量非主题色**（双模式恒定，同 flagpack 国旗色值），不受「禁止 raw hex」约束

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 语言主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 starred_at 降序（MVP 无排序控件）；platformMeta 形状见 `lib/github/CLAUDE.md`
- 三种空态：无 token（引导设置）/ 库空（引导同步）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`（`components/collection/`，`varAlpha(grey['500Channel'], 0.24)` 暗色安全边框，全平台统一）
- 路由/导航：`main.tsx` 路由 `collections/github` + `nav-config.tsx` Collections children 叶子（`nav.githubStars`）；兄弟叶子 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配）
- AI 后处理由 `use-github-stars.ts` 在 sync 收尾 enqueue `github-stars:embed|tag` 共享 lanes；view 只通过 `backgroundJobRuntime` 适配 phase 与百分比（纯展示；暂停/继续走闸门按钮）。
