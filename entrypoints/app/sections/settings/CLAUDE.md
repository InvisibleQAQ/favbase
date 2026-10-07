# settings

app.html 设置页：顶部 Tab + 每个 tab 内「二级导航 rail + 右侧单个 `SettingsPanel`」。两级导航都是路由 `/settings/<tab>/<section>`。Embedding 区的独有约定在 `embedding/CLAUDE.md`。

## 约束

### 导航与路由

- `settings-nav.ts` 的 `SETTINGS_NAV` 是两级导航唯一的穷举表：顶部 Tabs、rail、路由合法性、每个 tab 的默认 section 全从它派生。
- URL 段就是 section id，没有映射层；id 必须是 kebab 且在 tab 内唯一（`settings-nav.test.ts`）。
- 加一个设置项 = `SETTINGS_NAV` 加一行 + `settings-view.tsx` 的扁平 switch 加一个 case（漏接时 `tsc` 在 `never` 上点名）+ 双语 key。
- `SETTINGS_NAV` 故意不放 `render`：各卡 props 互不相同，塞进去会把纯数据表变成 context 管道。
- `settings-nav.ts` 必须保持零值导入（只 `import type`）：`tests/platform-completeness-contract.test.ts` 直接 import 它。
- 从设置页之外链入一律用 `settingsPath(leaf)`，不手拼 `/settings/...`：改名或删掉 section 时 `tsc` 点名调用点，裸字符串会继续编译并静默落到默认叶子。
- 视图零导航 state，tab / section 只来自 `useParams()`。切 tab 永远落该 tab 第一项，不记忆上次看的 section（用户决定：URL 是唯一事实源）。
- 非法或缺省路径（`/settings`、裸 tab、未知段）的重定向一律 `<Navigate replace>`：push 会让后退键被弹回来再重定向，困在设置页。手点 tab / rail 才是 push。
- `?resume=<CollectionPlatform>` 是一次性副作用参数，不是位置：经白名单解析，并随每次内部跳转保留在 query 里。
- LLM / Embedding 保存成功后据 `resume` 恢复该平台的 Tags / Embed backlog，保存 reject 不派发；ASR 不走这里，由自动转录 watcher 恢复。
- 旧 `/settings?section=llm|asr|embedding` 深链由 `legacySectionPath` 升级，只认这三个值。
- 面包屑首项的 `href` 是路由相对的 `'/'`，不是 `'#/'`：`RouterLink` 自己补 `#`，写 `'#/'` 点了回不到首页。

### 导航视觉（刻意决定，别顺手改）

- 两级导航都吃主题默认的下划线 Tabs（`theme/core/components/tabs.tsx`），组件本地不传 `variant`、不覆盖指示条。
- 标签绝不折行（`whiteSpace: 'nowrap'`），溢出就横滑，中英文长标签都不压缩。
- `settings-tabs.tsx` 整条轨道居中是对 Minimal 左对齐的刻意偏离（用户决定，`.trellis/spec/frontend/ui-design-system.md` §11），代价是脱离 h1 的左基线，已接受，禁止推回左对齐。
- 居中不能用 `centered`（与主题默认的 `scrollable` 互斥，告警且无效），也不能给 `MuiTabs-list` 做 flex 居中（溢出时左端滚不到）。
- 同一处的 `maxWidth: 1` 是承重的，禁止当冗余删：窄屏靠它夹住 `fit-content`，删错的后果是 390px 下首个 tab 停在容器外、点不到。
- `section-rail.tsx` 不居中。它保留 `useMediaQuery` 的两形态：`md+` 竖排、窄屏横排（`settings-navigation.test.tsx` 锁横排可滚）。
- 竖排 `Tab` 保留 `justifyContent: 'flex-start'`：每行都带图标，MUI 默认居中会排成参差的图标列；横排保持居中。
- 竖排 rail 只吃默认下划线、不加选中洗底，与 Dashboard 图例的竖向 Tabs 形态刻意不统一，禁止顺手统一（spec §11 Vertical Tabs）：洗底会与侧栏 `components/nav-section/` 的激活态重影，把页内二级导航拉平成一级导航。
- 每个 active section 只渲染一个 `SettingsPanel`（标题是 h2），禁止 Card 嵌套；`sections/overview/export-card.tsx` 也复用它。

### 保存模型（LLM / ASR / Embedding / GitHub / YouTube 五卡）

- 无自动保存：编辑只改卡内 draft，点「保存」才写 `settingsStorage`。未保存草稿刷新或切卡即丢，有意为之，不加未保存提示。
- 保存被测试连接 gating：`canSave = verified || (dirty && 连接字段未变)`。连接字段一改，既有测试结果失效；非连接字段改动无需重测即可保存。
- 连接字段是各卡的 `*_CONNECTION_KEYS`。ASR 的 model 不算：`/models` 探针验不了模型名。
- 「测试→验证→保存」状态机整个在 `use-config-draft.ts`，卡片只提供 `runTest` / `save` / 可选 `acceptResult`；不要在卡片里重建测试或保存状态。
- 验证签名在测试发起时（await 之前）捕获：测试期间用户再编辑，旧签名对不上新 draft，不会误判 verified。
- 外部 settings 变更只在用户未编辑时重同步 draft，不覆盖正在编辑的草稿。
- `handleSave` 永不 reject：成功与失败的 toast 都在 hook 内发出，卡片不各自接线；失败时 draft 保持可重试。
- 「已保存 + 时间」徽标是持续态，读 `configSavedAt[section]`，不进 toast。
- lib 层错误只带英文 debug 文案；i18n 映射在卡片的 `runTest` 里做（按错误类；YouTube 另按 message 含 `channel not found`）。

### 平台凭据链（GitHub / YouTube 连接卡）

- `readiness: 'credentials'` 的平台必须有：`<platform>-connection-card.tsx`、`SETTINGS_NAV` connections 下同名的 section、`lib/hooks/useSettings.ts` 的 `derive<Pascal>Draft` / `save<Pascal>`、`configSavedAt` 键。守卫 `tests/platform-completeness-contract.test.ts`。
- 守卫只证结构存在，不证接线正确：Sync Adapter 的 `probeReady` 读错 settings key、zod 条目加载时丢字段都照样绿。完整清单见 `.trellis/spec/frontend/platform-onboarding.md` §8，要人工读。
- 连接卡是平台凭证，不是 AI provider：draft 的 `provider` 恒为平台 id，只为满足 `useConfigDraft` 的泛型约束，没有 provider 选择。
- 连接卡走同一套「填写 → 测试 → 保存」：GitHub 的探针验 token，YouTube 的探针用 API 密钥解析频道。
- YouTube 卡要填频道是因为 API 密钥不代表账号，必须指明收录哪个频道；只收录公开播放列表（`lib/youtube/CLAUDE.md`）。
- GitHub 指引文案引导勾 repo + user scope 是用户的产品决定（公开仓库零 scope 即可），别"修正"。

### host 权限

- 请求用户自填地址的卡（LLM / Embedding / WebDAV）在发请求前先 `useHostPermission().ensure(url)`，测试与拉模型列表共用同一个 `ensure`；ASR / GitHub / YouTube 的域名在静态 host_permissions 里，不需要。
- `browser.permissions.request` 必须留在恢复 Dialog 的「允许」点击里：那是新的用户手势，才有 transient user activation。

### Agent Skills 卡（`agent-bridge-card.tsx`）

- 界面与路由段叫 Agent Skills；文件名、组件名、i18n 前缀 `settings.agentBridge.*` 与域术语仍是 Agent Bridge（`CONTEXT.md`）。换的是用户词汇，不是那条数据通路，不要跟着 UI 改名。
- `buildSetupCommand` 是唯一的 setup 命令生成器，产出裸 `favbase setup …`，不用 `npx`：SKILL.md 的 `allowed-tools: Bash(favbase:*)` 把 agent 锁在 PATH 上的 `favbase`，经 npx 配对会留下 agent 用不了的机器。
- 复制的命令保持单行，不拼 `A && B`：Windows PowerShell 5.1 不支持 `&&`。`npm install -g favbase` 是三步清单的第 1 步，不进命令。
- 卡片只写配置并发 `AGENT_BRIDGE_CONNECT_NOW`；WebSocket 与重试始终归 Background，别在这里开连接，也别加重试倒计时（bad-token 退避已整体删除，docs/30 #1）。
- 端口只在 blur / Enter 且为合法整数时提交；raw transport error 不进 UI，只映射稳定 code。
- 复制结果走 toast，按钮文案不切「已复制」。

### WebDAV 卡

- `enabled` 只关自动后台同步，「立即同步」不受它限制。
- 同步引擎在 Background SW（`lib/sync/CLAUDE.md`）；本卡只做 UI + host access + typed 消息。
- 两个按钮的结果走 toast，失败优先用具体的 `settings.sync.err.<code>`；`status.state === 'error'` 的 Alert 是持续态，保留，不改成 toast。

## 坑

- 传给 `useConfigDraft` 的 `derive` 必须引用稳定（`useCallback`，测试里提到组件外）：它喂一个 `[derive]` effect，不稳定就无限重渲染，而 vitest 只报 `Worker exited unexpectedly`，无堆栈、无组件名。
- `setField` 的同值 no-op 守卫不能删：MUI Autocomplete 挂载时会发 `onInputChange('reset')`，不得把 draft 误标为已编辑。
- `settings-view.tsx` 两个 Grid 列的 `minWidth: 0` 不能删：390px 下靠它让导航 Tabs 在列内横滑而不是被截断；这是布局行为，单测量不出来。
- `SettingsLeaf` 的 `LeafOf<>` 类型参数必须裸着（分发式条件类型），否则 tab 与 section 交叉成笛卡尔积。
