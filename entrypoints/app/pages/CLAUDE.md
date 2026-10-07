# app/pages

路由的 lazy 页面组件：每个文件只 re-export 一个 `sections/` view，不放逻辑。

- 平台页必须直接从 `../sections/...` import 它的 view，且调用 `useCollectionBreadcrumbs` 的就是那个 view 文件：`tests/platform-completeness-contract.test.ts` 顺着 `COLLECTION_PAGE_LOADERS` → page 的第一个 `../sections/` import 去找它，中间加一层包装文件就会红。
- 平台页的注册在 app 根的 `collection-platform-pages.ts`，不在 `main.tsx`。
