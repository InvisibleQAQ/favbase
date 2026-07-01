# lib/bilibili/inject

B站 Main World inject 状态机：拦截 fetch/XHR 被动捕获字幕 + SPA 路由监控。

## 模块结构

- `entrypoints/bilibili-inject.content.ts` — Main World 入口协调器：创建 effects + 状态机 + 拦截器 + 路由监控，5 行 bootstrap
- `state.ts` — InjectStateMachine 状态机（createStateMachine(effects)），拥有全部状态转换（bootstrap/markCaptured/resetForRoute）+ 定时器编排 + reemit loop。通过 InjectEffects 接口注入副作用，纯逻辑可单元测试
- `effects.ts` — InjectEffects 生产实现（createBrowserEffects()）：DOM 操作（triggerCC/hideSubtitleDisplay/restoreDisplay）+ resolvePageMeta() 页面元数据 + isPageMetaConsistent()（检查 `__INITIAL_STATE__` bvid 与 URL bvid 一致性，SPA 过渡期间返回 false）+ 通过 messaging.ts 的 postBiliMessage() 桥接消息
- `interceptors.ts` — fetch/XHR 覆写（installInterceptors(sm)），使用 url-utils.ts 的 isSubtitleCdnUrl() 检测字幕响应后调用 sm.markCaptured()
- `route-monitor.ts` — 300ms SPA 路由轮询（startRouteMonitor(sm)），检测 BV 号/分P 变化后调用 sm.resetForRoute()

## 约定

- Inject 状态机: 三阶段生命周期 idle → triggering → captured，通过 InjectEffects 接口注入 DOM/postMessage 副作用，状态转换集中在 state.ts 的 createStateMachine() 内。四层防串台守卫：(1) generation 并发守卫防止路由切换后旧 in-flight 拦截结果被采纳 (2) `isPageMetaConsistent()` 检查 `__INITIAL_STATE__` bvid 与 URL bvid 一致性（缺失数据返回 false，严格模式） (3) markCaptured URL 漂移检查：capturedUrl 的 bvid 与当前 URL bvid 不一致则拒绝（防止 fetch 期间 URL 变化） (4) reemit 路由守卫：re-post cachedSubtitleBody 前验证 capturedBvid 与当前 URL bvid 一致。fetch 拦截器必须在 `await` 之前同时捕获 generation 和 `location.href`（interceptors.ts），XHR 在 send() 时捕获，防止异步回调读取到已变化的 URL
- SPA 路由监控: route-monitor.ts 300ms 轮询 location.href 检测 BV 号/分P 变化 → sm.resetForRoute() 级联重置（generation++、清理定时器、restoreDisplay） → ROUTE_SWITCH 即时通知 → 800ms 后重发 HANDSHAKE → 重触发 CC 按钮
