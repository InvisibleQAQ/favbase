# app/utils

app.html 共享纯函数工具（非组件、非 hook、非 locale 依赖——locale 相关格式化在 `lib/i18n`）。

## 模块结构

- `format-duration.ts` — `formatDuration(seconds)`：秒 → `m:ss`（不足 1 小时）/ `h:mm:ss`（≥1 小时）。消费方：`sections/bilibili/video-card.tsx`、`sections/bilibili/auto-transcribe-bar.tsx`、`sections/youtube/youtube-card.tsx`（时长角标）。由 bilibili section 内两份同名复制提取而来（DRY），并补上小时位（B站/YouTube 长视频原先显示 `83:45` 类非标格式）
