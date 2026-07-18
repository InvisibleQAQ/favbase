# lib/youtube

YouTube 公开播放列表收录领域（第六个平台，多 source 形态镜像 `lib/zhihu/` 分层）。MVP = 经官方 Data API v3 拉取用户**自己创建的公开播放列表**及其视频（全量重拉 + insert-only 去重）+ PGlite 持久化 + 查询 + description 切块。复用现有表（sources/authors/items/item_sources/item_contents/item_chunks，`platform='youtube'` 判别列），零新表零迁移。

**认证是 API key 形态（无 OAuth）**：公开数据只需用户自备的 Data API 密钥（GCP 项目 → 启用 Data API v3 → 创建 API 密钥），每个请求带 `key=` query 参数。`youtubeApiKey` + `youtubeChannel`（原始输入：`@handle` / `UC...` 频道 ID / 频道 URL）存 `UserSettings`（`useSettings.saveYoutube` 写入），解析在 probe/sync 时进行。**范围边界**：`playlists.list?channelId=` 只返回该频道用户创建的公开列表；私密/未列出需 OAuth（本任务已删除）；「已保存的他人播放列表」官方 API 无端点（OAuth 也拿不到）。旧 BYO OAuth 实现（youtube-auth.ts + token 存储 + identity 权限）已整体移除（当时未提交过，**git 历史无副本**——若未来要私有数据需按 07-17 任务 research 重新实现）。

## 模块结构

- `youtube-api.ts` — Data API v3「API」层（无 DB 导入、无 UI 文案）。认证 = apiKey 直传（`buildUrl` 统一拼 `key=`）：
  - `parseChannelInput(raw) → { kind: 'id'|'handle', value } | null` 纯函数：剥 youtube.com URL 前缀（含 `channel/` 段），`UC` + 22 字符判 ID，其余按 handle（`@` 可选，API 两者都收）。守护测试 `youtube-api.test.ts`
  - `resolveChannel(apiKey, input)` — `channels.list?id=/forHandle=` → `{channelId, title, avatarUrl}`。兼作设置卡「测试连接」探针。**channels.list 零匹配时 200 响应整个缺 `items` 键**（唯一豁免盲信防御的端点，`allowMissingItems`）→ 无匹配抛 `channel not found` Error
  - `fetchPlaylists(apiKey, channelId)` — `playlists.list?channelId=` 串行分页 → `YoutubePlaylist { playlistId, title, itemCount }[]`（API key 只见公开列表，正好是产品范围）
  - `fetchPlaylistItems(apiKey, playlistId, {needsDetails?, onPage?})` — playlistItems 串行分页 → `{ entries, videos }`。**membership 与详情分离**：`entries`（`PlaylistEntry { videoId, addedAt, videoPublishedAt }`）对每条都产出（已知视频也要 link）；`videos.list` 详情批填只对过 `needsDetails` 谓词的 id（跨列表/跨 DB 去重是调用方的集合）。详情响应缺失的视频（已删除/私享）产出 entry 无 video，下游自然跳过。页间 200ms 礼貌延迟（quota 充裕：1 unit/次、10k/天）
  - **全量重拉，无增量**：playlistItems 是**位置序**（用户可插任意位置/重排），stop-on-known-id 不安全（旧 LL 时间序才成立）——幂等靠 insert-only
  - 结构化错误：400/403 reason 含 `keyInvalid`（或 body 含 "API key not valid"）→ `YoutubeAuthError`；403 reason ∈ {quotaExceeded, rateLimitExceeded, userRateLimitExceeded, dailyLimitExceeded} 或 429 → `YoutubeRateLimitError(resetAt=null)`（**Google 无 reset header**，quota 太平洋时间午夜重置）；其余非 2xx → `Error` 附 body 前 300 字符
  - **HTTP 200 决不盲信**（X 07-16 教训）：200 + 非 JSON body / 无 `items` 数组 → 抛带 body snippet 的 Error（channels.list 豁免见上），绝不吞成空数组（`items: []` 是合法零结果，放行）
  - 纯函数导出供单测：`parseIso8601Duration('PT1H2M3S'→3723)`（含 P#D 天分量、P0D 直播占位、不可解析 → 0）、`parseChannelInput`。守护测试 `youtube-api.test.ts`
- `youtube-chunker.ts` — `chunkDescription(text) → ChunkInput[]` 纯函数（description 内容类型 chunker，镜像 `lib/zhihu/zhihu-chunker.ts`）：`MAX_CHARS=1500` 软切，边界优先级 段落空行（`\n\n`）> 句末标点（中英双覆盖）> 硬切，回看窗口 300 字符。无时间戳（NULL start/end 列）。守护测试 `youtube-chunker.test.ts`
- `youtube-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM='youtube'`）。同步：`syncYoutubePlaylists({apiKey, channel}, onProgress?)`（配置由调用方从 UserSettings 读出传入 → resolveChannel → fetchPlaylists → 逐列表 fetchPlaylistItems（`needsDetails = 不在 DB 已存集也不在本轮已取集`）→ `syncPlaylistsToDb`）、`syncPlaylistsToDb(db, batches)`（导出供测试：单事务 per-playlist sources upsert → authors（上传者频道，无头像 API → avatarUrl null）→ items（跨列表 byId 去重，**首见列表赢** addedAt/playlistId/playlistTitle）→ item_sources 从**全部 entries** 建 link（已知视频新加入列表也得 link；无 item 行的 entry 自然掉落）→ 事务外对**新插入 item** 写 content+chunks）。进度 `YoutubePlaylistsProgress { playlistIndex, playlistCount, fetchedCount }`。查询（UI 零 drizzle 导入）：`getPlaylistVideos({playlistId?, search?, page, pageSize})`（`platformMeta->>'addedAt'` DESC ISO 字典序；playlistId chip 筛选走 **item_sources EXISTS join**（zhihu 模式，非 platformMeta）；search 对 title/platformMeta description ILIKE，转义 `%_\`）、`getPlaylistCounts()`（itemSources⋈sources⋈items 按列表分组降序，chip 行）、`getLastSyncedAt()`。UI 行类型 `YoutubeVideoItem` 在此导出。守护测试 `youtube-sync-service.test.ts`（in-memory PGlite）

## 约定

- **共享骨架（docs/15 MEDIUM-3）**：`chunk`/`escapeLike` 自 `lib/database/sql-utils.ts`，`getPlaylistVideos` 走 `pagedItemsQuery`、`getLastSyncedAt` 走 `getPlatformLastSyncedAt`（`lib/database/collection-queries.ts`）——本文件只留平台特有 filter/orderBy/mapRow，勿再拷贝
- **Insert-only（与全平台同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins），不 update 不 delete。重新同步只追加新视频/新 link；metadata 不刷新；从列表移除不删行。唯一例外：`sources` 每列表一行 upsert 刷新 `title`/`lastFetchedAt`（列表改名会跟进，zhihu 同款）
- **多列表 membership（zhihu 形态）**：视频出现在 N 个列表 = 1 item + N link；platformMeta 的 `playlistId`/`playlistTitle`/`addedAt` 是**首见**归属仅供展示/排序，筛选一律走 item_sources
- **content_state='chunked' + 延迟 embed（D3）**：description 即内容，非空 → 全文写 `item_contents` + `chunkDescription` 切块 → `'chunked'`，**不 inline embed**；空 description → `'no_content'`（**不用 `'pending'`**——那会喂给 auto-transcribe）。向量化推迟到设置页「重建向量」。同步后 ILIKE 即可搜；语义检索需先重建
- **两段式事务**：主插入单事务；content+chunks 对新 item 在事务**外**逐条写（`replaceItemChunks` 自开事务，单连接 proxy 嵌套死锁）。`replaceItemChunks` 从 `@/lib/embedding/vector-store` **leaf 导入**（barrel 有 storage 模块加载副作用，同 x-sync-service）
- **items 行映射**：`platformItemId=videoId`、`title`（空回退 videoId）、`authorName=channelTitle`（上传者，非列表所有者）、`authorId → platform_author_id=channelId`、`originalUrl=https://www.youtube.com/watch?v=<id>`、`publishedAt=videoPublishedAt`（视频发布时间，非加入时间）
- **platformMeta 形状**（items，写入方即本目录）：`{ description(截断 500 字符，全文在 item_contents), channelId, channelTitle, thumbnailUrl, durationSeconds, viewCount, likeCount, addedAt, videoPublishedAt, playlistId, playlistTitle }`（camelCase；addedAt/videoPublishedAt 为 ISO 字符串）。缩略图取 medium > high > default
- **addedAt 语义（已确定，非 spike）**：`playlistItems.snippet.publishedAt` 官方定义即 "date added to playlist"——普通播放列表语境下无歧义（旧 LL likedAt 的 `[UNKNOWN → spike]` 随模型替换消失）。排序键
- 权限：`youtubeHostPermissions`（仅 `https://www.googleapis.com/*`）静态 `host_permissions`（`wxt.config.ts`）。**无 identity 权限、无 oauth2.googleapis.com**——随 OAuth 移除
- 运行位置：**仅 app.html 页面 context**（手动同步按钮 → RPC proxy 写 Offscreen PGlite）。远程 + 有配额 → 手动按钮，决不 auto-on-mount
- 边缘：频道零公开列表时不写任何 sources 行 → `getLastSyncedAt` 保持 null（与「从未同步」不可区分，可接受——空库空态本就引导重新同步）
- 未覆盖（Out of Scope，见 PRD）：私密/未列出列表、已保存的他人列表（无官方端点）、Watch Later（`WL` 对 API 返回 400）、官方字幕/转录管线、inline embedding、AI 自动打标
