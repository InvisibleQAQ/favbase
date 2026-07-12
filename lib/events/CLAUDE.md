# lib/events

类型化内存领域事件总线（零依赖，~50 行）：统一"持久化数据变更 → UI 实时刷新"的通知机制。单 JS context 内有效（当前所有 DB 写入点都在 app.html，够用）。

## 模块结构

- `domain-events.ts` — `DomainEventMap`（事件类型注册表：event name → payload 形状）+ `onDomainEvent(type, cb)`（订阅，返回退订函数）+ `emitDomainEvent(type, payload)`（发射；listener 抛错只 console.error 不外传——UI 订阅者的 bug 绝不能污染写入路径的结果语义）。内部用 `Map<type, Set<listener>>` 存储、payload 类型在存储层擦除（mitt 模式，TS 无法关联泛型 key 与映射 value 的赋值），公共 API 泛型保证 type↔payload 类型安全
- `index.ts` — barrel

## 事件清单

| 事件 | payload | 发射点 | 消费者 |
|------|---------|--------|--------|
| `item-tagged` | `{ platform, platformItemId }` | `lib/tagging/tagging-service.ts` `tagPlatformItem` 成功落库后 | `useItemTags`/`useUsedTags`（`sections/collections/use-item-tags.ts`）+ `TaggedVideoGrid` |

## 约定

- **职责边界**：本总线只管 DB-backed 事实的变更通知。临时会话态（转录进度 %、stage）走 `TranscriptionCoordinator` 推送模型（useSyncExternalStore），不进总线
- 新增一种状态变化的成本：`DomainEventMap` 加一行类型 + 写入点加一行 emit + 消费 hook 加一行 `useEffect(() => onDomainEvent(...), deps)` 订阅（直接 return 退订函数作 cleanup）
- 仅 emit 成功语义（如 tagging 的 'tagged'）；'skipped'/'failed' 不发事件
- 跨 context（content script / 多 tab）暂无需求（popup 是单 app.html tab 跳板）；将来需要时在总线上加 runtime message 转发层，消费方 API 不变
- 测试：`domain-events.test.ts`（订阅/退订/多 listener/抛错隔离）；模块级单例状态，测试内必须退订防跨用例污染
