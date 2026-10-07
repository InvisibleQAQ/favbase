# lib/http

平台 HTTP 的共享执行机制：统一请求 deadline（`fetch-with-deadline.ts`）、节流 / 退避原语（`backoff.ts`）、瞬时错误重试循环（`retry.ts`）、响应读取（`response-body.ts`）。全部是纯 leaf，任何 runtime 可导入。

## 约束

- **lib 层禁止裸 `fetch(`**，一律走 `fetchWithDeadline`。守卫 `tests/http-fetch-deadline-guard.test.ts` 扫 `lib/**`，新平台自动纳入。
- 豁免必须写进该测试的 `ALLOWED_BARE_FETCH` 并注明理由。现有豁免都是固定 deadline 语义上不适用的：LLM 流式、ASR 音频上传 / 下载、FFmpeg core 下载、抖音页内注入函数。
- **一个 deadline 管所有平台**（`VITE_HTTP_DEADLINE_SECONDS`，单位秒）：不设 per-platform 覆盖，平台层禁止再造私有超时常量。
- deadline 计时器有意不清除：它覆盖整个请求生命周期，含 body 读取（`res.json()` / `res.text()` / stream 都以 `HttpDeadlineError` 拒绝）。别在 headers 返回后「顺手」clear。
- **平台目录不手写等待**：`lib/<platform>/` 里 `new Promise` 包 `setTimeout` 即 fail，守卫 `tests/platform-sleep-guard.test.ts`（新平台自动纳入）。等待用 `sleep`，延迟用 `jitteredDelayMs` / `backoffDelayMs`，瞬时错误重试用 `withRetries`。
- 上一条的已知缺口：别名（`const st = setTimeout`）不追踪。不在 `new Promise` 里的 `setTimeout` 是定时回调，放行。
- 只共享机制，不共享数值：各平台的节流 / 重试数值留在平台目录，且必须经 `lib/env.ts` 的 `envNumber` 可配置。守卫 `tests/platform-env-constants-guard.test.ts`。
- `retry.ts` 只 import `./backoff` 与 `cooperative-checkpoint` 的 type，不走 `@/lib/collections` barrel。

## 重试语义（`withRetries` / `retryAfter`）

- 一次调用一个计数器，跨重试原因共享预算（X 的 429 / 5xx / code:88 共用一份）。
- 只有 attempt **返回** `RetrySignal` 才重试；抛出的错误原样穿透，不重试。
- `retryAfter` 的 `delayMs` 与 `exhausted` 都是懒调用：被重试的响应不读 body，只有最后一次才读。
- 传了 `control` 就在每次尝试前（含第一次）checkpoint。x、douyin 传；zhihu 刻意不传——它的分页调用方每页 checkpoint 一次，每次重试再 checkpoint 会改变频率（`lib/zhihu/zhihu-api.test.ts` 锁住）。
- github / youtube / bilibili 没有瞬时错误重试，是刻意没加：那是平台风控语义的行为变化，要单独决定，别顺手套 `withRetries`。
- B 站转录字幕重试（`lib/bilibili/bilibili-transcription-adapter.ts`）不迁入 `withRetries`：它重试的是抛出的异常、耗尽返回 `null` 落 ASR，形状不同。

## 响应读取

- 错误片段长度只在 `response-body.ts` 定义一次（`SNIPPET_CHARS`），平台不要再写自己的截断。
- `parseJsonBody` 收已读出的字符串，不收 `Response`：调用方要在状态码判断前读 body，解析后还要拿原文拼别的错误。
