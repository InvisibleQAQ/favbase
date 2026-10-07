# lib/runtime-message

跨 runtime 协议共用的最小 schema primitive。不拥有任何具体 message type，不负责发送与路由，也不管 Database Port RPC。

## 约束

- 具体协议各有 owner，不要合并成一个全知 registry：`lib/bilibili/messaging.ts`（`window.postMessage`）、`lib/background/message-protocol.ts`（Background 入站 / 响应 / push）、`lib/offscreen/protocol.ts`（Offscreen request / response / progress）；Database RPC 归 `lib/database/bridges/`。
- 这里的导出只用来组合 schema。runtime 输入必须在所属边界 decode，导出的 TS 类型不能替代运行时校验。
- `channel` / `protocolVersion` 是可选兼容元数据：legacy 消息继续接收，新消息可带 v1 envelope。
- `transcribeErrorSchema` 的 code enum 必须与 `TranscribeErrorCode` 是同一集合；`lib/i18n/index.test.ts` 的类型断言会让 `tsc` 红。
