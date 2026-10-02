# app/sections

路由级业务 section 的归属目录。平台页只装配本平台数据、媒体、原生筛选维度、操作和文案；跨平台标题、搜索、状态、标签、卡片、网格、分页与 pipeline 视觉规则归 `components/collection/`。

- `configuration-heading.test.tsx` — GitHub/YouTube 配置门早退的跨平台回归：两页仍必须先渲染共享 `SectionTitleBar`，保持恰好一个 route `h1`，再显示平台配置 `StateBox`；**并断言「打开设置」按钮落到该平台自己的 `/settings/connections/<platform>`**（2026-09-17）——设置页两级导航成为路由前这个按钮只到得了 `/settings`，也就是 AI > LLM，离文案刚让人去填的那张卡还隔一个 tab。

平台 view 链入设置页时用 `settings/settings-nav.ts` 的 `SettingsLeaf`，不要手写 `/settings/...` 字符串：自 docs/32 Step 6 起配置门与凭据被拒两态都是共享 `components/collection-states/` 的 `NeedsConfigState settings="connections/<platform>"`，由它调 `settingsPath(leaf)`，view 不再 import 该表（`settings-nav` 在 `settings/` 之外只被 `components/configuration-blocker/` 与 `components/collection-states/` 引用）。成立的原因不变：该表零值导入、纯数据，换来的是链接目标由 `tsc` 校验。

新跨平台视觉规则不得散落到多个 section；三处以上重复先回到共享 owner。
