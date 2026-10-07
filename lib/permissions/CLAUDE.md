# lib/permissions

host access 的检查与恢复：确认用户配置的 API / WebDAV origin 仍有站点访问权，并在 HTTPS 权限被拒绝或收回后从设置页恢复。

## 约束

- `wxt.config.ts` 静态声明必选 `<all_urls>`（书签正文提取要求），它同时覆盖内置 provider、自定义 API 与 WebDAV origin；不要再声明 `optional_host_permissions`。守卫：根目录 `wxt.config.test.ts`。
- 声明了不等于拿到了：用户可以在安装时拒绝或事后收回站点访问。MV3 扩展页对没有有效 grant 的 host 按 CORS 处理，所以对用户填的 origin，fetch 前必须先 `checkHostPermission`。
- 「分类」与「恢复」是两个原语，刻意不合并成一个原子的「检查并申请」函数：UI 要在中间插解释弹窗。`checkHostPermission` 只分类，绝不弹窗。
- `requestHostPermission` 必须在用户手势内调用（transient user activation，约 5 秒）。原按钮点击后再经过一个 Dialog 就已丢了 activation，所以原生授权弹窗要推迟到 Dialog 的「允许」按钮——那是一次新的手势。
- 恢复入口只能在 UI：SW / offscreen 没有用户手势，无法自己 request。恢复后的 grant 全局持久，后台的 embedding / RAG 管线复用同一权限。
- 本模块只恢复 HTTPS：缺 grant 的非 https origin 归 `unsupported-scheme`，不进授权流程。
- i18n seam：`host-access.ts` 只返回结构化 status / `reason`，不引 `t()`；`reason` 到 locale key 的映射在 `entrypoints/app/sections/settings/permission-error.ts`。

## 坑

- match pattern 不接受端口：`hostMatchPattern` 用 `hostname` 去掉端口（ollama `:11434`、自定义端口都靠它），别换成 `host`。

## 指针

- 粘合两个原语的 hook 与解释弹窗：`entrypoints/app/sections/settings/use-host-permission.tsx`（返回 `ensure(baseUrl)` 和要渲染的 `dialog`）。
