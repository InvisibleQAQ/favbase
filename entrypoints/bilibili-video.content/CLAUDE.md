# bilibili-video.content

嵌入B站右侧栏的面板 UI

## 模块结构

- `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后。禁用 `autoMount()`（它在 Vue 水合期间触发导致评论区崩溃），改用手动延迟挂载（page load + 2s）+ 500ms 轮询检测脱离后重挂载

- `player.ts` — 宿主页播放器访问（`seekVideo`），字幕行与总结章节共用，避免两处复制 `document.querySelector('video')`。时间格式化**不在这里**：`m:ss`/`h:mm:ss` 是与运行环境无关的纯函数，统一在 `lib/format.ts` 的 `formatClock`（app.html 时长角标 / 面板字幕行 / 总结章节 / 喂给 LLM 的带行号字幕共用一份）

## 约定

- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏 `.right-container-inner`（UP 主面板后）。**禁用 `autoMount()`** — 它通过 MutationObserver 在锚点出现瞬间挂载，正值 Vue 水合阶段，注入外部节点会破坏 VDOM 导致评论区消失。必须手动延迟挂载：等 `document.readyState === 'complete'` + 2s（与 Bilitato 一致），SPA 路由切换后通过 500ms 轮询检测脱离并 1s 延迟重挂载
- **WXT Shadow DOM 宽度陷阱**: WXT 注入 `:host{all:initial !important}`，底层 `@webext-core/isolated-element` 在 shadow root 内创建 `<html><body>` 包装（body 有 UA `margin:8px`）。`:host` 和 `html,body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素会 `display:inline` 导致不撑满宽度
- **Content Script Design Tokens**: `style.css` 的 `:host` 定义 `--fb-*` CSS 自定义属性，色值/阴影/圆角从 `entrypoints/app/theme/theme-config.ts` 手动同步。修改 app.html 调色板后需同步更新 content script 的 `--fb-*` token。字体保持系统字体栈（不加载 DM Sans/Barlow）
