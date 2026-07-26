# app/components/library-gate

平台无关的**智能组件**目录（与 `components/collection/` 的哑组件铁律相反）：自带 `useTranslation()` + 闸门 hook 订阅，消费方只传 `platform` 字符串。定位对应 `entrypoints/app/hooks/library-gate.ts`（平台感知门面层）的 UI 半。

## 模块结构

- `use-collection-gate.ts` — `useCollectionGate(platform: string): CollectionGate | null`。把 scaffold 的宽松 `platform: string`（job namespace 或 DB 判别符均可）经 `gatePlatformOf` 解析成闸门键；非收藏平台字符串（测试 fixture 等）返回 `null` = 不渲染闸门 UI、不做禁用。返回 `{ paused, pause, resume, fetchBlockedHint }`——`fetchBlockedHint` 是预翻译的 `pipeline.fetchBlockedByPause`，供 scaffold 传给 `SectionTitleBar.syncDisabledTooltip`（保持 `components/collection/` 零 `t()`）。hook 无条件调用 `useLibraryGate`（未知平台用 `COLLECTION_PLATFORMS[0]` 兜底订阅后丢弃）。
- `library-gate-button.tsx` — `LibraryGateButton { platform }`：⏸「暂停构建知识库」/ ▶「继续构建知识库」文字按钮（`solar:pause-bold` / `solar:play-bold`，离线注册）。paused 态用 `warning` 色 + `data-gate-state="paused"`；运行态 `text.secondary`。点击直调 `pause`/`resume`（写 storage + 联动运行中 run，见 `hooks/library-gate.ts`）。未知平台渲染 `null`。
- `index.ts` — barrel。

## 约定

- 本目录**允许** `t()` / storage-backed hook —— 这是它与 `components/collection/`（零 `t()`、纯 props）的边界理由。共享哑组件需要闸门信息时，从这里以「预翻译字符串 + 布尔」形态取（`useCollectionGate`），不得把 `t()` 引进哑组件目录。
- 消费方：`components/collection/collection-page-scaffold.tsx`（pipeline 行尾按钮 + fetch 按钮禁用）。六个平台 view 零接线——闸门 UI 全在 scaffold 内部。
- 测试：`library-gate-button.test.tsx`（mock `hooks/library-gate` + i18n，断言双态渲染/点击分派/未知平台为空）。
