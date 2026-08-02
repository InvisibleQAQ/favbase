# app/components/configuration-blocker

Collection 页面 provider 配置阻塞智能模块。`CollectionConfigurationNotice` 订阅 `useSettings`，复用 ASR/Embedding/LLM resolver，并结合平台 `ProcessingCoverage` 与 Bilibili 权威 `configuration_required` phase 推导阻塞；settings 或 coverage 未就绪时不猜测。

- 一个 outlined warning surface 可同时呈现 ASR、Embedding、Tags 阻塞。
- 每项链接 `/settings?section=<capability>&resume=<platform>`；只传结构化数据给共享 scaffold 的 `configurationNotice` slot。
- ASR 仅由状态机 wait signal 触发；空 key 本身不构成阻塞。Embed/Tags 仅在 ready coverage 且 `total > done` 时触发。
- 本目录拥有 i18n 与 provider 知识；`components/collection/` 继续保持零 `t()`、零 resolver。
