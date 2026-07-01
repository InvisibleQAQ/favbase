# Database Bridges

RPC 桥接层。

## 模块结构

- `types.ts` — RPC 协议：RpcRequest/RpcResponse/RpcTransport 接口
- `serialization.ts` — Date ↔ `{ __type:'Date', __value: ISO }` 标记序列化（Chrome Port 安全）
- `proxy-driver.ts` — `PGliteSharedProxy`（implements PGliteLike，请求 ID 关联 + 30s 超时 + 事务互斥锁：`transaction()` 持锁期间 `query()`/`exec()` 排队等待，防止并发查询混入事务上下文。`createTxClient()` 返回绕过锁的内部客户端供事务回调使用）
- `chrome-port-rpc.ts` — `createChromePortTransport()`（`chrome.runtime.connect`，指数退避重连，消息队列）
- `rpc-handler.ts` — `DatabaseRpcHandler`（Offscreen singleton，`chrome.runtime.onConnect` 监听，in-flight 去重，PGlite ready gate 排队机制）
