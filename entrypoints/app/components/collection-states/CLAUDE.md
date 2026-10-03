# app/components/collection-states

`components/collection/` 的**翻译半边**（docs/32 Step 6，2026-10-01）。智能模块：自带 `useTranslation()`，消费方只传 i18n 键（`LocaleKeys`）、图标名（`IconifyName`）、站点链接或设置页叶子（`SettingsLeaf`）——`tsc` 校验三者。同层先例：`components/library-gate/`、`components/tags/`、`components/configuration-blocker/` 都在自己目录里翻译。

## 为什么单独成目录

Step 6 原文要「scaffold 给外壳文案默认值」「共享状态组件只收 i18n 键」，两件都要调 `t()`，而 `components/collection/**` 有「零 `t()`」铁律（spec `platform-onboarding.md` §11、`components/collection/CLAUDE.md`）。**用户 2026-10-01 决定**新建这个兄弟目录承接翻译，`components/collection/` 的文件自身仍然零 `t()`；scaffold 只在它的具名例外名单里多 import 一个叶文件（见下）。

## 模块结构

- `collection-states.tsx` — 三个导出状态 + 私有件：
  - 私有 `GuideState({ icon, title, description, lead?, sync? })`：共享 `StateBox` + 48px `text.secondary` 图标 + `t(title)` / `t(description)`。动作区规则**由组件推出，不是 prop**：`lead` 与 `sync` 都有 → 居中可换行的 `Box`（`gap: 1`）里 `lead` 在前、`SyncNowButton` **outlined** 在后；只有 `sync` → 单个 **contained** 获取按钮（获取即主路径）；只有 `lead` → 单个 `lead`。获取按钮文案恒 `pipeline.fetchNow`。
  - 私有 `OpenSiteButton(site)`：`Button component={Link} target="_blank" rel="noopener"`，contained `color="primary"`，18px 图标——与迁移前 x / zhihu 两份逐属性相同（`rel` 刻意保持 `noopener`，不是 `noopener noreferrer`）。
  - 私有 `GoToSettingsButton({ settings })`：contained `color="primary"`，`onClick` → `navigate(settingsPath(settings))`，文案 `common.goToSettings`。**是点击不是链接**：`sections/configuration-heading.test.tsx` 点它再读 router location。
  - `SiteAction = { href, label: LocaleKeys, icon: IconifyName }`。
  - `EmptyLibraryState({ icon, title, description, syncing, onSync, site? })`：从未同步 / 同步为空。带 `site`（x）→ 打开站点在前、获取 outlined；不带（github / zhihu / youtube）→ 获取 contained。
  - `NotLoggedInState({ icon, title, description, site, syncing, onSync })`：站点会话缺失（x / zhihu），`site` 必填。x 的两种 auth（`missing` / `rejected`）由 **view** 选键传入，组件不认识 `reason`。
  - `NeedsConfigState({ icon, title, description, settings, sync? })`：要在设置页填的凭据缺失（github token、youtube key + 频道，不带 `sync`）或被拒（youtube `YoutubeAuthError`，带 `sync` 以便改完重试）。
- `use-collection-chrome-copy.ts` — `useCollectionChromeCopy()` → `{ syncLabel, syncingLabel, loadFailed, retry, syncFailed(error) }`（`pipeline.fetchNow` / `pipeline.fetching` / `common.loadFailed` / `common.retry` / `common.syncFailed`）。**唯一消费方是 `CollectionPageScaffold`，且它直接 import 本叶文件**——经 barrel 会把 react-router、`settings-nav` 与 Iconify 拖进 scaffold 的模块图。本文件只依赖 `useTranslation`，以后也不要给它加别的 import。
- `facet-chips.tsx` — `FacetChips<T extends { count }>({ icon, title, facets, getKey, getName, totalCount, selected, onSelect })`（docs/32 Step 8）：一维带计数的单选 facet 行，x 的作者（Creator）、zhihu 的收藏夹与 youtube 的播放列表（Source）共用，取代三份逐属性相同的 `author-chips` / `collection-chips` / `playlist-chips`。渲染共享 `CollapsibleChipRow`：20px `Iconify`、`t(title)`、label `${getName(f) || getKey(f)} (${f.count})`（名字为空回退 key）、All chip `${t('common.all')} (${totalCount})`、`common.showMore` / `common.showLess`。facet 形状不归一（docs/32 Step 8 D-e：`AuthorCount` / `ZhihuCollectionCount` / `PlaylistCount` 原样），调用方传 `getKey` / `getName` 两个访问器；顺序由调用方的 facet 查询决定，本组件不排序。不收 `getIcon`：今天没有消费者。
- `index.ts` — barrel：三个组件、`SiteAction`、三个 props 类型、`useCollectionChromeCopy` / `CollectionChromeCopy`、`FacetChips` / `FacetChipsProps`。
- `facet-chips.test.tsx` — 单独成文件（不并进 `collection-states.test.tsx`），沿用同一个 `t` mock 与 Iconify mock：表头译文与 20px 图标、All chip 在首位且是 `common.all (total)`、label 是 `name (count)`、名字为空回退 key、点 facet → `onSelect(key)`、点 All → `onSelect(null)`。去掉 `|| getKey(f)` 时「回退 key」一例红（已证伪）。
- `collection-states.test.tsx` — 三个状态的动作区形状（按钮数、先后、`buttonClasses.contained` / `outlined` 及配套的 `colorPrimary` / `colorInherit`——contained 一律品牌主色、outlined 获取保持中性、站点链接属性、点击）、`NeedsConfigState` 落到 `settingsPath(leaf)`、hook 五个字段与传给 `t()` 的参数名（`t` mock 把参数拼成 `key|name=value`，所以证的是键与参数名，不是插值）、以及真实 zh-CN / en 里 `common.syncFailed` / `lastSynced` / `showMore` 确实带 `{{error}}` / `{{time}}` / `{{n}}`（直接 import 两个纯数据 locale 文件）。翻转变体规则时 4 例红、把 en 的 `{{error}}` 改名时 1 例红（均已证伪）。

## 导入方向

- 本目录 → `../collection/state-box`、`../collection/sync-now-button`、`../collection/collapsible-chip-row`（**叶文件，不经 barrel**：barrel 带着 scaffold，scaffold 又 import 本目录的 hook 和 library-gate 的加载期 storage 读取；三个哑组件用不着这些）、`../iconify`、`../../sections/settings/settings-nav`（零值导入的纯数据表，先例 `configuration-blocker`）。
- `components/collection/` → 本目录：只有 scaffold → `use-collection-chrome-copy.ts`。`FacetChips` 由 view 构造、经 scaffold 的 `primaryCategory` slot 注入，scaffold 不 import 它，所以 `components/collection/CLAUDE.md` 的具名例外名单不变。

## `FacetChips` 不是状态

本目录按**角色**定义——`components/collection/` 的翻译半边，凡是「`components/collection/` 的哑组件 + 一层 `t()`」都住这里——不是按「页面状态」。`FacetChips` 要调 `t()`，所以进不了 `components/collection/**`；为一个组件再开目录是仪式（docs/32 Step 8 D-d）。下一节「刻意不进来的状态」只说三种引导状态的取舍，与 chip 行无关。

形状不同的 chip 行同样留在各自 view，自己组合 `CollapsibleChipRow`：github `LanguageChips`（每个 chip 多一个语言色点 `getIcon`）、bookmarks `FolderChips`（无计数、`undefined` 表示全部）、B站 `FolderChips`（加载骨架 + 空态）。

## 刻意不进来的状态

「各一份」判据只管上面三种状态；下面这些形状不同，留在各自 view：

- bookmarks `EmptyState`：没有按钮——挂载已同步过且一条 http(s) 书签都没有，是另一个状态，不是「从未同步」。
- B站 `NotLoggedIn`：动作是「重试」而不是打开站点 + 获取；夹内页重试的是视频查询，fallback 页重试的是同步。
- B站 `EmptyFolderState`（无图标无按钮）、`SelectFolderState`（`minHeight` 240）。
