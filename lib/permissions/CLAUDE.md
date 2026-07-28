# permissions

host access 检查与恢复：确认用户配置的 API/WebDAV origin 仍有必选站点访问权，并在 HTTPS 权限被拒绝或收回后从设置页恢复。

## 背景

MV3 扩展页只对有效 `host_permissions` 覆盖的 host 放行跨域 fetch，其余按 CORS 处理 → 被拦。书签正文提取要求 `wxt.config.ts` 静态声明 `<all_urls>`；该必选权限同时覆盖内置 provider、自定义 API 与 WebDAV origin，不再重复声明 `optional_host_permissions`。用户仍可在安装时拒绝或之后收回站点访问，因此调用前必须检查实际 grant。

## 模块

- `host-access.ts` — 两个原语，把「分类」与「恢复」拆开，让 UI 能在中间插入解释弹窗（原子的 `ensureHostPermission` 已废弃）：
  - `hostMatchPattern(baseUrl): string | null` — Base URL → match pattern `${protocol}//${hostname}/*`（用 hostname **去端口**，match pattern 不接受端口；兼容 ollama `:11434` 与自定义端口）；解析失败返回 null。
  - `checkHostPermission(baseUrl): Promise<HostPermissionState>` — **只分类，不弹窗**。`HostPermissionState = { status:'granted' } | { status:'needs-grant', pattern, origin } | { status:'invalid-url' } | { status:'unsupported-scheme' }`。逻辑：pattern 为 null → `invalid-url`；`browser.permissions.contains` 命中必选 host access → `granted`；否则非 https → `unsupported-scheme`（本模块只恢复 HTTPS）；剩下的缺失 HTTPS grant → `needs-grant`（带 pattern + origin，供 UI 展示）。
  - `requestHostPermission(pattern): Promise<boolean>` — 薄封装 `browser.permissions.request`，恢复被拒绝/收回的必选 HTTPS origin 并返回是否授予。**必须在用户手势（按钮点击）内调用**，才有 transient user activation（~5s 窗口）。
  - `EnsurePermissionResult = { ok:true } | { ok:false, reason: 'invalid-url'|'unsupported-scheme'|'denied' }` — UI 侧 `useHostPermission().ensure` 的返回契约。

## UI 解释弹窗

`entrypoints/app/sections/settings/use-host-permission.tsx` 的 `useHostPermission()` hook 把两个原语粘合起来：先 `checkHostPermission` 分类（快、不弹窗），仅当 `needs-grant`（必选 HTTPS access 被拒绝/收回）时弹一个 MUI Dialog（Bilitato 风格文案：标题「授权自定义 API 域名」+ 说明 + 展示 `${origin}/*` + 允许/取消按钮），**把原生 Chrome 授权弹窗推迟到 Dialog 的「允许」按钮点击**——那是一次全新的用户手势，`browser.permissions.request` 仍有 transient user activation（原始测试按钮点击后再交互 Dialog 已丢失 activation，故不能在原按钮里直接 request）。`ensure(baseUrl)` 返回 `Promise<EnsurePermissionResult>`，`dialog` 是渲染的 JSX。

## 约定

- 遵守 i18n seam：`host-access.ts` 只返回结构化状态/`reason`，**不引 `t()`**。UI 侧 `permission-error.ts` 把 `reason` map 到 `settings.permission.*` locale key；`use-host-permission.tsx` 的弹窗文案走 `settings.permission.{dialogTitle,dialogDesc,grant,cancel}`。
- 消费方：`llm-config-card.tsx`（测试连接 + 获取模型两处）/ `embedding/embedding-config-card.tsx`（测试连接 + 重建两处，单实例 hook，`ensure` 传入 `use-embedding-rebuild.ts`）用 `useHostPermission()`，操作起始处 `await ensure(baseUrl)`，`!ok` 显示本地化错误（测试流程在 `runTest` 内 throw → `useConfigDraft` 的 testError；fetchModels/rebuild 直接 set error state），并在 JSX 里渲染 `{dialog}`。
- 恢复后的 grant 全局持久 → background/offscreen 的 embedding/RAG 管线复用同一权限（SW 无用户手势，无法自行 request，恢复入口只能在 UI）。

## 测试

`host-access.test.ts`（vitest + happy-dom，stub `browser.permissions`）：`hostMatchPattern` 各分支 + `checkHostPermission` 四种 status（`needs-grant` 表示缺失必选 HTTPS access，且分类阶段**不调用 request**）+ `requestHostPermission` 委托 `browser.permissions.request` 并透传布尔。根级 `wxt.config.test.ts` 锁定 `<all_urls>` 必选且无重复 optional 的清单契约。`pnpm test`。
