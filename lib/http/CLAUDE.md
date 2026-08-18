# lib/http — HTTP 执行 seam（统一请求 deadline）

来源：架构体检 2026-08-17 问题 #5（远程平台 HTTP Adapter 没有请求 deadline）。

## 文件

- `fetch-with-deadline.ts` — 唯一文件，纯 leaf 模块（零 storage/DB/chrome.* 导入，任何 runtime 可安全导入：Background SW / Content Script / app.html / Offscreen）
  - `fetchWithDeadline(input, init?)` — 带统一 deadline 的 `fetch`。调用方 `init.signal` 经 `AbortSignal.any` 合并（调用方 abort 原 reason 透传）；deadline 触发以 `HttpDeadlineError` 为 abort reason，请求与后续 body 读取（`res.json()`/`res.text()`/stream）拒绝同一错误
  - `HttpDeadlineError` — `name='HttpDeadlineError'`，携带 `url` + `deadlineMs`，供平台层按 name 分类（如 bookmarks 归 `'timeout'` 瞬态）
  - `resolveHttpDeadlineMs()` — 调用时读 `import.meta.env.VITE_HTTP_DEADLINE_SECONDS`（单位秒；构建期内联，改 `.env.local` 需重跑 `pnpm dev`）；缺省/非法回退 `DEFAULT_HTTP_DEADLINE_SECONDS`（30s）

## 铁律

- **一个数值管所有平台**：不设 per-platform 覆盖，平台层禁止再造私有超时常量（bookmarks 旧 `FETCH_TIMEOUT_MS=15s` 已删除并统一）
- **未来平台自动强制**：`tests/http-fetch-deadline-guard.test.ts` 扫描 `lib/**`，裸 `fetch(` 即 fail；豁免须在该测试 allowlist 注明理由（现有豁免：`lib/ai`（LLM 流式）、`lib/transcription`（音频上传/下载）、`lib/offscreen`（FFmpeg core 大文件），语义上不适用固定 deadline）
- deadline 计时器有意不清除——覆盖整个请求生命周期含 body 读取；请求已完成后 abort 是 no-op（Node 下 unref，不挂测试进程）

## 测试

`fetch-with-deadline.test.ts`：env 解析（默认/秒/小数/非法回退，`vi.stubEnv`）+ 永不结算的 fetch 在 deadline 抛 `HttpDeadlineError` + 调用方 abort 透传 + 正常路径 init 透传。
