# app/theme

MUI v7 主题系统（palette/typography/shadows/custom-shadows/components），配色和排版完全对齐 material-kit-react。

## 模块结构

- `theme-config.ts` — 调色板常量 + 字体配置（classesPrefix: 'favbase'）
- `create-theme.ts` — 主题工厂，合并 colorSchemes.light + components + typography + shape
- `theme-provider.tsx` — ThemeVarsProvider + CssBaseline 包装
- `extend-theme-types.d.ts` — MUI 类型扩展（customShadows, fontSecondaryFamily, palette 扩展）
- `core/palette.ts` — 完整色彩系统，使用 `minimal-shared` 的 `createPaletteChannel` + `varAlpha`
- `core/typography.ts` — 排版比例，h1-h6 响应式 + body/caption/overline/button
- `core/shadows.ts` — 25 级 MUI 标准阴影
- `core/custom-shadows.ts` — card/dialog/dropdown + z1-z24 + 各色彩阴影
- `core/components.tsx` — MUI 组件样式覆盖（Card 圆角 16px，Button 无 elevation，Paper 无 backgroundImage 等）
