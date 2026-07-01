# app/components/iconify

Iconify 图标系统（与 material-kit-react 同源 `@iconify/react`）。

## 模块结构

- `icon-sets.ts` — 30+ 离线注册图标（solar/eva/mingcute/custom 集），含 favbase 专用图标（含 `solar:siderbar-bold-duotone` 用于侧边栏 toggle）
- `register-icons.ts` — addCollection 离线注册 + `IconifyName` 类型安全
- `iconify.tsx` — styled(Icon) 包装，未注册图标 console.warn 提醒
