# lib/sync

WebDAV 双向同步领域。第一期只同步配置（`UserSettings` + locale）；知识库数据（PGlite）尚未同步。

## 三期分界

- 第一期（现状）：配置整体 LWW 同步 + 跨设备锁 + 后台触发 + 清除远端逃生口。
- 第二期：结构表 + `item_contents` 双向合并。知识库表 insert-only，所以做主键并集而不是 LWW；要先建 PGlite 导入层与 Offscreen RPC。挂钩点是 `sync-engine.ts` 的 `doSync` 里 `syncConfig` 之后那行注释。
- 第二期必须排除 `platform_sync_records`：它是设备本地的 upsert 状态行，并到另一台设备会让对方以为今天已同步过、压掉自己的每日自动同步（docs/32 §5.1）。
- 第三期：`item_chunks.embedding` 向量传输 + manifest 差量 + 维度兼容守卫。

## 远端目录约定（`/FavbaseSync`）

```
/FavbaseSync
  ├── sys.json      锁 + 版本（跨设备互斥）
  ├── config.json   { version, updatedAt, settings, locale }（第一期）
  └── db/           知识库表（第二/三期，尚未写入）
```

## 架构约束

- 引擎只在 Background SW 跑。UI「立即同步」经 `WEBDAV_SYNC_NOW` 消息进 SW，状态经 `webdavSyncStatus` 的 storage watch 回流；别在 app.html 直接调 `doSync`。
- 后台触发只能用 `chrome.alarms`，不能 `setTimeout`（MV3 SW 会休眠）；`initWebdavSyncScheduler` 的监听器必须同步注册。
- 配置是整体 LWW，不做字段级 merge：本地时钟 `localConfigUpdatedAt` 与远端 `config.json.updatedAt` 比大小。
- 防 ping-pong 靠内容哈希，不靠时间窗口（`storage.watch` 异步乱序）。pull 写回本地之前必须先 `expectPulledHashes` + `adoptPulledConfig`；顺序反了，pull 自己触发的 watch 会 bump 时钟并反弹成 push。
- pull 是 settings、locale 两次独立写入，中间态（新 settings + 旧 locale）的 hash 也要登记，否则同样误 bump。
- 远端 Settings 必须先经 `lib/storage/settings-schema.ts` 的 `canonicalizeSettings` 才能进 hash、时钟和本地写入。字段规则只归那一个文件，本目录不复制。
- 远端 envelope 无效 → 视为无远端；envelope 有效但 version 不兼容或 Settings 非法 → 抛 typed error（`incompatible-version` / `invalid-settings`）并保留本地配置。绝不能把后者降级成「无远端」，那会 push 覆盖云端。
- 首配时钟从 `settings.configSavedAt` 的最大值 seed，不用 `now`：第二台设备首配时应 pull 第一台的配置，而不是覆盖它。
- `doSync` 永不抛：失败落状态并返回 `SyncResult`；拿到锁之后失败要 best-effort 释放，否则锁要等超时才能被夺。
- 两级闸门：`doSync` 只看凭据（`hasWebdavCredentials`），所以开关关闭时「立即同步」照常跑；`enabled` 由 scheduler 的每个自动触发点各自用 `isConfigSyncable` 把关，alarm 回调也要在触发时重查（关开关前已 arm 的 debounce alarm 仍会响）。别把 `enabled` 塞回 `doSync`。
- 只支持 https：http 在设置卡预检拦下；host access 的检查与恢复归 `lib/permissions/CLAUDE.md`。
- 错误出本目录只带 `WebdavErrorCode`，文案由 UI 翻译（`settings.sync.err.*`）。

## 坑

- `crypto.ts` 是混淆不是加密（固定 key + 随机 IV，只为不让 password 明文躺在 storage 里）；解密失败回退当明文，兼容混淆之前写入的值。传上 WebDAV 的 `config.json` 仍含明文 API Key。
- `ensureDirectory` 对「已存在」和拒绝重复 MKCOL 的服务器（坚果云等）只 warn 不抛，别改成严格。
- 已知缺口：同步进行中再收到 `WEBDAV_SYNC_NOW`，`doSync` 的 `isSyncing` 早退返回 `ok: true`，设置卡会弹「已同步」。

## 指针

- storage key 在 `lib/storage/keys.ts`：`webdavConfig`（连接配置，password 已混淆）/ `webdavSyncMeta`（LWW 时钟 + 版本）/ `webdavSyncStatus`（UI 态）。
