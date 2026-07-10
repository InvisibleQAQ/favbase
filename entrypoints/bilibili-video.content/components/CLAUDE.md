# bilibili-video.content/components

B站视频页面板 UI 组件

## 模块结构

- `Panel.tsx` — 主面板容器：左侧图标栏（CC + Settings Tab，activeTab 切换）+ 右侧内容区（header + 可折叠 body），根据 activeTab 渲染 SubtitleView 或 SettingsView（零 props）
- `SubtitleView.tsx` — 逐行字幕列表 + 搜索过滤（100ms debounce，CSS display:none 隐藏不匹配行，保持 activeIndex 稳定）+ 搜索高亮（`<mark>` 标黄匹配文本）+ 来源标签（source badge，显示"官方AI字幕"/"ASR 转录"/"ASR 缓存"）+ 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（搜索激活时暂停 auto-scroll，清空搜索后恢复；尊重用户手动滚动意图，4s 超时恢复）
- `SettingsView.tsx` — 面板本地偏好 + 跳转入口（**AI 配置编辑已废除**，收敛到 app.html 设置页的手动保存模型）：语言选择（`useTranslation` 的 `setLocale`，locale 独立于 settingsStorage）+「打开设置页」按钮——发 `OpenAppPageRequest`（`{ type: 'OPEN_APP_PAGE', hash: '#/settings' }`）委托 background 打开/聚焦 app.html（CS 无 `browser.tabs` 权限）。零 props；原 LLM/ASR 编辑 UI 及对应 `favbase-settings-{saved,label,link,input,toggle,mode-*}` CSS 已删，新增 `favbase-settings-desc`/`favbase-settings-open-app`
- `StatusBar.tsx` — 加载/无字幕/错误状态（来源信息已迁移到 SubtitleView 的 source badge）
- `TranscribeButton.tsx` — 转录触发按钮 + 进度条（分阶段）+ 取消按钮 + 错误/重试 + rate limit 倒计时。stage/error 通过 `translateStage()`/`translateError()` 调用 `t()` 翻译，不直接渲染 error.message
