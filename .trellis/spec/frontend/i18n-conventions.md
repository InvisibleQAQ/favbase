# i18n Conventions

## Scope & Trigger

This spec governs **all user-facing text** in the favbase extension. It applies whenever you:

- Add a new error code to `TranscribeErrorCode`
- Add a new pipeline stage to `TranscribeStage`
- Add any user-visible string to a React component
- Touch `lib/i18n/`, `lib/transcription/types.ts`, or any component that calls `t()`

---

## Architecture: The i18n Seam

The seam between structured data and translated text lives at the **UI boundary**.

```
lib layer (background, offscreen, groq-client, audio-*)
  Emits: { code: TranscribeErrorCode, message: string, params?: ... }
  NEVER imports t() or any i18n module

         --- seam ---

UI layer (React components in entrypoints/**/components/)
  Consumes: t(`error.${code}`, params)  /  t(`stage.${stage}`, stageParams)
  ONLY place t() is called
```

---

## Signatures

### `t()` function

```typescript
// lib/i18n/index.ts
export function t(
  key: LocaleKeys,
  params?: Record<string, string | number>,
): string;
```

- Interpolates `{{name}}` placeholders in the locale string
- **Fallback**: if `key` is not found, returns the key string itself (no crash)
- `LocaleKeys` is derived from `keyof typeof zhCN` (zh-CN.ts is the source of truth)
- **Plural resolution**: when `params.count !== undefined`, `t()` resolves a variant key via `Intl.PluralRules(currentLocale).select(Number(count))` → looks up `` `${key}.${category}` `` (e.g. `foo.one` / `foo.other`), falling back to `` `${key}.other` ``, then the base `key`. Calls without `count` are unaffected (fully backward compatible). See "Plural keys" contract below.

### `formatCompactNumber()` function

```typescript
// lib/i18n/index.ts
export function formatCompactNumber(n: number): string;
```

- Locale-aware compact number formatting via `Intl.NumberFormat(currentLocale, { notation: 'compact', maximumFractionDigits: 1 })`
- zh-CN → `1.2万` / `1.2亿`; en → `1.2K` / `1.2M` (Intl handles the CJK 万/亿 units natively — do NOT hand-roll `万` concatenation)
- Reads live `currentLocale`; consumers rendering the result MUST subscribe via `useTranslation()` to re-render on locale switch

### `TranscribeErrorInfo` contract

```typescript
// lib/transcription/types.ts
export interface TranscribeErrorInfo {
  code: TranscribeErrorCode;                    // enum, always present
  message: string;                              // English, debug-only, NEVER rendered
  params?: Record<string, string | number>;     // dynamic values for t() interpolation
  retryAfter?: number;                          // seconds (rate limit only)
  resetAt?: number;                             // epoch ms when provider supplies a reset delay
  rateLimitKind?: 'audio_seconds_per_day';      // app-owned closed classification
  providerId?: ASRProviderId;                   // provider that produced the response
}
```

### `TranscribeStatusPush` contract

```typescript
// lib/transcription/types.ts
export interface TranscribeStatusPush {
  type: 'TRANSCRIBE_STATUS';
  bvid: string;
  progress: number;
  stage: TranscribeStage;
  stageParams?: Record<string, string | number>;  // e.g. { current: 2, total: 5 }
  error?: TranscribeErrorInfo;
}
```

---

## Contracts

### 1. Locale file structure

- **Source of truth**: `lib/i18n/locales/zh-CN.ts` defines the `LocaleKeys` type via `keyof typeof zhCN`
- **Mirror**: `lib/i18n/locales/en.ts` typed as `Record<LocaleKeys, string>` -- TypeScript enforces key parity
- Adding a key to zh-CN.ts without en.ts (or vice versa) is a **compile error**

### 2. Key naming conventions

| Category | Pattern | Example |
|----------|---------|---------|
| Error messages | `error.{TranscribeErrorCode}` | `error.ASR_RATE_LIMIT` |
| Pipeline stages | `stage.{TranscribeStage}` | `stage.downloading` |
| UI status | `status.*` | `status.loading` |
| Transcribe UI | `transcribe.*` | `transcribe.button` |
| Settings UI | `settings.*` | `settings.apiKey` |
| Panel chrome | `panel.*` / `sidebar.*` | `panel.expand` |
| Subtitle actions | `subtitle.*` | `subtitle.jumpTo` |
| Collection pipeline strip | `pipeline.*` | `pipeline.fetch` |
| Global background-job reminder | `backgroundJobs.*` | `backgroundJobs.kind.sync` |
| app.html sidebar / Header chrome | `nav.*` / `header.*` | `nav.groupCollections`, `header.settingsAria` |
| Breadcrumb ancestry (shared by every route with a trail) | `breadcrumbs.*` | `breadcrumbs.home` |
| Appearance drawer (theme settings) | `settingsDrawer.*` | `settingsDrawer.presets` |
| Toast region chrome and generic one-shot results | `snackbar.*` | `snackbar.saved`, `snackbar.regionLabel` |

**Specific copy wins over generic copy**: a toast for an outcome that already has
a precise key (`settings.sync.err.*`, `export.dbNotReady`,
`settings.agentBridge.copyFailed`) reuses that key. `snackbar.*` holds only the
strings nothing else owns — the region/close chrome and the generic
`saved`/`saveFailed`-style fallbacks. Minting a second synonym for an existing
message is how two copies of one sentence start drifting apart.

**One operation, one word**: `backgroundJobs.kind.sync` (header reminder tooltip) and `pipeline.fetch` (per-page processing strip) name the SAME operation — pulling favorites from a platform. Their copy must stay identical (`获取` / `Fetch`). Do not reintroduce a second wording (`同步` / `Sync`) for it.

### 3. Parameterized error codes

Only 2 error codes carry `params`:

| Code | `params` shape | Locale usage |
|------|---------------|--------------|
| `DOWNLOAD_FAILED` | `{ status: number }` | `'Audio download failed (HTTP {{status}})'` |
| `ASR_UNKNOWN` | `{ detail: string }` | `'Unknown error: {{detail}}'` |

All other error codes have no params -- the locale string is self-contained.

Rate-limit metadata (`retryAfter/resetAt/rateLimitKind/providerId`) is structured control data, not translation `params`. Components may format `resetAt` with `formatDateTime()` and select a stable locale key; they must never render or branch on `message`.

### 4. Parameterized stages

Only 1 stage carries `stageParams`:

| Stage | `stageParams` shape | Locale usage |
|-------|-------------------|--------------|
| `chunk_transcribing` | `{ current: number, total: number }` | `'Chunk {{current}}/{{total}}'` |

### 5. Locale detection

```typescript
// lib/i18n/detect.ts — browser detection (pure function)
export function detectLocale(): SupportedLocale {
  const lang = navigator.language;
  return lang.startsWith('zh') ? 'zh-CN' : 'en';
}

// lib/storage/ui-state.ts — persistent preference
export type LocalePreference = 'auto' | 'zh-CN' | 'en';
export const localeStorage = storage.defineItem<LocalePreference>('local:locale', { fallback: 'auto' });

// lib/i18n/index.ts — observable state
export function setLocale(pref: LocalePreference): void;  // persist + notify
export function resolveLocale(pref: LocalePreference): SupportedLocale;
export function subscribeLocale(cb: () => void): () => void;  // useSyncExternalStore contract
export function getLocaleSnapshot(): LocalePreference;

// lib/i18n/use-translation.ts — React hook
export function useTranslation(): { t, locale, preference, setLocale };
```

`t()` reads from mutable `currentMessages` — always reflects current locale. DEV mode logs `console.warn` for missing keys. `storage.watch()` syncs across Content Script and app.html contexts.

**React consumer patterns:**
- Components with only JSX usage: `const { t } = useTranslation()`
- Components with module-level helpers using `t()`: keep `import { t } from '@/lib/i18n'` + call `useTranslation()` in component body for subscription

### Convention: `document.documentElement.lang` sync (extension pages only)

**What**: Extension pages (welcome.html; app.html if needed later) may keep `<html lang>` in sync with the resolved locale via a page-local effect:

```tsx
// entrypoints/welcome/welcome-view.tsx — page entry component
const { locale } = useTranslation();
useEffect(() => {
  document.documentElement.lang = locale; // 'zh-CN' | 'en'
}, [locale]);
```

**Why**: Static `lang="zh-CN"` in the entry HTML is wrong for English users (screen readers apply Chinese pronunciation rules). But the sync MUST stay in the page entry component — **never in `lib/i18n`**: Content Scripts share `lib/i18n`, and in a CS the `document` is the **host page** (e.g. bilibili). A global sync would silently rewrite the host site's `lang`.

**Related**: see Forbidden Patterns below.

### 6. Plural keys

For a key needing singular/plural distinction, define BOTH a base key (the plural/`other` form) AND a `${key}.one` variant, in **both** locale files:

```typescript
// zh-CN.ts — Chinese has no plural, so .one == base
'collections.videoCount': '{{count}} 个视频',
'collections.videoCount.one': '{{count}} 个视频',
// en.ts — .one is the singular form
'collections.videoCount': '{{count}} videos',
'collections.videoCount.one': '{{count}} video',
```

Call site passes `count`; `t()` picks the variant:

```typescript
t('collections.videoCount', { count })  // en: 1→"1 video", 5→"5 videos"; zh→"N 个视频"
```

- The `.one` variant MUST exist in both locales (parity), even though zh duplicates the base — this keeps `Record<LocaleKeys, string>` type-safe.
- `Intl.PluralRules` for zh-CN always yields `other`; for en yields `one`/`other`. The system has no dedicated `few`/`many` handling (not needed for zh/en).
- Current plural keys: `collections.videoCount`, `autoTranscribe.pendingCount`.

### 7. No-hardcoded-CJK guard (regression test)

`tests/i18n-no-hardcoded.test.ts` (vitest) scans `entrypoints/**/*.tsx`, strips comments, and fails if any CJK char (`/[一-鿿]/`) remains — enforcing that all user-facing Chinese goes through `t()`.

- Escape hatch: `// i18n-ignore` on a line exempts it (use sparingly).
- Scans every `entrypoints/**/*.tsx` file. There is no page-level exemption.
- Scope limitation: catches CJK only, not hardcoded English display copy (high false-positive cost); English relies on review.
- Run via `pnpm test`.

---

## What Is NOT Translated

These strings are **intentionally excluded** from i18n:

- `GROQ_TRANSCRIPTION_PROMPT` in `constants.ts` -- Whisper system prompt, affects transcription behavior
- Filler words / interaction keywords in `subtitle-processor.ts` -- Chinese domain data for subtitle filtering
- `'中文'` string matching in `effects.ts` -- DOM functional logic, not user-visible text
- `console.warn` / `console.error` messages -- always English, for DevTools debugging only

---

## Validation & Error Matrix

### Adding a new `TranscribeErrorCode`

1. Add the code to the union type in `lib/transcription/types.ts`
2. Add `error.{CODE}` key to `lib/i18n/locales/zh-CN.ts`
3. Add `error.{CODE}` key to `lib/i18n/locales/en.ts` (TypeScript enforces this)
4. Construct `TranscribeErrorInfo` with `message` (English debug string) in the lib layer
5. UI component calls `t(`error.${error.code}`, error.params)` -- no other translation path

For quota-aware automatic transcription, the UI may instead use the stable `ASR_QUOTA_EXCEEDED` code plus `resetAt` to render `autoTranscribe.quotaPausedUntil` / `autoTranscribe.quotaPausedNoReset`. Provider debug prose remains invisible.

### Adding a new `TranscribeStage`

1. Add the stage to the union type in `lib/transcription/types.ts`
2. Add `stage.{STAGE}` key to both locale files
3. Background sends the stage enum via `TranscribeStatusPush`
4. UI component calls `t(`stage.${stage}`, stageParams)` -- no other translation path

---

## Good / Base / Bad Cases

### CORRECT: UI translates via error code

```typescript
// TranscribeButton.tsx -- UI component
function translateError(
  code: TranscribeErrorCode,
  params?: Record<string, string | number>,
): string {
  const key = `error.${code}` as LocaleKeys;
  return t(key, params);
}

// In JSX:
{translateError(error.code, error.params)}
```

### CORRECT: Background constructs error with debug message

```typescript
// background.ts -- lib layer
return {
  code: 'ASR_INVALID_KEY',
  message: 'Groq API key not configured',  // English, debug-only
};
```

### CORRECT: Background sends stage params for chunk progress

```typescript
// background.ts -- lib layer
pushStatus(tab, bvid, progress, 'chunk_transcribing', undefined, {
  current: chunkIndex + 1,
  total: totalChunks,
});
```

### WRONG: Rendering error.message in UI

```typescript
// BAD -- error.message is debug-only English, never show to user
<div className="error">{error.message}</div>
```

```typescript
// CORRECT -- translate via error code
<div className="error">{translateError(error.code, error.params)}</div>
```

### WRONG: Importing t() in lib layer

```typescript
// BAD -- lib/transcription/groq-client.ts
import { t } from '@/lib/i18n';
throw new AsrError({
  code: 'ASR_RATE_LIMIT',
  message: t('error.ASR_RATE_LIMIT'),  // NEVER do this
});
```

```typescript
// CORRECT -- lib layer emits structured data, UI translates
throw new AsrError({
  code: 'ASR_RATE_LIMIT',
  message: 'Groq rate limit exceeded',  // English debug string
});
```

### WRONG: Hardcoding user-facing strings in background

```typescript
// BAD -- background.ts
pushStatus(tab, bvid, 50, 'downloading');
// Also sending a translated string alongside:
tabs.sendMessage(tab, { statusText: '下载音频中...' });  // NEVER
```

```typescript
// CORRECT -- send stage enum only, UI translates
pushStatus(tab, bvid, 50, 'downloading');
// UI: t('stage.downloading') => '下载音频' / 'Downloading audio'
```

### WRONG: Adding error code without locale keys

```typescript
// BAD -- added to TranscribeErrorCode but forgot locale files
export type TranscribeErrorCode = ... | 'ASR_QUOTA_EXCEEDED';
// zh-CN.ts and en.ts have no 'error.ASR_QUOTA_EXCEEDED' key
// Result: UI renders literal string "error.ASR_QUOTA_EXCEEDED" (fallback)
```

```typescript
// CORRECT -- add to all three files atomically
// 1. lib/transcription/types.ts
export type TranscribeErrorCode = ... | 'ASR_QUOTA_EXCEEDED';
// 2. lib/i18n/locales/zh-CN.ts
'error.ASR_QUOTA_EXCEEDED': 'Groq 配额已用完',
// 3. lib/i18n/locales/en.ts  (TypeScript error if missing)
'error.ASR_QUOTA_EXCEEDED': 'Groq quota exceeded',
```

---

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| Render `error.message` in UI | It is English debug text, not user-facing |
| Import `t()` in any `lib/` file | Breaks the i18n seam; lib emits data, UI translates |
| Hardcode user-facing strings in `background.ts` or `lib/` | All user text must go through locale files |
| Add `TranscribeErrorCode` without locale keys in **both** files | Causes raw key string to render (fallback) |
| Add `TranscribeStage` without locale keys in **both** files | Same as above |
| Use `error.message` for conditional logic in UI | Use `error.code` for branching, it is a stable enum |
| Set `document.documentElement.lang` (or any `document` mutation) inside `lib/i18n` | Content Scripts share that code — the CS `document` is the host page (bilibili), and the mutation would rewrite the host site's `lang`. Sync lang only in extension-page entry components (see Convention above) |

---

## Tests Required

When modifying i18n:

1. **Type check** (`pnpm compile` / `tsc --noEmit`): en.ts will fail to compile if it is missing a key defined in zh-CN.ts
2. **Unit tests** (`pnpm test`): `lib/i18n/index.test.ts` covers plural resolution (en `one`/`other`, zh always base, `.one`-missing fallback), `{{name}}` interpolation, and `formatCompactNumber` (zh 万/亿, en K/M)
3. **CJK guard** (`pnpm test`): `tests/i18n-no-hardcoded.test.ts` must stay green — no hardcoded Chinese in `entrypoints/**/*.tsx`
4. **Manual verification**: new locale keys render correctly in both Chinese and English browser locales, and switch live on locale change
5. **Grep audit**: after adding a new error code, `grep -r "error.NEW_CODE" lib/i18n/locales/` should match exactly 2 files

---

## File Reference

| File | Role |
|------|------|
| `lib/i18n/index.ts` | `t()` (+ plural), `formatCompactNumber()`, observable locale state, `setLocale()`, `subscribeLocale()`/`getLocaleSnapshot()`, `getResolvedLocale()` |
| `lib/i18n/index.test.ts` | Unit tests: plural resolution, interpolation, `formatCompactNumber` |
| `tests/i18n-no-hardcoded.test.ts` | CJK guard over `entrypoints/**/*.tsx` |
| `lib/i18n/detect.ts` | `detectLocale()` based on `navigator.language` |
| `lib/i18n/use-translation.ts` | `useTranslation()` React hook (`useSyncExternalStore` wrapper) |
| `lib/i18n/locales/zh-CN.ts` | Chinese locale, **source of truth** for `LocaleKeys` type |
| `lib/i18n/locales/en.ts` | English locale, typed as `Record<LocaleKeys, string>` |
| `lib/storage/ui-state.ts` | `localeStorage` — `LocalePreference` persistent storage item |
| `lib/transcription/types.ts` | `TranscribeErrorCode`, `TranscribeErrorInfo`, `TranscribeStage`, `TranscribeStatusPush` |
| `entrypoints/**/components/TranscribeButton.tsx` | Reference implementation of `translateError()` and `translateStage()` |
