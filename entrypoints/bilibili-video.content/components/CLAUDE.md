# bilibili-video.content/components

B站视频页面板 UI 组件

## 模块结构

- `Panel.tsx` — 主面板容器：左侧图标栏（字幕 / AI 总结 / 设置 三 Tab，activeTab 切换）+ 右侧内容区（header + 可折叠 body），根据 activeTab 渲染 SubtitleView 或 SettingsView（零 props）。Tab 图标是 `IconifyName`（`solar:subtitles-bold-duotone` / `solar:magic-stick-3-bold-duotone` / `solar:settings-bold-duotone`），20px，经 `currentColor` 跟随 `--fb-*` token 变色。**必须用 `@iconify/react` 的裸 `Icon` + `register-icons.ts`，禁止 import `entrypoints/app/components/iconify` 的 barrel 或 `Iconify` 组件**——后者是 `styled(Icon)`，会把 MUI styles engine 拖进来且让 Emotion 把 `<style>` 注入 `document.head`（Shadow DOM **之外**），同时砸掉体积和样式隔离。`registerIcons()` 在模块级调用一次（自带幂等守卫），全量注册不可按图标 tree-shake，CS bundle 为此付约 49 KiB，属已知成本
- `SubtitleView.tsx` — 逐行字幕列表 + 搜索过滤（100ms debounce，CSS display:none 隐藏不匹配行，保持 activeIndex 稳定）+ 搜索高亮（`<mark>` 标黄匹配文本）+ 来源标签（source badge，显示"官方AI字幕"/"ASR 转录"/"ASR 缓存"）+ 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（搜索激活时暂停 auto-scroll，清空搜索后恢复；尊重用户手动滚动意图，4s 超时恢复）
- `SettingsView.tsx` — 面板本地偏好 + 跳转入口（**AI 配置编辑已废除**，收敛到 app.html 设置页的手动保存模型）：语言选择（`useTranslation` 的 `setLocale`，locale 独立于 settingsStorage）+「打开设置页」按钮——发 `OpenAppPageRequest`（`{ type: 'OPEN_APP_PAGE', hash: '#/settings' }`）委托 background 打开/聚焦 app.html（CS 无 `browser.tabs` 权限）。零 props；原 LLM/ASR 编辑 UI 及对应 `favbase-settings-{saved,label,link,input,toggle,mode-*}` CSS 已删，新增 `favbase-settings-desc`/`favbase-settings-open-app`
- `StatusBar.tsx` — 加载/无字幕/错误状态（来源信息已迁移到 SubtitleView 的 source badge）
- `SummaryView.tsx` — AI 总结 Tab：五态（无字幕提示 / 未配置 LLM 提示+打开设置页 / 未生成的生成按钮 / 生成中的流式 Markdown+spinner+取消 / 已完成的总结+章节列表+footer(模型·时间·重新生成)）。错误经 `translateError(code)` 走 `summaryError.*` locale key，不渲染 `error.message` 原文。章节点击调 `../player` 的 `seekVideo`，`ad` 类型加广告 badge
- `Markdown.tsx` — ~120 行 Markdown 渲染器（标题/有序无序列表/段落/围栏代码/粗斜体/行内 code）。**输出 React 元素而非 `dangerouslySetInnerHTML`**——模型输出天然被 React 转义，注入不了标记。面板只有 ~300px 宽，各级标题统一收敛成同一视觉权重；表格与链接不特殊处理（降级为纯文本）。测试在 `tests/panel-markdown.test.tsx`（`renderToStaticMarkup`，含转义断言）
- `TranscribeButton.tsx` — 转录触发按钮 + 进度条（分阶段）+ 取消按钮 + 错误/重试 + rate limit 倒计时。stage/error 通过 `translateStage()`/`translateError()` 调用 `t()` 翻译，不直接渲染 error.message
