# Storage

WXT storage 的统一管理目录，对外 import 面是 `@/lib/storage`。每个 key 的含义写在 `keys.ts` 的注释里；这里只记 owner 规则与坑。

## 约束

- `keys.ts` 是命名空间的唯一事实源（`STORAGE_KEYS` 静态 key、`STORAGE_PREFIXES` 动态前缀）。新增 key 或前缀先在这里查冲突。
- WXT 的 import 固定为 `wxt/utils/storage`，不是 `wxt/storage`。
- `runStorageMigrations()` 是唯一的持久迁移入口，`entrypoints/background.ts` 只调它。
- WebDAV 只同步 settings 与 locale，其余 key 都是设备本地状态。
- 不要在这里加会话或同步记录类的 key：Chat 会话在 PGlite 的 `chat_conversations`，同步时间与「本次新增」在 PGlite 的 Platform Sync Record（`lib/database/CLAUDE.md`）。

## Settings

- Settings 只能经 `settingsStorage` facade 读写，raw item 不公开、不得绕过。远端与导入路径复用 `canonicalizeSettings`，不得把外来数据强转成 `UserSettings`。
- facade 两个方向都 canonicalize：读到损坏的存量记录退回默认值；写入的非法值不落盘。
- `canonicalizeSettings` 的规则：缺失的已知字段补当前默认；已出现但非法的枚举、数值、nested record 整体拒绝；未知顶层字段与未知 provider key 保留。
- 保留未知字段是为了跨版本 whole-config 往返（WebDAV），别当成脏数据清掉。
- `dimensions` 在这里只拒绝发不出去的值（非有限或 `<= 0`）；超过索引上限的值由 Embedding 层显式报错。
- `migrateSettingsIfNeeded()` 只回写检测到的旧 ASR 平铺字段。正常的缺字段读取不回写：无语义变化的写入会推进 WebDAV 的 LWW 时钟。
- `resolveLlmConfig` 是「当前选中 LLM」的唯一来源（user > env > provider def），tagging、summary、设置页共用，别另写解析。

## Service Worker 模块图

- `settings.ts` 的 `defineItem` 刻意懒定义，别改回模块级：WXT 在 `defineItem` 当场就读一次值，会触碰 `chrome.runtime`，而本模块在 Background Agent Bridge tool registry 的静态图上（SW 不能用动态 `import()` 规避）。守卫：`tests/lib-import-smoke.test.ts`。
- SW 静态图上的模块走 leaf（`@/lib/storage/settings`、`@/lib/storage/resolve`），不走 barrel：barrel 会连带求值 `ui-state` / `agent-bridge` / `theme-settings` 的 eager `defineItem`。
- `resolve.ts` 必须保持零 wxt storage 依赖。只要纯计算的领域层 config（`lib/tagging/config.ts`、`lib/summary/config.ts`）从它 import，测试里就不必 stub storage。
- `ui-state.ts` 对平台与领域模块只 `import type`，不把 sync-service 或 DB 带进 storage 的模块图。

## Owner（谁可以读写）

- 主题设置（`local:themeSettings`）：只有 `entrypoints/app/main.tsx`（首次 render 前读一次）与 `entrypoints/app/components/settings/context/settings-provider.tsx`，其他模块不得直接读写。
- 明暗模式不在主题设置里：它归 MUI `ThemeProvider` 的 `favbase-color-mode` localStorage key，`public/theme-init.js` 的首帧预注入依赖它。
- 主题设置的值刻意不带 `version` 字段（WXT `defineItem` 原生支持 version + migrations，可事后追加）。`canonicalizeThemeSettings` 逐字段回退、永不 throw。
- 知识库闸门（`local:library-gate`）：只由 `entrypoints/app/hooks/library-gate.ts` 读写，闸门语义在那里。存「暂停中的平台列表」而不是每平台布尔，`[]` 即全部运行，接新平台不用补默认值。
- 抖音断点（`local:douyin-backfill`）：唯一读写方是 `entrypoints/app/sections/douyin/douyin-sync-adapter.ts`。值原样存，校验在 `lib/douyin` 自己的边界。
- Onboarding（`local:onboarding`）：只由 welcome 页写一次，app 首次 render 前读一次、不 watch。`null` 是安装时弹引导页的唯一闸门；`platforms` 只影响落地路由与侧栏优先级，绝不 gating。详见 `entrypoints/welcome/CLAUDE.md`。
- Agent Bridge config / status：UI 与 scheduler 只能经 `agent-bridge.ts` 的 typed get / watch（它在边界补齐旧存量缺失的字段）。`lastAuthFailureAt` 是事故痕迹，成功握手也不清除。
- ASR quota guard（`local:asr-quota-pause`）：只存 provider 与 reset 时间，不保存也不恢复转录队列。读取方必须核对当前 `settings.asrProvider`，否则切换 provider 后会被旧 guard 阻塞。
- X 认证 header、WebDAV 三个 key 的 owner：`lib/x/CLAUDE.md`、`lib/sync/CLAUDE.md`。
