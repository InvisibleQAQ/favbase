# lib/events

类型化的内存领域事件总线：持久化数据变更 → UI 实时刷新。

## 约束

- 只在单个 JS context 内有效。发射点和订阅者现在都在 app.html；在 SW / Content Script 里 emit 到不了 app.html 的订阅者。需要跨 context 时在总线上加 runtime message 转发层，消费方 API 不变。
- 只承载 DB-backed 事实的变更通知。临时会话态（转录进度、stage）走 `TranscriptionCoordinator` 的推送模型，不进总线。
- 只在成功落库之后 emit；skipped / failed 不发事件。
- listener 抛错只 `console.error`、不外传：UI 订阅者的 bug 不能污染写入路径的结果。别改成向上抛。
- 新增事件三步：`DomainEventMap` 加一行类型，写入点 emit，消费 hook 里 `useEffect(() => onDomainEvent(...), deps)`（返回值就是退订函数）。

## 坑

- 总线是模块级单例：测试里订阅了必须退订，否则跨用例污染。
