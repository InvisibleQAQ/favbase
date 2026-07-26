# bilibili-video.content

嵌入B站右侧栏的面板 UI

## 模块结构

- `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后。禁用 `autoMount()`（它在 Vue 水合期间触发导致评论区崩溃），改用手动延迟挂载（page load + 2s）+ 500ms 轮询检测脱离后重挂载

- `player.ts` — 宿主页播放器访问（`seekVideo`），字幕行与总结章节共用，避免两处复制 `document.querySelector('video')`。时间格式化**不在这里**：`m:ss`/`h:mm:ss` 是与运行环境无关的纯函数，统一在 `lib/format.ts` 的 `formatClock`（app.html 时长角标 / 面板字幕行 / 总结章节 / 喂给 LLM 的带行号字幕共用一份）

## 约定

- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏 `.right-container-inner`（UP 主面板后）。**禁用 `autoMount()`** — 它通过 MutationObserver 在锚点出现瞬间挂载，正值 Vue 水合阶段，注入外部节点会破坏 VDOM 导致评论区消失。必须手动延迟挂载：等 `document.readyState === 'complete'` + 2s（与 Bilitato 一致），SPA 路由切换后通过 500ms 轮询检测脱离并 1s 延迟重挂载
- **WXT Shadow DOM 宽度陷阱**: WXT 注入 `:host{all:initial !important}`，底层 `@webext-core/isolated-element` 在 shadow root 内创建 `<html><body>` 包装（body 有 UA `margin:8px`）。`:host` 和 `html,body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素会 `display:inline` 导致不撑满宽度
- **Content Script Design Tokens**: `style.css` 的 `:host` 定义 `--fb-*` CSS 自定义属性，色值/阴影/圆角从 `entrypoints/app/theme/theme-config.ts` 手动同步（**无自动守卫**，改 app.html 调色板后必须手工同步这里）。字体保持系统字体栈（不加载 DM Sans/Barlow）
- **深浅色跟随浏览器**: 面板深色由 `style.css` 里唯一的 `@media (prefers-color-scheme: dark)` 块驱动，即 **OS/浏览器**偏好。**不跟随 app.html 的主题开关**——那个设置在 `localStorage['favbase-color-mode']`，按 origin 隔离，`bilibili.com` 的 content script 读不到；也不跟随 B站站内深色模式（B站深色独立于 OS，故「OS 深色 + B站浅色」时面板是白页里的深色卡片，这是**已知并接受**的取舍，换来零探测代码、零维护）。暗色取值镜像 `entrypoints/app/theme/core/palette.ts` 的 dark colorScheme；primary/error/success/warning/grey **不覆盖**，因为 `palette.ts` 里这些明暗共用
- **Token 契约**: 所有明暗差异只出现在那个 media query 的 `:host` 覆盖里，**组件级规则禁止出现 `prefers-color-scheme` 分支**。组件规则也禁止直接用 `--fb-grey-*` 或 `--fb-*-lighter`（它们不随 scheme 变，暗色下会反转翻车），一律走语义别名：`--fb-text-body`/`--fb-text-faint`（文本梯度）、`--fb-track`/`--fb-track-strong`（滚动条/进度条/spinner 等惰性表面）、`--fb-<color>-fg` + `--fb-<color>-soft-bg`（着色对：错误条、广告 badge、sidebar 选中态、搜索 `<mark>`；light 用实色 `lighter`，dark 用 `main` 的 16% alpha）。`:host` 另设 `color-scheme: light dark`，让 SettingsView 的原生 `<select>` 跟随
