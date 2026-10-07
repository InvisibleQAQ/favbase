# bilibili-video.content/components

面板 UI 组件（字幕 / AI 总结 / 设置三个 Tab）。样式与 token 契约见上级目录的 `CLAUDE.md`。

- 图标必须用 `@iconify/react` 的裸 `Icon` + `entrypoints/app/components/iconify/register-icons` 的 `registerIcons()`；禁止 import 该目录的 barrel 或 `Iconify` 组件——它是 `styled(Icon)`，会把 MUI styles engine 拖进来，Emotion 的 `<style>` 注入 `document.head`（Shadow DOM 之外）。
- `registerIcons()` 是全量注册，不可按图标 tree-shake（CS bundle 为此付约 49 KiB）：已知并接受的成本。
- 错误与阶段一律经 `translateError` / `translateStage` 走 locale key，不渲染 `error.message` 原文。
- `Markdown.tsx` 只输出 React 元素，禁用 `dangerouslySetInnerHTML`（模型输出不可信）；只渲染总结 prompt 要求的子集，表格与链接降级为纯文本是刻意的。守卫 `tests/panel-markdown.test.tsx`。
- AI 配置不在面板里编辑：`SettingsView` 只留语言选择与「打开设置页」。content script 没有 `browser.tabs`，打开 app.html 要发 `OPEN_APP_PAGE` 委托 background。
- 字幕搜索用 `display: none` 隐藏不匹配行，而不是过滤数组：行索引与 `activeIndex` 必须保持稳定。
