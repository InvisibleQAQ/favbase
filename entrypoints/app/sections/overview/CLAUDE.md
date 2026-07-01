# overview

app.html Dashboard 概览页面组件。

## 模块结构

- `stat-widget.tsx` — 统计卡片：圆形图标背景 + varAlpha 色调 + title/total
- `export-card.tsx` — MUI Card 导出 UI：格式切换（JSON/CSV）+ embedding Checkbox + 导出按钮 + 空数据/DB 未就绪错误处理。文件留在 overview/ 目录，但渲染位置已移到 settings 页面"存储管理" tab（settings-view 从此处 import），不再挂在 Dashboard
