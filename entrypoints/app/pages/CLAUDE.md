# app/pages

页面组件（lazy loaded）。

## 模块结构

- `dashboard.tsx` → `sections/overview/overview-view.tsx`（统计卡片 + 活动列表 + 进度条）
- `settings.tsx` → `sections/settings/settings-view.tsx`（设置：顶部分段 Tab — AI 配置/账号连接/通用设置/存储管理）
- `bilibili.tsx` → `sections/bilibili/bilibili-view.tsx`（B站收藏夹 sidebar+grid 单页布局）
- `github-stars.tsx` → `sections/github-stars/github-stars-view.tsx`（GitHub Stars 收藏页：语言 chips + 仓库卡片 grid）
- `bookmarks.tsx` → `sections/bookmarks/bookmarks-view.tsx`（浏览器书签收藏页：文件夹 chips + 书签卡片 grid）
- `x.tsx` → `sections/x/x-view.tsx`（X/Twitter 书签收藏页：作者 chips + 推文卡片 grid + 手动同步）
