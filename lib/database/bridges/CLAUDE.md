# Database Bridges

RPC 桥接层。

## 模块结构

- `types.ts` — RPC 协议：请求/响应/transport，以及显式 transaction lifecycle op + opaque `transactionId` + caller `deadlineAt`
- `serialization.ts` — Date ↔ `{ __type:'Date', __value: ISO }` 标记序列化（Chrome Port 安全）
- `proxy-driver.ts` — `PGliteSharedProxy`（implements PGliteLike，请求 ID 关联 + 30s 超时；本地 mutex 只负责同 proxy 串行，事务 callback client 给 query/exec 携带同一随机 identity）
- `chrome-port-rpc.ts` — `createChromePortTransport()`（`chrome.runtime.connect`，指数退避重连，消息队列）
- `rpc-handler.ts` — `DatabaseRpcHandler`（Offscreen singleton + PGlite session 的事务 owner；owner 请求运行，foreign 请求排队，错误 identity 拒绝，commit/rollback/port disconnect 必须释放；过期请求执行前拒绝，过期/非法 deadline 的 lifecycle finish 先 server-side rollback；`stop()` 拒绝队列并等待 owner rollback）

## 事务约束

- 禁止从 SQL 文本识别 BEGIN/COMMIT/ROLLBACK；生命周期只能走显式 RPC op。
- request id 只做响应关联，transaction identity 独立且同时绑定 owning port。
- request id 的去重范围是单个 port；不同 proxy 可合法复用同一个数值，绝不能互相吞请求。
- client-local mutex 不是跨 app context 的正确性边界；全局隔离只能在 Offscreen handler。
- client timeout 后请求仍可能留在 server 队列；handler 必须在触碰 PGlite 前校验 `deadlineAt`，禁止迟到的 BEGIN/写请求执行。
- ready gate 等待期间断开的 port 必须在恢复后拒绝，不能执行迟到的 `transaction-begin`。
