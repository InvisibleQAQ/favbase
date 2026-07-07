# permissions

运行时 host 权限授权：让用户为自己配置的自定义 API 域名授予访问权，消除扩展页跨域 fetch 的 CORS 拦截。

## 背景

MV3 扩展页只对 `host_permissions`（静态声明 or 运行时授予的 optional）覆盖的 host 放行跨域 fetch，其余按 CORS 处理 → 被拦。内置 provider 域名从 `lib/providers.ts` 派生进 `wxt.config.ts` 的静态 `host_permissions`；自定义域名在构建期未知，走 `optional_host_permissions: ['https://*/*']` + 运行时授权。

## 模块

- `host-access.ts` — 两个原语，把「分类」与「请求」拆开，让 UI 能在中间插入解释弹窗（原子的 `ensureHostPermission` 已废弃）：
  - `hostMatchPattern(baseUrl): string | null` — Base URL → match pattern `${protocol}//${hostname}/*`（用 hostname **去端口**，match pattern 不接受端口；兼容 ollama `:11434` 与自定义端口）；解析失败返回 null。
  - `checkHostPermission(baseUrl): Promise<HostPermissionState>` — **只分类，不弹窗**。`HostPermissionState = { status:'granted' } | { status:'needs-grant', pattern, origin } | { status:'invalid-url' } | { status:'unsupported-scheme' }`。逻辑：pattern 为 null → `invalid-url`；`browser.permissions.contains` 命中（内置静态 & 已授权都走这里）→ `granted`；否则非 https → `unsupported-scheme`（optional 仅 https）；剩下的未授权 https 域名 → `needs-grant`（带 pattern + origin，供 UI 展示）。
  - `requestHostPermission(pattern): Promise<boolean>` — 薄封装 `browser.permissions.request`，返回是否授予。**必须在用户手势（按钮点击）内调用**，才有 transient user activation（~5s 窗口）。
  - `EnsurePermissionResult = { ok:true } | { ok:false, reason: 'invalid-url'|'unsupported-scheme'|'denied' }` — UI 侧 `useHostPermission().ensure` 的返回契约。

## UI 解释弹窗

`entrypoints/app/sections/settings/use-host-permission.tsx` 的 `useHostPermission()` hook 把两个原语粘合起来：先 `checkHostPermission` 分类（快、不弹窗），仅当 `needs-grant`（未授权 https）时弹一个 MUI Dialog（Bilitato 风格文案：标题「授权自定义 API 域名」+ 说明 + 展示 `${origin}/*` + 允许/取消按钮），**把原生 Chrome 授权弹窗推迟到 Dialog 的「允许」按钮点击**——那是一次全新的用户手势，`browser.permissions.request` 仍有 transient user activation（原始测试按钮点击后再交互 Dialog 已丢失 activation，故不能在原按钮里直接 request）。`ensure(baseUrl)` 返回 `Promise<EnsurePermissionResult>`，`dialog` 是渲染的 JSX。

## 约定

- 遵守 i18n seam：`host-access.ts` 只返回结构化状态/`reason`，**不引 `t()`**。UI 侧 `permission-error.ts` 把 `reason` map 到 `settings.permission.*` locale key；`use-host-permission.tsx` 的弹窗文案走 `settings.permission.{dialogTitle,dialogDesc,grant,cancel}`。
- 消费方：`llm-config-card.tsx`（测试连接 + 获取模型两处）/ `embedding-config-card.tsx`（测试连接一处）用 `useHostPermission()`，handler 起始处 `await ensure(baseUrl)`，`!ok` 显示本地化错误并 return，并在 JSX 里渲染 `{dialog}`。
- 授权全局持久 → 一次授权后 background/offscreen 的 embedding/RAG 管线复用同一权限（SW 无用户手势，无法自行 request，授权入口只能在 UI）。

## 测试

`host-access.test.ts`（vitest + happy-dom，stub `browser.permissions`）：`hostMatchPattern` 各分支 + `checkHostPermission` 四种 status（`checkHostPermission` **不调用 request**）+ `requestHostPermission` 委托 `browser.permissions.request` 并透传布尔。`pnpm test`。
