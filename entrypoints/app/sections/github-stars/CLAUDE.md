# sections/github-stars

GitHub Stars 收藏页（`/collections/github`），视觉结构对齐 B站收藏页（`sections/bilibili/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 语言 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/github/github-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读 GitHub API**；同步（`syncStars`）在 app.html context 跑，经 RPC proxy 写 Offscreen PGlite。

## 模块结构

- `github-stars-view.tsx` — scaffold Adapter；常驻 pipeline 为 Stars → README → Embedding/Tagging 并行。Stars 远端总量保持 unknown，README 使用真实 done/total，AI lanes 读取 background jobs；token/auth gate 隐藏 strip。phase、标签、错误翻译和卡片职责不变。
- `use-github-stars.ts` — 数据 hook：共享 `useCollectionLibrary`（`app/hooks/`，见该目录 CLAUDE.md）的薄 adapter——状态机（防抖/分页查询/refreshMeta/sync 编排）全在泛型层，本文件只注入 `queryFn`（filter→language 映射 `getStarredRepos`，starred_at 降序服务层固定）、`facetsFn=getLanguageCounts`（排除 null 语言，不能求和替代 libraryCount）、`lastSyncedFn`、`syncFn`（useCallback 闭包持 token，向 `syncStars` 注入双进度回调：stars phase 算 `estimatedTotal = round(fetchedCount/page × totalPages)` 末页收敛为精确值，readme phase 透传 `(done, total)`；`SyncProgress` 是 `phase: 'stars' | 'readme'` 判别联合）、`classifySyncError`（lib 层 `GithubAuthError`/`GithubRateLimitError` → 结构化 kind，翻译留给 view），并把泛化字段映射回 repos/language/languages 命名。**同步收尾 auto-tag/auto-embed（ST3：镜像 `use-x-bookmarks`，四平台统一 hook 层 startJob）**：`syncStars` 返回后经 `startJob('github-stars','tag'/'embed', sp=>tagNewItems/embedNewItems('github', result.newItemIds, undefined, sp))` 注册后台任务（原裸 `void` 已替换；带 done/total 进度 + 跨挂载去重 + 全局勿关页计数；job platform key=logTag `'github-stars'`，领域函数收 DB 判别符 `'github'`）——触发点必须在本 hook（lib/github 不 import storage/tagging/embedding barrel，token 传参约定同理）。**token 门在 adapter**：`sync` 外包一层无 token 静默 no-op（不翻 syncing 状态）；`hasToken`/`settingsLoading` 来自 `useSettings().settings.githubToken`（唯一读 settings 的 adapter）
- `language-chips.tsx` — 语言 chip 行：共享 `ChipRowShell`（github icon + `githubStars.languagesTitle`）+ `FilterChip`（maxWidth 220），本文件保留内容逻辑——「全部(N)」chip + 各语言(count)（服务层已按数量降序），chip icon 为语言色点 `LanguageDot`。库空时由 view 隐藏整行
- `repo-card.tsx` — 仓库卡片（不复用 VideoCard）：owner 头像（Avatar，无图回退 GitHub icon）+ full_name（2 行截断）+ description（2 行 clamp）+ 底部行（语言色点+名、`mdi:star`+`formatCompactNumber(star数)`、`formatDateTime(starredAt)`）+ 标签行（共享 `TagRow`（`components/tags/`），CardActionArea **之外**防误触 `window.open` 跳转；`tags?` undefined 时整个区域不渲染（向后兼容），`[]` 时只显示编辑按钮）。`RepoCardProps { repo, tags?, onEditTags? }`。点击 `window.open(htmlUrl)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `tagged-repo-card.tsx` — `TaggedRepoCard`：TaggedItemGrid `renderCard` 的 GitHub 卡片 adapter。`toGithubRepoItem` 把平台无关 `TaggedItem` 映射回 `GithubRepoItem`（htmlUrl 取 `item.originalUrl`；platformMeta 收窄委托 sync-service 导出的 `narrowGithubMeta`（SSOT，mapRow 与本 adapter 共用），本文件只装 envelope 字段 + spread）。**adapter 知识归 adapter**：`GithubRepoItem` 类型导入只在本文件
- `language-colors.ts` — 常见语言 → GitHub linguist 品牌色小色表（TS/JS/Python/Go/Rust/Java/C/C++ 等，未知回退灰）。**数据常量非主题色**（双模式恒定，同 flagpack 国旗色值），不受「禁止 raw hex」约束

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 语言主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 starred_at 降序（MVP 无排序控件）；platformMeta 形状见 `lib/github/CLAUDE.md`
- 三种空态：无 token（引导设置）/ 库空（引导同步）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`（`components/collection/`，`varAlpha(grey['500Channel'], 0.24)` 暗色安全边框，全平台统一）
- 路由/导航：`main.tsx` 路由 `collections/github` + `nav-config.tsx` Collections children 叶子（`nav.githubStars`）；兄弟叶子 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配）
- AI 后处理仍由 `use-github-stars.ts` 在 sync 收尾注册 `github-stars:embed|tag` jobs；view 只把 jobs 交给共享 pipeline Adapter。领域 platform `'github'` 与 job namespace `'github-stars'` 继续分离。
