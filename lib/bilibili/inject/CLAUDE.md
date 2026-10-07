# lib/bilibili/inject

B站视频页 Main World 脚本（入口 `entrypoints/bilibili-inject.content.ts`）：拦截 fetch / XHR 被动捕获字幕，并监控 SPA 路由。

## 约束

- 跑在 Main World：本目录及它 import 的 `../url-utils.ts`、`../messaging.ts` 不得依赖 `chrome.*` / `browser.*`；与 Content Script 的通信只经 `postBiliMessage`。
- 状态转换与定时器全部收在 `state.ts` 的 `createStateMachine(effects)`；DOM 与 postMessage 副作用只经 `InjectEffects` 注入。拦截器和路由监控只调状态机的方法，不自己改状态或碰 DOM——这是状态机可单测的前提。
- 防串台靠四道守卫，缺一不可（SPA 切视频时，旧视频的字幕会被记到新视频名下）：
  - generation：路由切换后丢弃旧的 in-flight 拦截结果；
  - `isPageMetaConsistent()`：`__INITIAL_STATE__` 的 bvid 与 URL 不一致、或数据缺失，都返回 false（严格模式，SPA 过渡期就是这种状态）；
  - `markCaptured` 的 URL 漂移检查：捕获时 URL 的 bvid 与当前 URL 不一致即拒绝；
  - reemit 守卫：重发缓存的字幕前，验证捕获时的 bvid 仍等于当前 URL 的 bvid。
- fetch 拦截器必须在 `await` 之前同时取 generation 和 `location.href`，XHR 在 `send()` 时取：等到异步回调里再读，拿到的是已经变化的 URL。
- `resetForRoute()` 必须级联：generation 自增、清掉全部定时器、`restoreDisplay`，再通知路由切换、延迟重发 handshake 并重新触发 CC 按钮。漏掉任何一步，上一个视频的状态都会漏进下一个。
- 这里的 bvid 比较是大小写无关的；发给 Content Script 的 bvid 仍保留 URL 里的原始大小写。
- 自动点播放器的 CC 按钮是获取字幕的手段（逼播放器自己发字幕请求），捕获后临时隐藏字幕显示再还原；不是可以顺手删掉的副作用。
