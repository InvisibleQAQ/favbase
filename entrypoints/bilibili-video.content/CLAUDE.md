# bilibili-video.content

嵌入 B 站视频页右侧栏的面板 UI：WXT `createShadowRootUi` + React，原生 CSS + `--fb-*` token，不用 MUI。

## 约束

- 不得 import MUI / Emotion：Emotion 把 `<style>` 注入 `document.head`，落在 Shadow DOM 之外。图标的写法见 `components/CLAUDE.md`。
- 明暗差异只允许出现在 `style.css` 唯一的 `@media (prefers-color-scheme: dark)` 的 `:host` 覆盖里；组件级规则禁止出现 `prefers-color-scheme` 分支。
- 组件规则禁止直接用 `--fb-grey-*` 与 `--fb-*-lighter`（不随 scheme 变，暗色下会反转），一律走语义别名：`--fb-text-body` / `--fb-text-faint`、`--fb-track` / `--fb-track-strong`、`--fb-<color>-fg` + `--fb-<color>-soft-bg`。
- `--fb-*` 色值从 `entrypoints/app/theme/theme-config.ts` 手工同步，暗色覆盖对照 `entrypoints/app/theme/core/palette.ts` 的 dark colorScheme；**无自动守卫**，改 app.html 调色板后要手工同步这里。
- 字体保持系统字体栈，不加载 DM Sans / Barlow。
- 时间格式化用 `lib/format.ts` 的 `formatClock`，跳转播放器用 `player.ts` 的 `seekVideo`，别在组件里各写一份。

## 坑

- 禁用 `ui.autoMount()`：它经 MutationObserver 在锚点出现瞬间挂载，正值 Vue 水合，注入外部节点会破坏 VDOM、评论区消失。必须手动延迟挂载（`readyState === 'complete'` + 2s，与 Bilitato 一致），SPA 切换后由轮询检测脱离再延迟重挂载。
- WXT 注入 `:host{all:initial !important}`，且 `@webext-core/isolated-element` 在 shadow root 里建了 `<html><body>`（body 有 UA `margin:8px`）：`:host` 与 `html, body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素是 `display:inline`、撑不满宽度。
- 深浅色跟随 OS / 浏览器偏好，不跟随 app.html 的主题开关（它存在扩展 origin 的 `localStorage`，`bilibili.com` 的 content script 读不到），也不跟随 B 站站内深色。「OS 深色 + B 站浅色」时面板是白页里的深色卡片：已知并接受，别加探测代码。
- `:host` 的 `color-scheme: light dark` 不是装饰：设置 Tab 的原生 `<select>` 靠它跟随明暗。
