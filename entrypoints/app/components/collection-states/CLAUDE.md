# app/components/collection-states

`components/collection/` 的翻译半边：凡是「`components/collection/` 的哑组件 + 一层 `t()`」都住这里。目录按这个角色定义，不是按「页面状态」——`FacetChips` 不是状态，但要调 `t()`，所以也在这里。智能模块，自带 `useTranslation()`；消费方只传 `LocaleKeys`、`IconifyName`、站点链接或 `SettingsLeaf`。

## 约束

- 本目录存在的理由是 `components/collection/**` 零 `t()`（用户决定，docs/32 Step 6）：需要翻译的共享件放这里，不要把 `t()` 加回哑组件目录。
- `use-collection-chrome-copy.ts` 只依赖 `useTranslation`，不要给它加别的 import。唯一消费方是 `CollectionPageScaffold`，它直接 import 这个叶文件——经 barrel 会把 react-router、`settings-nav` 与 Iconify 拖进 scaffold 的模块图。
- 本目录 import `../collection/` 的叶文件（`state-box` / `sync-now-button` / `collapsible-chip-row`），不经其 barrel：barrel 带着 scaffold，scaffold 又 import 本目录的 hook 与加载期读 storage 的 library-gate。
- 本目录唯一的 `sections/` 依赖是 `sections/settings/settings-nav`（`settingsPath` / `SettingsLeaf`）：它是零值导入的纯数据表，所以这条反向 import 是允许的（`components/configuration-blocker/` 同样如此）。
- scaffold 不 import 三个状态与 `FacetChips`：它们由 view 构造、经 slot 注入。
- 引导状态的动作区由组件推出，不是 prop：有前导动作（打开站点 / 前往设置）时获取按钮是 soft，获取是唯一动作时是 contained。两者都是 `color="primary"`，文案恒为 `pipeline.fetchNow`。
- 打开站点按钮的 `rel` 刻意是 `noopener`，不是 `noopener noreferrer`。
- 「前往设置」是 `onClick` + `navigate`，不是链接：`sections/configuration-heading.test.tsx` 点它再读 router location。
- 状态组件不认识 auth 的 `reason`：`missing` / `rejected` 两套文案由 view 选键传入。
- `FacetChips` 只做一维带计数的单选 facet。facet 形状不归一，调用方传 `getKey` / `getName`；顺序归调用方的查询，组件不排序。

## 刻意不进来的

形状不同的留在各自 view，不要为了「统一」塞进来：

- bookmarks `EmptyState`：没有按钮——挂载已同步过且没有 http(s) 书签，是另一个状态，不是「从未同步」。
- B站 `NotLoggedIn`（动作是重试，不是打开站点 + 获取）、`EmptyFolderState`、`SelectFolderState`。
- 形状不同的 chip 行自己组合 `CollapsibleChipRow`：github `LanguageChips`（语言色点）、bookmarks `FolderChips`（无计数）、B站 `FolderChips`（加载骨架 + 空态）。
