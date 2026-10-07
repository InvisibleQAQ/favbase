# lib/youtube

YouTube 公开播放列表收录领域：经官方 Data API v3 拉取某个频道自己创建的公开播放列表及其视频，description 作正文入库。

## 认证与范围

- 认证是 API key，没有 OAuth：用户自备 Data API 密钥，每个请求带 `key=`。`youtubeApiKey` + `youtubeChannel`（原始输入：`@handle`、`UC…` 频道 ID 或频道 URL）存 `UserSettings`，频道解析在 probe / sync 时做。
- API key 不代表账号，所以必须另填频道。`playlists.list?channelId=` 只返回该频道用户创建的公开列表，这正好是产品范围。
- 拿不到的：私密 / 未列出列表（需 OAuth）、「已保存的他人播放列表」（官方 API 无端点，OAuth 也拿不到）、Watch Later（`WL` 对 API 返回 400）。
- 没有可恢复的 OAuth 实现：旧的 BYO OAuth 版本从未提交，git 历史里没有副本，manifest 也没有 `identity` 权限。要私有数据得从头实现。
- 只有配了 key 才发请求，所以 `YoutubeAuthError` 的 reason 恒为 `'rejected'`（400 / 403 的 `keyInvalid`）。
- 配额或限流（403 的 quota 类 reason，或 429）→ `YoutubeRateLimitError`，`resetAt` 恒 null：Google 不给 reset header，配额在太平洋时间午夜重置。
- 没有瞬时错误重试，429 / 5xx 直接抛。这是刻意没加的：属于风控语义的行为变化，要单独决定（docs/32 Step 3）。

## API 的坑

- 全量重拉，没有增量：playlistItems 是位置序（用户可以插到任意位置或重排），stop-on-known-id 不安全；幂等靠 insert-only。
- `channels.list` 零匹配时，200 响应整个缺 `items` 键。它是唯一豁免「无 `items` 数组即抛」的端点（`allowMissingItems`），无匹配抛 `channel not found`。
- 其余端点 HTTP 200 决不盲信：非 JSON body 或无 `items` 数组即抛带 body 片段的 Error，绝不吞成空数组；`items: []` 是合法的零结果。
- 响应 body 在状态码判断之前就读出来（400 / 403 要从中取 reason），所以 `parseJsonBody` 收的是字符串；不要改成传 `Response`。
- membership 与详情分离：`fetchPlaylistItems` 对每一条都产出 entry（已入库的视频也要建 link），`videos.list` 详情只对过 `needsDetails` 的 id 拉。
- 详情响应里缺失的视频（已删除、私享）只有 entry 没有 video，下游自然跳过，不是错误。
- `PAGE_SIZE` 默认值就是 API 硬上限，经 env 调大必坏。
- `playlistItems.snippet.publishedAt` 的官方语义就是「加入列表的时间」，即 `addedAt`（排序键）；视频自己的发布时间是 `videoPublishedAt`。

## 入库

- 写侧走 `ingestCollection`，insert-only 不变量见 `lib/ingest/CLAUDE.md`：从列表移除不删行、metadata 不刷新，唯一 upsert 是 `sources` 每列表一行（`title` / `lastFetchedAt`，列表改名会跟进）。
- 视频出现在 N 个列表 = 1 item + N link。`platformMeta` 的 `playlistId` / `playlistTitle` / `addedAt` 是首见归属，只供展示与排序；按列表筛选一律走 `item_sources`。
- `authorName` 是上传者频道，不是列表所有者；`publishedAt` 是视频发布时间，不是加入时间。
- `platformMeta.description` 只是截断片段，全文在 `item_contents`。已入库的视频不再拉详情，所以幽灵条目没有可重拉的正文，只能靠 ingest 的 sweep 从已存 `plainText` 重切（`lib/ingest/CLAUDE.md`；`youtube-sync-service.test.ts` 有复现用例）。
- 空 description → `'no_content'`。不要用 `'pending'`：那会把条目喂给 auto-transcribe。
- 同步不 inline embed：embed / tag lane 由 app 侧 Sync Adapter 经 Platform Sync funnel 派发。本目录不 import tagging / embedding。
- 频道零公开列表时不写任何 `sources` 行；这种成功同步仍会记进 Platform Sync Record，不等于「从未同步」。
- 共享查询片段在 `lib/database/collection-queries.ts`，勿在本目录再拷贝。
- `platformMeta` 形状：`{ description, channelId, channelTitle, thumbnailUrl, durationSeconds, viewCount, likeCount, addedAt, videoPublishedAt, playlistId, playlistTitle }`（两个时间是 ISO 字符串）。
- 唯一 decoder 是 `narrowYoutubeMeta`，唯一 Row mapper 是 `toYoutubeVideoItem`（分页查询与 `sections/youtube` 的 tagged card 共用）。decoder 不收窄 `playlistId` / `playlistTitle`（不是视图字段）；`channelTitle` 缺失或空串回退 `authorName`。
- 不做：官方字幕 / 转录管线。
