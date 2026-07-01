# settings

app.html 设置页面组件（顶部分段 Tab + 三个 panel）。

## 模块结构

- `settings-view.tsx` — 设置页面主视图：DashboardContent + 标题"设置" + `SettingsTabs`（本地 `useState` 控制 `ai`/`general`/`storage`）+ 条件渲染三个 panel。AI 配置 panel = LlmConfigCard + AsrConfigCard；通用设置 panel = 语言选择 Card；存储管理 panel = 从 overview 复用的 `ExportCard`
- `settings-tabs.tsx` — 胶囊分段 Tab 控件：MUI `Tabs` 定制（隐藏 `.MuiTabs-indicator` + `fullWidth` + 选中项 `background.paper` 白底 + `customShadows.z1` + `varAlpha` grey 底色容器）。props `{ value, onChange, tabs: SettingsTabItem[] }`，`SettingsTabItem` = `{ value, label, icon: IconifyName }`。新增 tab 只需在 settings-view 的 tabs 数组加一项 + 对应 panel 条件块
- `llm-config-card.tsx` — LLM 配置卡片：Provider 选择 + API Key（显示/隐藏）+ Get Key 链接 + Model（Autocomplete，支持远程获取模型列表）+ Custom 字段 + 测试连接（AI SDK `generateText`）
- `asr-config-card.tsx` — ASR 配置卡片：Provider 选择 + API Key + Model
