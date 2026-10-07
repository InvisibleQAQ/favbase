# lib/cache

视频字幕缓存（平台感知，模块本身零平台依赖）：per-video key `local:vc:{platform}:{videoId}`，官方字幕与 ASR 结果都进这里。

## 约束

- 读写函数（`getVideoCache` / `mergeVideoCache`）只在 Background SW 调用：内存层靠 `initCacheStorageListener` 与 storage 保持同步，别的 context 没注册这个 listener，会读到旧值。Content Script / app.html 经 Background 消息读写，订阅变更用 `onVideoCacheChange`。
- `getVideoCache` 返回非 null 即保证 `rows` 非空（空 rows 条目当未命中），调用方不用二次校验。
- 调用方只传 `(platform, videoId, rows, source)`。hash、时间戳、key 格式都归本模块，key 前缀注册在 `lib/storage/keys.ts` 的 `STORAGE_PREFIXES.videoCache`；外部不要自己拼 key。
- 新平台直接传自己的 platform 字符串，不在本模块加平台分支。

## 坑

- storage key 与条目里的 `videoId` 都是小写化后的值（`normalizeVideoId`），而 BV 号大小写敏感：不要把缓存条目的 `videoId` 当成视频的真实 id 回传或比对。
- `rawHash` 是轻量指纹（行数 + 首尾时间 + 首尾各 24 字符），不是内容哈希：只改了中间行的字幕会被 `mergeVideoCache` 当成重复而跳过写入。`lib/summary` 也拿它判断总结是否过期。
- 写入遇 quota 错误没有降级，只多打一条 warn 再照常抛出；要不要吞掉由调用方决定。
