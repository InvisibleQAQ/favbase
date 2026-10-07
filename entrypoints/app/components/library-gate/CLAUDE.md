# app/components/library-gate

知识库闸门（暂停 / 继续构建知识库）的 UI 半边；状态与 storage 在 `entrypoints/app/hooks/library-gate.ts`。智能组件目录：允许 `t()` 与 storage-backed hook。

## 约束

- 哑组件目录（`components/collection/`）需要闸门信息时，只从 `useCollectionGate` 取「预翻译字符串 + 布尔」，不得把 `t()` 带进去。
- 唯一消费方是 `components/collection/collection-page-scaffold.tsx`；平台 view 不接线闸门。
- `useCollectionGate(platform)` 接受 job namespace 或平台判别符；解析不出收藏平台时返回 `null` = 不渲染闸门 UI、不禁用获取按钮。
- hook 对未知平台仍无条件调用 `useLibraryGate`（用 `COLLECTION_PLATFORMS[0]` 兜底订阅后丢弃结果）：为了守 hooks 规则，不是 bug。
