# lib/runtime-message

跨 runtime 协议共享的最小 schema primitive。这里不拥有任何具体 message type，也不负责发送、路由或 Database Port RPC。

## 模块结构

- `schemas.ts` — 共享的有限 ID、字幕行、字幕来源、错误参数、转录错误和可选 envelope shape；包含字幕行数、字段长度、总文本预算所需的常量。

## 约定

- 具体协议归属明确：`lib/bilibili/messaging.ts` 负责 `window.postMessage`；`lib/background/message-protocol.ts` 负责 Background 入站/响应/push；`lib/offscreen/protocol.ts` 负责 Offscreen request/response/progress。不要把三个 transport 合并成一个全知 registry。
- 这些 primitive 只作为 schema 组合使用；runtime 输入必须在所属边界 decode，不能把 `schemas.ts` 导出的类型当作运行时验证的替代品。
- `channel` 和 `protocolVersion` 是可选兼容元数据。legacy 消息继续接收；新消息可带 v1 envelope。未知 discriminator、错误字段、非有限数字和超限 payload 由所属协议拒绝。
- Database RPC 使用 `lib/database/bridges/` 的 Port 协议，保持独立。
