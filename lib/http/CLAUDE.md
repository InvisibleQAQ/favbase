# lib/http — HTTP 执行 seam（统一请求 deadline + 共享退避原语）

来源：架构体检 2026-08-17 问题 #5（远程平台 HTTP Adapter 没有请求 deadline）；平台常量调研 2026-08-18（x/zhihu 逐行复制的退避实现合并）。

## 文件

- `fetch-with-deadline.ts` — 纯 leaf 模块（零 storage/DB/chrome.* 导入，任何 runtime 可安全导入：Background SW / Content Script / app.html / Offscreen）
  - `fetchWithDeadline(input, init?)` — 带统一 deadline 的 `fetch`。调用方 `init.signal` 经 `AbortSignal.any` 合并（调用方 abort 原 reason 透传）；deadline 触发以 `HttpDeadlineError` 为 abort reason，请求与后续 body 读取（`res.json()`/`res.text()`/stream）拒绝同一错误
  - `HttpDeadlineError` — `name='HttpDeadlineError'`，携带 `url` + `deadlineMs`，供平台层按 name 分类（如 bookmarks 归 `'timeout'` 瞬态）
  - `resolveHttpDeadlineMs()` — 调用时读 `import.meta.env.VITE_HTTP_DEADLINE_SECONDS`（单位秒；构建期内联，改 `.env.local` 需重跑 `pnpm dev`）；缺省/非法回退 `DEFAULT_HTTP_DEADLINE_SECONDS`（30s）
- `backoff.ts` — 平台 HTTP Adapter 共享节流/退避原语，纯 leaf（消灭 x/zhihu 逐行复制 + youtube/bookmarks 同款 `sleep`）：
  - `sleep(ms)`；`jitteredDelayMs(base, jitter, random?)` = `base + random()*jitter`（串行页间节流，bilibili `favoritePageDelayMs` 亦复用）；`backoffDelayMs(attempt, base, jitter, random?)` = `base * 2^(attempt-1) + random()*jitter`（瞬态 429/5xx 指数退避，attempt 1-based，重试上限归调用方）
  - 延迟计算与等待分离，`random` 注入可测；**只共享机制不共享数值**——各平台节流数值留平台目录，且必须经 `lib/env.ts` 的 `envNumber('VITE_<PLATFORM>_<NAME>', default)` 可配置（守卫 `tests/platform-env-constants-guard.test.ts`：裸数值标量 const 直接 fail，fallback 锁定默认值，env key↔调用点↔`.env.example`/`.env.local` 注释三方同步）

## 铁律

- **一个数值管所有平台**：不设 per-platform 覆盖，平台层禁止再造私有超时常量（bookmarks 旧 `FETCH_TIMEOUT_MS=15s` 已删除并统一）
- **未来平台自动强制**：`tests/http-fetch-deadline-guard.test.ts` 扫描 `lib/**`，裸 `fetch(` 即 fail；豁免须在该测试 allowlist 注明理由（现有豁免：`lib/ai`（LLM 流式）、`lib/transcription`（音频上传/下载）、`lib/offscreen`（FFmpeg core 大文件），语义上不适用固定 deadline）
- deadline 计时器有意不清除——覆盖整个请求生命周期含 body 读取；请求已完成后 abort 是 no-op（Node 下 unref，不挂测试进程）

## 测试

`fetch-with-deadline.test.ts`：env 解析（默认/秒/小数/非法回退，`vi.stubEnv`）+ 永不结算的 fetch 在 deadline 抛 `HttpDeadlineError` + 调用方 abort 透传 + 正常路径 init 透传。
`backoff.test.ts`：注入 random 锁 `jitteredDelayMs` 区间端点与 `backoffDelayMs` 倍增序列。
