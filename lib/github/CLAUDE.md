# lib/github

GitHub Star 收录领域：全量拉取 starred repos，新仓库的 README markdown 作正文入库。

## 约束

- token 由调用方读出后作参数传入。本目录不 import `@/lib/storage`，也不 import tagging / embedding barrel：加载图必须 storage-free（守卫 `tests/lib-import-smoke.test.ts`）。
- 只有带 token 才发请求，所以 `GithubAuthError` 的 reason 恒为 `'rejected'`（401）。403 且 `X-RateLimit-Remaining` 为 0 → `GithubRateLimitError`，带 `resetAt`（页面的获取按钮锁到该时刻）。
- 没有瞬时错误重试。这是刻意没加的，要单独决定（docs/32 Step 3）。
- `PER_PAGE` 默认值就是 API 硬上限，经 env 调大必坏。
- 收藏时间 `starredAt` 只有带 `Accept: application/vnd.github.star+json` 才有（响应元素变成 `{ starred_at, repo }`）；去掉这个 Accept，排序键就没了。
- `fetchReadme` 的 404 返回 `null`：没有 README 是正常状态，不是错误。单仓 README 拉取失败降级为 no-content，不让整次同步失败。
- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`：unstar 不删行、metadata 不刷新，唯一 upsert 是 `sources` 的 `'stars'` 单行。共享查询片段在 `lib/database/collection-queries.ts`，勿在本目录再拷贝。
- 回填边界（有意决策）：诚实 `no_content` 的仓库永不补拉，健康的已入库仓库也不重拉——insert-only 快照。
- 唯一例外是幽灵仓库（声明有 content 但零 chunk 行，bug 的产物）：`getReposNeedingReadme` 把它们与新仓库一起补拉 README 自愈。这是「无回填」的 bug 修复例外，不要推广成通用回填。
- 没有 README 或拉取失败 → `'no_content'`。不要用 `'pending'`：那会把条目喂给 auto-transcribe。
- 同步不 inline embed：`newItemIds`（含自愈的 id）由 app 侧 `github-sync-adapter.ts` 经 Platform Sync funnel 派发 embed / tag lane。
- `platformMeta` 形状：`{ description, language, stargazersCount, forksCount, topics, pushedAt, starredAt, ownerAvatarUrl }`（两个时间是 ISO 字符串）。
- 唯一 decoder 是 `narrowGithubMeta`，唯一 Row mapper 是 `toGithubRepoItem`（分页查询与 `sections/github-stars` 的 tagged card 共用），改形状只此一处。
- `toGithubRepoItem` 的参数是不含 `publishedAt` 的六列，比 `PagedItemRow` 窄；按参数逆变照样能传给 `taggedCard`，不要「补齐」它。
