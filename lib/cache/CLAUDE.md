# lib/cache

视频缓存领域类型与平台感知的视频字幕缓存模块。

## 模块结构

- `types.ts` — 缓存领域类型：VideoCacheEntry(platform + videoId + rawHash), GetVideoCacheRequest(platform + videoId), CacheSubtitleRequest(platform + videoId)
- `video-cache.ts` — 视频缓存模块（平台感知）：normalizeVideoId()（纯 lowercase，无平台特定正则）+ per-video 独立 key（`local:vc:{platform}:{videoId}`，含平台命名空间防碰撞）+ 内存缓存层（Map key 为 `{platform}:{videoId}` + structuredClone 深拷贝）+ getVideoCache(platform, videoId)（空 rows 条目视为缓存未命中返回 null，消费者无需二次验证）+ mergeVideoCache(platform, videoId, rows, source)（深接口：hash/timestamp 内部计算，Promise-based per-key 写锁 + hash 去重 + quota 降级）+ 旧格式迁移（`local:videoCache` 单体 → `local:vc:bilibili:{videoId}`）+ initCacheStorageListener（Background 侧 chrome.storage.onChanged 同步内存缓存，忽略无平台段的旧 key）+ onVideoCacheChange(platform, videoId, cb)（Content Script 侧订阅缓存变更，封装 key 格式，返回 unsub）。computeRowsHash 为模块内部不导出，key 前缀从 `STORAGE_PREFIXES.videoCache`（`lib/storage/keys.ts`）导入

## 约定

- 视频缓存: `lib/cache/video-cache.ts` 模块（平台感知）。per-video 独立 key `local:vc:{platform}:{videoId}`（chrome.storage 中为 `vc:{platform}:{videoId}`，key 前缀由 `STORAGE_PREFIXES.videoCache` 中央注册）。内存缓存层（Map key 为 `{platform}:{videoId}` + structuredClone 深拷贝）+ Promise-based per-key 写锁 + 内部 hash 去重（computeRowsHash 不导出）。`getVideoCache(platform, videoId)` 返回 null 表示缓存未命中（包括空 rows 条目），消费者拿到 non-null 结果即保证 rows 非空，无需二次验证。调用方传 `mergeVideoCache(platform, videoId, rows, source)`，hash/timestamp 由 cache 内部管理。所有来源（official/asr）字幕统一缓存。旧 `local:videoCache` 单体 key 在首次访问时自动迁移到新格式。旧 `vc:{bvid}`（无平台段）key 自然淘汰，listener 忽略。Background 侧 initCacheStorageListener 保持内存缓存与 storage 同步，Content Script 侧通过 `onVideoCacheChange(platform, videoId, cb)` 订阅跨 tab 缓存变更（key 格式封装在缓存模块内部，调用方无需知道）。新增平台缓存：调用方传各自 platform 字符串即可，缓存模块本身零平台依赖
