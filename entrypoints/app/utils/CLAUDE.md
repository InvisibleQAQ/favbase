# app/utils

app.html 共享纯函数工具（非组件、非 hook、非 locale 依赖——locale 相关格式化在 `lib/i18n`）。

## 模块结构

- `format-duration.ts` — `formatDuration(seconds)`：秒 → `m:ss`（不足 1 小时）/ `h:mm:ss`（≥1 小时）。消费方：`sections/bilibili/video-card.tsx`、`sections/bilibili/auto-transcribe-bar.tsx`、`sections/youtube/youtube-card.tsx`（时长角标）。**本文件只是域内命名别名，实现在 `lib/format.ts` 的 `formatClock`**——content script 面板与 `lib/summary` prompt 也用同一份，改格式只改 lib 那一处
