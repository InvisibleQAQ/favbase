# sections/github-stars

GitHub Stars 收藏页（`/collections/github`），视觉结构对齐 B站收藏页（`sections/collections/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 语言 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/github/github-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读 GitHub API**；同步（`syncStars`）在 app.html context 跑，经 RPC proxy 写 Offscreen PGlite。

## 模块结构

- `github-stars-view.tsx` — 主视图：无 token 时整页短路为 `NoTokenState`（虚线框 + 按钮 navigate `/settings`）。内容区分支顺序：queryError → ErrorState(retryQuery)；syncError 且库空 → ErrorState(retry=sync)；metaLoading 或（syncing 且库空）→ skeleton；库空 → `EmptyLibraryState`（引导点同步，含同步按钮）；query loading → skeleton；筛选无结果 → `NoMatchesState`；否则 grid+分页。库有数据时 syncError 降级为顶部错误横幅（数据仍展示）。**i18n seam**：hook 返回结构化 `GithubSyncError`（auth / rate-limit+resetAt / unknown），模块级 `syncErrorMessage()` 在此映射为文案（复用 `settings.github.invalidToken/rateLimited(NoReset)` key，与设置页测试连接同语义）；组件内 `useTranslation()` 订阅。同步进度 `SyncProgressBar`：首页 Link header 返回前 indeterminate，之后 determinate（page/totalPages）+「已拉取 N / 约 M 个」（`githubStars.syncProgress`）
- `use-github-stars.ts` — 数据 hook（镜像 `use-bili-fav-folders` 模式，`await initDbProxy()` 幂等 join）。三组状态：分页查询（language/search/page/queryVersion → `getStarredRepos`，`PAGE_SIZE=24`，starred_at 降序服务层固定）；库元信息（`getLanguageCounts` + `getLastSyncedAt` + 无筛选 total 作 `libraryCount`——语言计数排除 null 语言，不能求和替代）；同步（`syncStars(token, onProgress)`，进度回调算 `estimatedTotal = round(fetchedCount/page × totalPages)`，末页收敛为精确值；完成后 refreshMeta + bump queryVersion 重查当前页）。搜索 300ms 防抖，值真正变化才重置 page=1（`searchRef` 比对）；语言切换同步重置 page（无二次查询竞态）。token 来自 `useSettings().settings.githubToken`；错误分类 `classifySyncError`（lib 层 `GithubAuthError`/`GithubRateLimitError` → 结构化 kind，翻译留给 view）
- `language-chips.tsx` — 语言 chip 行（交互/视觉复用 `folder-chips.tsx` 模式）：「全部(N)」+ 各语言(count)（服务层已按数量降序），chip icon 为语言色点；选中态 filled primary。库空时由 view 隐藏整行
- `repo-card.tsx` — 仓库卡片（不复用 VideoCard）：owner 头像（Avatar，无图回退 GitHub icon）+ full_name（2 行截断）+ description（2 行 clamp）+ 底部行（语言色点+名、`mdi:star`+`formatCompactNumber(star数)`、`formatDateTime(starredAt)`）。点击 `window.open(htmlUrl)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `language-colors.ts` — 常见语言 → GitHub linguist 品牌色小色表（TS/JS/Python/Go/Rust/Java/C/C++ 等，未知回退灰）。**数据常量非主题色**（双模式恒定，同 flagpack 国旗色值），不受「禁止 raw hex」约束

## 约定

- 排序固定 starred_at 降序（MVP 无排序控件）；platformMeta 形状见 `lib/github/CLAUDE.md`
- 三种空态：无 token（引导设置）/ 库空（引导同步）/ 同步失败（ErrorState+retry）；虚线框边色用 `varAlpha(grey['500Channel'], 0.24)`（暗色模式安全，替代 collections 页的静态 `grey[300]`）
- 路由/导航：`main.tsx` 路由 `collections/github` + `nav-config.tsx` Collections children 叶子（`nav.githubStars`）；兄弟叶子 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配）
- AI 标签/README/语义检索/metadata 刷新/unstar 删除均 out of scope（后续任务）
