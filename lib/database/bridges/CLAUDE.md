# Database Bridges

PGlite 的 RPC 桥：调用端 `PGliteSharedProxy` 经 Chrome Port 把执行请求发给 Offscreen 的 `DatabaseRpcHandler`，后者是 PGlite session 的事务 owner。

## 事务约束

- 禁止从 SQL 文本识别 BEGIN / COMMIT / ROLLBACK，事务生命周期只能走显式 RPC op。
- request id 只做响应关联；transaction identity 独立于它，并且同时绑定 owning port。
- request id 的去重范围是单个 port：不同 proxy 可以合法复用同一个数值，绝不能互相吞请求。
- 调用端的 mutex 只保证同一个 proxy 内串行，不是跨 app context 的正确性边界。全局隔离只能在 Offscreen handler 做。
- 事务进行中：owner 的请求执行，其他 port 的请求排队，identity 不对的请求拒绝。
- commit、rollback、owning port 断开都必须释放 owner；port 断开时先在 server 侧 rollback。
- client 超时后请求仍可能留在 server 队列。handler 必须在触碰 PGlite 之前校验 `deadlineAt`，迟到的 BEGIN 或写请求不得执行。
- 过期或非法 deadline 的 commit / rollback 请求，先 server 侧 rollback 再拒绝。
- ready gate 等待期间断开的 port，恢复后必须拒绝，不能执行迟到的 `transaction-begin`。
- `stop()` 拒绝队列里的请求，并等 owner 的 rollback 完成。

## 坑

- Chrome Port 传不了 `Date`：进出 Port 的数据一律经 `serialization.ts` 的标记序列化。

守卫：`rpc-handler.test.ts`。
