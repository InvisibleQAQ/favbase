# lib/http — HTTP 执行 seam（统一请求 deadline + 共享退避原语 + 重试循环 + 响应读取）

来源：架构体检 2026-08-17 问题 #5（远程平台 HTTP Adapter 没有请求 deadline）；平台常量调研 2026-08-18（x/zhihu 逐行复制的退避实现合并）；docs/32 Step 3（2026-09-30，x/zhihu 两份重试循环、两份 `bodySnippet`、三份「读 body → 解析 → 非 JSON 抛片段」收进 `retry.ts` / `response-body.ts`，平台目录零 `setTimeout` 等待）。

## 文件

- `fetch-with-deadline.ts` — 纯 leaf 模块（零 storage/DB/chrome.* 导入，任何 runtime 可安全导入：Background SW / Content Script / app.html / Offscreen）
  - `fetchWithDeadline(input, init?)` — 带统一 deadline 的 `fetch`。调用方 `init.signal` 经 `AbortSignal.any` 合并（调用方 abort 原 reason 透传）；deadline 触发以 `HttpDeadlineError` 为 abort reason，请求与后续 body 读取（`res.json()`/`res.text()`/stream）拒绝同一错误
  - `HttpDeadlineError` — `name='HttpDeadlineError'`，携带 `url` + `deadlineMs`，供平台层按 name 分类（如 bookmarks 归 `'timeout'` 瞬态）
  - `resolveHttpDeadlineMs()` — 调用时读 `import.meta.env.VITE_HTTP_DEADLINE_SECONDS`（单位秒；构建期内联，改 `.env.local` 需重跑 `pnpm dev`）；缺省/非法回退 `DEFAULT_HTTP_DEADLINE_SECONDS`（30s）
- `backoff.ts` — 平台 HTTP Adapter 共享节流/退避原语，纯 leaf（消灭 x/zhihu 逐行复制 + youtube/bookmarks 同款 `sleep`）：
  - `sleep(ms)`；`jitteredDelayMs(base, jitter, random?)` = `base + random()*jitter`（串行页间节流，bilibili `favoritePageDelayMs` 亦复用）；`backoffDelayMs(attempt, base, jitter, random?)` = `base * 2^(attempt-1) + random()*jitter`（瞬态 429/5xx 指数退避，attempt 1-based，重试上限归调用方）
  - 延迟计算与等待分离，`random` 注入可测；**只共享机制不共享数值**——各平台节流数值留平台目录，且必须经 `lib/env.ts` 的 `envNumber('VITE_<PLATFORM>_<NAME>', default)` 可配置（守卫 `tests/platform-env-constants-guard.test.ts`：裸数值标量 const 直接 fail，fallback 锁定默认值，env key↔调用点↔`.env.example`/`.env.local` 注释三方同步）
- `retry.ts` — 瞬时错误重试循环骨架，纯 leaf（只 import `./backoff` 的 `sleep` 与 `@/lib/collections/cooperative-checkpoint` 的 **type**，不走 `@/lib/collections` barrel）：
  - `withRetries({ maxRetries, control? }, attempt)`：每次尝试前（含第一次）`await control?.checkpoint()`；`attempt()` 返回非 `RetrySignal` 即原样返回、抛错原样穿透不重试；返回 `RetrySignal` 时 `retries >= maxRetries` 就抛 `await exhausted()`，否则 `retries += 1` 后 `sleep(delayMs(retries))`——最多 `maxRetries` 次重试。**一次调用一个计数器**，跨重试原因共享（X 的 429 / 5xx / code:88 共用一份预算）
  - `retryAfter(delayMs, exhausted)` → `RetrySignal`：平台在 attempt 里声明「这个响应要重试、等多久、耗尽抛什么」。两个回调都**懒调用**：`delayMs(retry)`（1-based，同 `backoffDelayMs`）只在真要睡时调，`exhausted()` 只在真要抛时调一次——x/zhihu 只读最后那次 5xx 的 body，被重试的从不读。判别用 `instanceof`，不看结构（成功值是平台任意形状）
  - 调用方：x `fetchPageWithBackoff`（传 `control`）、zhihu `fetchZhihuJson`（**刻意不传** `control`：分页调用方每页 checkpoint 一次，`zhihu-api.test.ts` 锁两页两次）。github/youtube/bilibili 今天没有瞬时错误重试，**没加**——那是平台风控语义的行为变化，要单独决定。B站转录字幕重试（`bilibili-transcription-adapter.ts`）重试的是**抛出的**异常、耗尽返回 `null` 落 ASR，形状不同，不迁入，只把等待换成 `sleep`
- `response-body.ts` — 响应读取 helper，纯 leaf。`SNIPPET_CHARS = 300` 是全仓唯一的错误片段长度：
  - `textSnippet(text)` — 前 300 字符；`bodySnippet(res)` — 读 body 取片段，读失败（已消费/中止）返回 `''`
  - `parseJsonBody(raw, what, suffix = '')` — **从已读出的字符串解析**，不收 `Response`：youtube 要在状态码判断前读 body 取 400/403 reason，x/zhihu 解析后还要拿 `rawBody` 拼别的错误。失败抛 `` `${what} with non-JSON body: ${textSnippet(raw)}${suffix}` ``，措辞归调用方（x 传 `DIAG_SUFFIX`）

## 铁律

- **一个数值管所有平台**：不设 per-platform 覆盖，平台层禁止再造私有超时常量（bookmarks 旧 `FETCH_TIMEOUT_MS=15s` 已删除并统一）
- **未来平台自动强制**：`tests/http-fetch-deadline-guard.test.ts` 扫描 `lib/**`，裸 `fetch(` 即 fail；豁免须在该测试 allowlist 注明理由（现有豁免：`lib/ai`（LLM 流式）、`lib/transcription`（音频上传/下载）、`lib/offscreen`（FFmpeg core 大文件），语义上不适用固定 deadline）
- deadline 计时器有意不清除——覆盖整个请求生命周期含 body 读取；请求已完成后 abort 是 no-op（Node 下 unref，不挂测试进程）
- **平台目录不手写等待**：`tests/platform-sleep-guard.test.ts` 扫 `lib/<platform>/`（由 `COLLECTION_PLATFORMS` 派生，新平台自动纳入）的非测试 `.ts`/`.tsx`，按 AST 判定 `new Promise(...)` 参数子树里的 `setTimeout(...)` 即 fail，失败列 `file:line`（`Promise` 与 `setTimeout` 两个名字都认裸写或挂在 `globalThis`/`window`/`self` 上——点号或 `['…']`——并穿过 `(… as any)`、`!` 这类只改类型的包裹；别名 `const st = setTimeout` 不追踪，是已知缺口）；不在 `new Promise` 里的 `setTimeout` 是定时回调，放行（`lib/bilibili/inject/*`、`messaging.ts` 的 `setTimeout(send, 0)`）。等待用 `sleep`，延迟用 `jitteredDelayMs`/`backoffDelayMs`，瞬时错误重试用 `withRetries`

## 测试

`fetch-with-deadline.test.ts`：env 解析（默认/秒/小数/非法回退，`vi.stubEnv`）+ 永不结算的 fetch 在 deadline 抛 `HttpDeadlineError` + 调用方 abort 透传 + 正常路径 init 透传。
`backoff.test.ts`：注入 random 锁 `jitteredDelayMs` 区间端点与 `backoffDelayMs` 倍增序列。
`retry.test.ts`（fake timers）：首次成功零 sleep 且原值返回；抛错穿透不重试、`exhausted` 不调；连续 signal 恰好 `maxRetries` 次重试后抛 `exhausted` 的错误且只构造一次，`delayMs` 依次收到 `1..maxRetries`；异步 `exhausted`；`maxRetries: 0` 不算延迟；按 signal 的延迟等待；跨原因共享预算与中途成功；checkpoint 每次尝试前一次（含第一次）、拒绝时不进 attempt；结构相似的成功值不被当成 signal。
`response-body.test.ts`：`textSnippet` 截 300；`bodySnippet` 对已读过的 Response 返回 `''`；`parseJsonBody` 成功返回解析值、失败消息逐字节（有 / 无 suffix 各一例）。
