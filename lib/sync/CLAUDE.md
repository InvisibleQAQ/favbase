# lib/sync

WebDAV 双向同步领域。**第一期只同步配置**（`UserSettings` + locale）；数据（PGlite 知识库）留第二/三期。

## 三期分界

- **第一期（已落地）**：基础设施 + 配置整体 LWW 同步。WebDAV 客户端 / 锁 / 后台触发 / 逃生 / UI 全通。
- **第二期**：数据结构表 + `item_contents` 双向合并——利用 favbase insert-only 特性做**主键并集**（非 LWW），需从零建 PGlite 导入层 + Offscreen RPC。挂钩点：`sync-engine.ts` `doSync` 里 `syncConfig` 之后的注释位。
- **第三期**：`item_chunks.embedding` 向量大块传输 + manifest 差量 + 维度兼容守卫。

## 远端目录约定（`/FavbaseSync`）

```
/FavbaseSync
  ├── sys.json      锁 + 版本（跨设备互斥）
  ├── config.json   { version, updatedAt, settings, locale }（第一期）
  └── db/           知识库表（第二/三期，尚未写入）
```

## 关键设计

- **引擎只在 Background SW 跑**（`sync-engine.ts`）。配置同步只碰 WXT storage（SW 可读写）；后台定时也必须在 SW。UI「立即同步」经消息 `WEBDAV_SYNC_NOW` → SW `doSync`；状态经 `webdav-sync-status` storage watch 回流 UI。
- **配置整体 LWW**（非字段级 merge）。`webdav-sync-meta.localConfigUpdatedAt` 是本地时钟，与远端 `config.json.updatedAt` 比大小决定 push/pull/noop（`sync-logic.decideConfigSync`）。
- **防 ping-pong 用内容哈希**（不用时间窗口，抗 `storage.watch` 异步乱序）。`lastKnownConfigHash` = 上次已知配置指纹。真编辑 → `noteLocalConfigChange` bump 时钟；**pull 写回前先 `adoptPulledConfig` 把 hash 设成远端 hash**，于是 pull 触发的 watch 算出的 hash 相等 → 跳过 bump，不会反弹回 push。
- **首配时钟从真实编辑时间 seed**（`seedConfigClockIfUnset` 读 `settings.configSavedAt` 最大值，不用 `now`）。让第二台设备首配时倾向 pull 第一台的配置而非覆盖它。
- **两级闸门**：`isConfigSyncable`（enabled + 凭据）门自动触发（scheduler）；`hasWebdavCredentials`（仅凭据）门手动同步（`doSync`）——`enabled` 只关自动，手动「立即同步」凭据齐全即可。
- **凭据轻混淆**：`crypto.ts` AES-GCM（固定 key + 随机 IV）只混淆本地存储的 password，**非真加密**（config.json 传上 WebDAV 仍含明文 API Key，E2E 留后期）。解密失败回退当明文。
- **仅 https**：UI 预检 http → `settings.sync.err.httpsOnly`；`optional_host_permissions` 只有 https，`checkHostPermission` 对 http 判 `unsupported-scheme`。

## 模块

- `constants.ts` — 远端路径 / 锁超时（10min）/ alarm 名 / 周期（30min）/ 防抖（5min）/ config version。
- `types.ts` — `WebdavConfig`（解密后形态）/ `WebdavSyncMeta`（LWW 时钟）/ `WebdavSyncStatus`（UI 态）/ `RemoteConfig`/`RemoteSys` / `WebdavErrorCode` / 消息类型。
- `sync-schema.ts` — Zod 守卫：`parseRemoteConfig`/`parseRemoteSys`，**所有远端 JSON 进内存前 safeParse，失败当「远端无该数据」**（防坚果云冲突副本/脏数据击穿本地）。`settings` 只校验为非空对象（不深校验 UserSettings 每字段，避免 schema 演进即拒真数据）。
- `sync-logic.ts` — **纯函数（单测 `sync-logic.test.ts`）**：`canonicalStringify`/`hashString`/`hashConfig`（键排序稳定指纹）+ `decideConfigSync`（LWW 三分支）+ `canAcquireLock`（超时夺锁）。
- `crypto.ts` — AES-GCM `encryptSecret`/`decryptSecret`（单测 `sync-schema.test.ts`）。
- `webdav-client.ts` — `webdav` npm 包薄封装 `WebdavClient`：`getJSON`(404→null)/`putJSON`(先 ensureDir)/`ensureDirectory`(逐级 MKCOL 容错)/`deletePath`/`testConnection`，Basic Auth。
- `sync-config-storage.ts` — `local:webdav-config` 读写（password 经 crypto）+ `hasWebdavCredentials`/`isConfigSyncable`/`watchWebdavConfig`。
- `sync-meta-storage.ts` — `local:webdav-sync-meta`（时钟/版本）+ `local:webdav-sync-status`（UI 态）+ `noteLocalConfigChange`(返回是否真变)/`adoptPulledConfig`/`seedConfigClockIfUnset`/`setSyncStatus`/`watchSyncStatus`。
- `sync-engine.ts` — `doSync`（ensureDir → acquireLock → syncConfig → releaseLock，finally 释放 + 落状态，**永不抛**）/ `clearRemote`（删 `/FavbaseSync` 逃生）/ 错误分类 `classifyError`（401/403→auth，TypeError→network）。
- `scheduler.ts` — `initWebdavSyncScheduler`：`chrome.alarms`（周期 30min + 变更防抖 5min）+ settings/locale watch（bump 时钟 + 排防抖）+ 启动补偿（≥30min 未同步即跑）。**MV3 必须 alarms 不能 setTimeout**，监听器同步注册。
- `index.ts` — barrel（import `@/lib/sync`）。

## 接线点（本目录之外）

- `entrypoints/background.ts` — `initWebdavSyncScheduler()` + dispatcher `WEBDAV_SYNC_NOW`/`WEBDAV_CLEAR_REMOTE` case。
- `lib/background/{messages.ts,sync-handlers.ts}` — 两条消息注册 + handler。
- `lib/storage/keys.ts` — `webdavConfig`/`webdavSyncMeta`/`webdavSyncStatus` key。
- `wxt.config.ts` — `alarms` 权限（https 任意域名走既有 `optional_host_permissions`）。
- `entrypoints/app/sections/settings/webdav-sync-card.tsx` — 设置页存储 tab 的 WebDAV 卡（rail 区段 `webdav`）。

## 测试

`sync-logic.test.ts`（LWW 三分支 / 锁超时夺锁 / 哈希稳定）+ `sync-schema.test.ts`（Zod 脏数据回退 / crypto 往返）。`pnpm test`。
