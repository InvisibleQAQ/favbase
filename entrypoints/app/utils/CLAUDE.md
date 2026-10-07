# app/utils

app.html 共享的纯函数工具（非组件、非 hook）。

- 依赖 locale 的格式化不放这里，放 `lib/i18n`。
- `formatDuration` 只是 `lib/format.ts` 的 `formatClock` 的域内别名：Content Script 面板与 `lib/summary` 的 prompt 用同一份，改格式只改 lib 那一处。
