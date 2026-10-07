# lib/i18n

自研的轻量 i18n（无外部库）。`locales/zh-CN.ts` 是 `LocaleKeys` 的类型源，`en.ts` 以 `Record<LocaleKeys, string>` 锁住键集合。React 侧用 `useTranslation()`，非 React 侧用 `index.ts` 的 `t()`。

## 约束

- 新增或删除 key 必须同时改 `zh-CN.ts` 和 `en.ts`，键集合不一致 `tsc` 会红。
- seam 在 UI 边界：lib 层只传结构化数据（错误码 + params、stage + stageParams、`reason`），不调 `t()`、不拼翻译文本；由 UI 层翻译。
- 语言切换靠 `useTranslation()` 订阅驱动 re-render。组件里只要用到模块级 `t`（`import { t } from '@/lib/i18n'`，供模块级 helper 用）、`formatCompactNumber` 或 `formatDateTime`，就必须在组件内调一次 `useTranslation()`，否则切换语言后不刷新。纯 JSX 组件直接 `const { t } = useTranslation()`。
- 复数：`t(key, { count })` 依次找 `{key}.{category}` → `{key}.other` → base key。要区分单复数的 key 定义 base（即 other 语义）+ `{key}.one`，且 zh 与 en 都要有 `.one`（zh 的 `.one` 与 base 同值）：`LocaleKeys` 从 zh 推导，zh 没有的 key en 也不能有。
- 受支持语言只有一份运行时清单：`detect.ts` 的 `SUPPORTED_LOCALES`（`SupportedLocale` 由它派生）。要枚举语言的代码读它，不另抄一份。
- 供应商与传输层的原始错误信息只作 debug，不进可见文案。UI 只消费结构化 code（`ASR_QUOTA_EXCEEDED` + `resetAt`、`AgentBridgeStatus` 的 state / error code、WebDAV 的 `invalid-settings` / `incompatible-version`），未知错误映射成通用的可恢复提示。
- 新增转录错误码要同时补 `error.<CODE>` 的 zh / en，否则用户看到裸 key（`t()` 回退到 key，别处不会红）。守卫：`index.test.ts` 的 `transcribe error codes`。
- 显示名调整只改文案值，不改 key、路由、数据库 `platform` 或任务 ID；`bookmarks.*`、`x.*` 这类命名空间是稳定的。

## 文案规则

- 一级导航 Analytics 在中英文下都显示 `Analytics`（`nav.dashboard`）。
- 浏览器书签平台名固定「浏览器书签」/ `Browser Bookmarks`，`nav.bookmarks` 与 `bookmarks.title` 必须一致；X 平台名固定「X 书签」/ `X Bookmarks`，两个平台不得合并。普通名词 bookmark / 书签按语境翻译，不机械替换成平台名。
- B 站页面标题用 `collections.sidebarTitle`，主分类标题用 `collections.foldersTitle`，不可混用。
- 收藏页处理条的共享短标签统一放 `pipeline.*`，由 view 翻译后传给零 `t()` 的共享组件（`entrypoints/app/components/collection/CLAUDE.md`）。
- 「从平台拉取收藏」只有一个说法：获取 / Fetch。`backgroundJobs.kind.sync` 与 `pipeline.fetch` 文案必须一致；各平台获取按钮统一用 `pipeline.fetchNow` / `pipeline.fetching`，不加 per-platform 的 `*.sync` / `*.syncing`，不引入第二个「同步」说法。
- 知识库闸门按钮固定 `pipeline.pauseLibrary` / `pipeline.resumeLibrary`；段级暂停控件（`pipeline.control.*`）已下线，不得复活。
- provider 配置阻塞提示统一用 `configurationBlocker.*`；何时显示归 `entrypoints/app/components/configuration-blocker/CLAUDE.md`。
- WebDAV 拒绝远端 Settings 的文案（`settings.sync.err.*`）必须说明本地设置未被覆盖，或需要升级。
- Agent Bridge（`settings.agentBridge.*`）：可见文案里配对密钥固定叫「配对 Token」/ pairing token（代码与域术语仍是 Bridge Token），不写成 API key；不出现 Bridge / daemon 这类实现词，用户要照敲的字面命令（如 `favbase doctor`）除外。
- Agent Bridge 轮询文案必须同时写 Chrome 120+ 约 30 秒与 116–119 约 60 秒，不得笼统承诺 30 秒。bad-token 文案只给 setup 这一步修复动作：`favbase setup` 自己会替换持旧 token 的 daemon，不要再加 `daemon restart`。

## 坑

- `index.ts` 加载即读写 `chrome.storage`（`localeStorage.getValue()` + `watch`）。没 mock storage 的测试不要 value-import `@/lib/i18n`；只需要语言清单时 import 无副作用的叶模块 `detect.ts`。
- 缺失的 key 只在 DEV 下 `console.warn`，生产直接显示裸 key。
- 硬编码守卫 `tests/i18n-no-hardcoded.test.ts` 只扫 `entrypoints/**/*.tsx` 里的 CJK（剥注释后），行内 `// i18n-ignore` 豁免单行。英文硬编码文案没有守卫，项目也没有 linter，只能靠 review。

## 验证

- 改 locale 后跑 `pnpm vitest run lib/i18n/index.test.ts` 与 `pnpm compile`（`pnpm test -- <path>` 不行：参数会落到脚本末尾的 `pnpm -r test` 上，根目录仍跑全量）。
