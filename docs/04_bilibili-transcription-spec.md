# B站视频转录功能 — 实现规格文档

**版本**: v1.0
**日期**: 2026-06-14
**状态**: 待实现
**前置**: 本功能独立于 PRD 中的知识库 Ingestion Pipeline，定位为 Bilitato 风格的视频页面即时 AI 助手。后续可将字幕/总结数据对接知识库存储。

---

## 1. 功能范围

在 B站视频页面注入浮窗 UI，提供：

1. **字幕获取** — 通过 `/x/player/v2` API 获取 B站 AI 字幕
2. **语音转录** — 无 AI 字幕时，通过 Groq Whisper API 转录音频
3. **字幕预处理** — 标准化、噪声过滤、去重
4. **LLM 总结** — 支持 Quality（双请求并行）和 Efficiency（单请求合并）两种模式
5. **结果展示** — Shadow DOM 浮窗显示字幕、总结、视频分段
6. **本地缓存** — 按 BV 号缓存结果，避免重复请求

不包含：知识库存储、搜索、WebDAV 同步、收藏夹批量导入。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────┐
│                   B站视频页面                         │
│                                                     │
│  ┌──────────────┐    ┌────────────────────────────┐ │
│  │ Content Script│    │ Shadow DOM UI (React)      │ │
│  │              │───▶│ - 字幕面板                   │ │
│  │ 视频检测      │    │ - 总结面板                   │ │
│  │ BV号提取      │    │ - 设置面板                   │ │
│  │ URL变化监听   │    │ - 状态/进度                  │ │
│  └──────┬───────┘    └────────────────────────────┘ │
│         │ browser.runtime.sendMessage                │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│              Background Service Worker               │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ B站 API      │  │ Groq ASR     │  │ LLM       │ │
│  │ 字幕获取      │  │ 音频转录      │  │ 总结/分段  │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Storage      │  │ Cache        │                 │
│  │ API Keys     │  │ 字幕/总结缓存 │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

**技术栈映射**:

| Bilitato | favbase | 差异说明 |
|----------|---------|---------|
| Vanilla JS | TypeScript | 类型安全，可维护性 |
| 手动 Shadow DOM | WXT `createShadowRootUi` | 框架管理生命周期、CSS隔离、HMR |
| 手动 manifest.json | WXT 自动生成 | 声明式入口点配置 |
| chrome.storage | WXT `storage.defineItem` | 类型化、响应式存储 |
| 多文件 content scripts | 单入口 + 模块化 import | Vite 打包，tree-shaking |

---

## 3. 目录结构

```
entrypoints/
├── background.ts                    # Background Service Worker 入口
├── bilibili-video.content/          # B站视频页 Content Script（WXT目录式入口）
│   ├── index.ts                     # defineContentScript 主入口
│   ├── App.tsx                      # React 根组件
│   ├── style.css                    # Shadow DOM 内样式
│   ├── components/
│   │   ├── Panel.tsx                # 主面板容器（折叠/展开）
│   │   ├── SubtitleView.tsx         # 字幕展示（带时间戳跳转）
│   │   ├── SummaryView.tsx          # 总结展示
│   │   ├── SegmentsView.tsx         # 分段展示（章节导航）
│   │   ├── SettingsView.tsx         # 设置（API Keys、模式选择）
│   │   ├── StatusBar.tsx            # 状态/进度条
│   │   └── TranscribeButton.tsx     # 转录触发按钮
│   └── hooks/
│       ├── useVideoDetect.ts        # BV号检测 + URL变化监听
│       ├── useSubtitle.ts           # 字幕获取状态管理
│       └── useSummary.ts            # 总结状态管理
├── popup/                           # Popup（保留，后续扩展）
│   ├── App.tsx
│   ├── index.html
│   └── main.tsx

lib/
├── messages.ts                      # 消息类型定义（discriminated union）
├── messaging.ts                     # 类型安全的 sendMessage 封装
├── storage.ts                       # WXT storage items 定义
├── types.ts                         # 共享类型（字幕、总结、设置）
├── bilibili/
│   ├── subtitle-fetcher.ts          # B站字幕 API 封装
│   └── video-info.ts                # BV号解析、CID获取
├── transcription/
│   ├── groq-client.ts               # Groq Whisper API 客户端
│   ├── audio-extractor.ts           # 音频URL提取 + 下载
│   └── chunking.ts                  # 大文件分块策略
├── subtitle/
│   └── preprocessor.ts              # 字幕清洗管线
├── llm/
│   ├── provider-adapter.ts          # 多 Provider LLM 客户端
│   ├── prompt-builder.ts            # Prompt 模板
│   └── summary-orchestrator.ts      # Quality/Efficiency 模式调度
└── utils/
    └── retry.ts                     # 重试/退避工具
```

**WXT 入口点说明**: `bilibili-video.content/` 是 WXT 的目录式 content script 入口。WXT 会自动识别 `entrypoints/` 下以 `.content.ts` 结尾或 `.content/index.ts` 结构的文件作为 content script 入口。

---

## 4. 消息桥 (Message Bridge)

使用 TypeScript discriminated union + `browser.runtime.sendMessage` 实现类型安全的消息传递。

### 4.1 消息类型定义

```typescript
// lib/messages.ts

// --- 请求消息 ---

interface FetchSubtitleRequest {
  type: 'FETCH_SUBTITLE';
  bvid: string;
}

interface TranscribeAudioRequest {
  type: 'TRANSCRIBE_AUDIO';
  bvid: string;
  cid: number;
  title: string;
}

interface RunSummaryRequest {
  type: 'RUN_SUMMARY';
  bvid: string;
  subtitle: SubtitleRow[];
  mode: 'quality' | 'efficiency';
  tasks: ('summary' | 'segments')[];
}

interface GetCacheRequest {
  type: 'GET_CACHE';
  bvid: string;
}

interface SaveSettingsRequest {
  type: 'SAVE_SETTINGS';
  settings: Partial<UserSettings>;
}

interface GetSettingsRequest {
  type: 'GET_SETTINGS';
}

type MessageRequest =
  | FetchSubtitleRequest
  | TranscribeAudioRequest
  | RunSummaryRequest
  | GetCacheRequest
  | SaveSettingsRequest
  | GetSettingsRequest;

// --- 响应格式 ---

interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}
```

### 4.2 Background 消息处理

```typescript
// entrypoints/background.ts
browser.runtime.onMessage.addListener(
  (message: MessageRequest, sender): Promise<MessageResponse> => {
    switch (message.type) {
      case 'FETCH_SUBTITLE':
        return handleFetchSubtitle(message);
      case 'TRANSCRIBE_AUDIO':
        return handleTranscribeAudio(message);
      case 'RUN_SUMMARY':
        return handleRunSummary(message);
      // ...
    }
  }
);
```

### 4.3 Content Script 发送

```typescript
// lib/messaging.ts
export async function sendMessage<T>(request: MessageRequest): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as MessageResponse<T>;
  if (!response.success) {
    throw new Error(response.error?.message ?? 'Unknown error');
  }
  return response.data as T;
}
```

---

## 5. B站字幕获取

### 5.1 视频信息提取

从页面 URL 提取 BV 号，通过 API 获取 CID：

```typescript
// lib/bilibili/video-info.ts

// URL 格式: https://www.bilibili.com/video/BVxxxxxx
// 或: https://www.bilibili.com/video/BVxxxxxx?p=2
export function extractBvid(url: string): string | null {
  const match = url.match(/\/video\/(BV[\w]+)/);
  return match?.[1] ?? null;
}

// 获取 CID（视频分P的唯一标识）
// 方式1: 通过 /x/player/v2 返回中直接获取
// 方式2: 通过 /x/web-interface/view?bvid={bvid} 获取 pages 列表
// Bilitato 使用方式1（/x/player/v2 本身需要 cid 参数，但不传也能返回默认分P）
// 实际上 Bilitato 的 content.js 从页面 window.__INITIAL_STATE__ 或 URL 中获取 cid
```

**CID 获取策略**:

1. **优先**: 从页面 `window.__INITIAL_STATE__.videoData.cid` 提取（需要 main world 脚本或 inject script）
2. **备选**: 调用 `/x/web-interface/view?bvid={bvid}` API，从 `data.pages[0].cid` 获取
3. **分P**: URL 含 `?p=N` 时取 `data.pages[N-1].cid`

**推荐实现**: 使用备选方案（API 调用），不需要注入 main world 脚本，更简洁。

### 5.2 字幕获取 API

```typescript
// lib/bilibili/subtitle-fetcher.ts

// 在 Background 中执行（需要 Cookie）
export async function fetchBilibiliSubtitle(bvid: string, cid: number): Promise<SubtitleResult> {
  // Step 1: 调用 player/v2 获取字幕轨列表
  const playerUrl = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
  const playerRes = await fetch(playerUrl, { credentials: 'include' });
  const playerData = await playerRes.json();
  
  const subtitles = playerData?.data?.subtitle?.subtitles; // SubtitleTrack[]
  // subtitles 结构: [{ lan: "ai-zh", lan_doc: "中文（自动生成）", subtitle_url: "//ai..." }, ...]
  
  if (!subtitles?.length) {
    return { status: 'no_subtitle', rows: [] };
  }
  
  // Step 2: 选择中文字幕轨
  const zhTrack = subtitles.find(
    (s: { lan_doc: string }) => s.lan_doc.includes('中文')
  ) ?? subtitles[0];
  
  // Step 3: 获取字幕 JSON
  // subtitle_url 格式: //aisubtitle.hdslb.com/bfs/ai_subtitle/xxx.json
  // 需要补 https: 前缀
  const subtitleUrl = zhTrack.subtitle_url.startsWith('//')
    ? `https:${zhTrack.subtitle_url}`
    : zhTrack.subtitle_url;
  
  const subtitleRes = await fetch(subtitleUrl);
  const subtitleData = await subtitleRes.json();
  
  // Step 4: 提取字幕行
  // 格式: { body: [{ from: 0.0, to: 2.5, content: "..." }, ...] }
  const rows: SubtitleRow[] = subtitleData.body.map(
    (item: { from: number; to: number; content: string }) => ({
      start: item.from,
      end: item.to,
      text: item.content,
    })
  );
  
  return { status: 'ok', rows, source: 'bilibili' };
}
```

**关键类型**:

```typescript
// lib/types.ts
interface SubtitleRow {
  start: number;  // 秒
  end: number;
  text: string;
}

interface SubtitleResult {
  status: 'ok' | 'no_subtitle' | 'error';
  rows: SubtitleRow[];
  source?: 'bilibili' | 'groq';
  error?: string;
}
```

### 5.3 Cookie 与权限

`wxt.config.ts` 需要声明权限：

```typescript
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage', 'cookies'],
    host_permissions: [
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',        // 字幕 CDN
      'https://api.groq.com/*',       // Groq API
    ],
  },
});
```

Background 中 `fetch` 带 `credentials: 'include'` 会自动携带 B站 Cookie。

---

## 6. 字幕预处理

参考 Bilitato `subtitleProcessor.js`，在 Background 或 Content Script 中对原始字幕做清洗。

```typescript
// lib/subtitle/preprocessor.ts

export function preprocessSubtitle(rows: SubtitleRow[]): SubtitleRow[] {
  return pipe(rows, [
    normalizeText,        // 全角→半角，去无意义括号内容 [笑声] (鼓掌)
    filterNoise,          // 移除含"点赞/投币/关注/一键三连"等的句子
    filterFillerWords,    // 去纯语气词句（嗯/啊/那个），剥离长句开头填充词
    preserveFactual,      // 含数字/年份/百分比的句子强制保留
    deduplicateAdjacent,  // Jaccard > 0.85 的相邻句合并，保留较长文本
  ]);
}
```

### 6.1 各步骤细节

**normalizeText**:
- 全角字母/数字转半角: `Ａ→A`, `０→0`
- 全角标点选择性保留（中文标点保留，全角英文标点转半角）
- 去除 `[笑声]`、`(鼓掌)`、`【音乐】` 等标注
- 正则: `/[\[【（(][^)\]】）]*[)\]】）]/g`

**filterNoise**:
- 关键词列表: `['点赞', '投币', '关注', '一键三连', '收藏', '转发', '弹幕', '充电']`
- 整句包含任意关键词则移除

**filterFillerWords**:
- 纯语气词句: 正则 `/^[嗯啊呃那个就是这个然后所以其实]+$/` 匹配则移除
- 句首填充词: 正则 `/^(嗯|啊|那个|就是|所以说|其实吧)[，,\s]/` 剥离前缀

**preserveFactual**:
- 含 `/\d+/` 的句子标记为 `protected`，跳过 filterNoise 和 filterFillerWords

**deduplicateAdjacent**:
- 相邻两句 Jaccard 相似度 > 0.85 时合并
- Jaccard: `intersection(A, B) / union(A, B)`，基于字符 bigram
- 保留较长的文本，时间戳取并集 `[min(start), max(end)]`

---

## 7. Groq 音频转录

当 B站 API 返回空字幕列表时，降级到 Groq Whisper。

### 7.1 音频 URL 获取

```typescript
// lib/transcription/audio-extractor.ts

// 方式: 调用 /x/player/playurl API 获取 DASH 音频流 URL
// API: https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16
// fnval=16 表示请求 DASH 格式
// 响应: data.dash.audio[0].baseUrl (音频流URL)

export async function getAudioUrl(bvid: string, cid: number): Promise<string> {
  const url = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16`;
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json();
  return data.data.dash.audio[0].baseUrl;
}
```

**注意**: 音频 URL 有时效性（通常数小时），需要在使用前获取。

### 7.2 音频下载

```typescript
// 在 Background 中下载音频
// B站音频 CDN 需要 Referer 头
export async function downloadAudio(audioUrl: string): Promise<Blob> {
  const res = await fetch(audioUrl, {
    headers: {
      'Referer': 'https://www.bilibili.com',
      'User-Agent': navigator.userAgent,
    },
  });
  return res.blob();
}
```

### 7.3 Groq API 调用

```typescript
// lib/transcription/groq-client.ts

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const GROQ_MODEL = 'whisper-large-v3-turbo';

export async function transcribeWithGroq(
  audioBlob: Blob,
  apiKey: string,
  title: string,
): Promise<GroqTranscriptionResult> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp4');
  formData.append('model', GROQ_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  formData.append('prompt', buildTranscriptionPrompt(title));
  
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers);
    throw new RateLimitError(retryAfter);
  }
  
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error?.message ?? `Groq API error: ${res.status}`);
  }
  
  // 解析配额信息
  const quota: GroqQuota = {
    remainingTokens: Number(res.headers.get('x-ratelimit-remaining-tokens')),
    remainingRequests: Number(res.headers.get('x-ratelimit-remaining-requests')),
    resetTokens: res.headers.get('x-ratelimit-reset-tokens') ?? '',
  };
  
  const result = await res.json();
  
  // result.segments: [{ id, seek, start, end, text }, ...]
  const rows: SubtitleRow[] = result.segments.map(
    (seg: { start: number; end: number; text: string }) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    })
  );
  
  return { rows, quota };
}

function buildTranscriptionPrompt(title: string): string {
  return `只转写音频里真实说出的中文内容，不要添加任何总结、标题或注释。视频标题：${title}`;
}
```

### 7.4 大文件分块

Groq 限制单次上传 25MB。超过时需分块：

```typescript
// lib/transcription/chunking.ts

export async function transcribeLargeAudio(
  audioBlob: Blob,
  apiKey: string,
  title: string,
): Promise<SubtitleRow[]> {
  if (audioBlob.size <= GROQ_MAX_FILE_SIZE) {
    const result = await transcribeWithGroq(audioBlob, apiKey, title);
    return result.rows;
  }
  
  // 按大小均分（不考虑音频帧边界，Groq 会处理）
  const chunks = splitBlob(audioBlob, GROQ_MAX_FILE_SIZE);
  const allRows: SubtitleRow[] = [];
  let timeOffset = 0;
  
  for (const chunk of chunks) {
    const result = await transcribeWithGroq(chunk, apiKey, title);
    // 累加时间偏移
    for (const row of result.rows) {
      allRows.push({
        start: row.start + timeOffset,
        end: row.end + timeOffset,
        text: row.text,
      });
    }
    if (result.rows.length > 0) {
      timeOffset = allRows[allRows.length - 1].end;
    }
  }
  
  return allRows;
}
```

**注意**: Blob 按字节切分不能保证音频帧完整。Bilitato 的做法是直接按字节切分并依赖 Whisper 的容错能力。更稳健的方案是用 ffmpeg.wasm 按时间切分，但会增加复杂度。MVP 先用字节切分。

---

## 8. LLM 总结

### 8.1 Provider 适配

支持 OpenAI 协议兼容的多 Provider：

```typescript
// lib/llm/provider-adapter.ts

interface LLMConfig {
  provider: string;       // 'openai' | 'deepseek' | 'zhipu' | 'moonshot' | 'custom'
  apiKey: string;
  model: string;
  baseUrl?: string;       // custom provider 的端点
}

// 已知 Provider 端点映射
const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  moonshot: 'https://api.moonshot.cn/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
};

export async function callLLM(
  config: LLMConfig,
  messages: ChatMessage[],
  options?: { stream?: boolean; timeout?: number },
): Promise<string> {
  const endpoint = config.baseUrl
    ?? PROVIDER_ENDPOINTS[config.provider]
    ?? PROVIDER_ENDPOINTS.openai;
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: options?.stream ?? false,
    }),
    signal: AbortSignal.timeout(options?.timeout ?? 120_000),
  });
  
  if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
  
  if (options?.stream) {
    return readSSEStream(res);
  }
  
  const data = await res.json();
  return data.choices[0].message.content;
}
```

### 8.2 Prompt 模板

```typescript
// lib/llm/prompt-builder.ts

export function buildSummaryPrompt(subtitle: SubtitleRow[]): ChatMessage[] {
  const subtitleText = subtitle
    .map((row, i) => `#${i} [${formatTime(row.start)}] ${row.text}`)
    .join('\n');
  
  return [
    {
      role: 'system',
      content: '你是一个中文视频内容分析助手。请基于字幕内容生成结构化总结。',
    },
    {
      role: 'user',
      content: `以下是视频字幕内容：\n\n${subtitleText}\n\n请生成视频总结：\n1. 先用2-4句话概括视频核心内容\n2. 然后用3-5个加粗小标题分段展开关键要点\n\n格式要求：纯Markdown，使用 **加粗** 作为小标题，不要用JSON。`,
    },
  ];
}

export function buildSegmentsPrompt(subtitle: SubtitleRow[]): ChatMessage[] {
  const subtitleText = subtitle
    .map((row, i) => `#${i} [${formatTime(row.start)}-${formatTime(row.end)}] ${row.text}`)
    .join('\n');
  
  return [
    {
      role: 'system',
      content: '你是一个中文视频内容分析助手。请基于字幕将视频分成逻辑章节。',
    },
    {
      role: 'user',
      content: `以下是视频字幕：\n\n${subtitleText}\n\n请将视频分成4-7个逻辑章节，输出JSON数组：\n[{"start": 秒数, "end": 秒数, "label": "章节标题", "type": "content"}]\n\ntype 可以是 "content"（正片）或 "ad"（广告/推广）。只输出JSON数组，不要其他文本。`,
    },
  ];
}

// Efficiency 模式：单次请求合并总结+分段
export function buildMergedPrompt(subtitle: SubtitleRow[]): ChatMessage[] {
  const subtitleText = subtitle
    .map((row, i) => `#${i} [${formatTime(row.start)}] ${row.text}`)
    .join('\n');
  
  return [
    {
      role: 'system',
      content: '你是一个中文视频内容分析助手。',
    },
    {
      role: 'user',
      content: `以下是视频字幕：\n\n${subtitleText}\n\n请完成两个任务：\n\n【任务1：视频总结】\n用2-4句话概括，再用3-5个加粗小标题展开要点。\n\n【任务2：视频分段】\n将视频分成4-7个章节，输出JSON数组。\n\n请严格按以下格式输出：\n\n<<<SUMMARY_START>>>\n（Markdown总结内容）\n<<<SUMMARY_END>>>\n\n<<<SEGMENTS_START>>>\n（JSON数组）\n<<<SEGMENTS_END>>>`,
    },
  ];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

### 8.3 总结调度

```typescript
// lib/llm/summary-orchestrator.ts

export async function runSummary(
  subtitle: SubtitleRow[],
  config: LLMConfig,
  mode: 'quality' | 'efficiency',
): Promise<SummaryResult> {
  if (mode === 'efficiency') {
    return runEfficiencyMode(subtitle, config);
  }
  return runQualityMode(subtitle, config);
}

// Quality: 两个独立请求并行
async function runQualityMode(
  subtitle: SubtitleRow[],
  config: LLMConfig,
): Promise<SummaryResult> {
  const [summary, segments] = await Promise.all([
    callLLM(config, buildSummaryPrompt(subtitle)),
    callLLM(config, buildSegmentsPrompt(subtitle)),
  ]);
  
  return {
    summary: sanitizeSummary(summary),
    segments: parseSegments(segments),
  };
}

// Efficiency: 单请求合并，协议标记分割
async function runEfficiencyMode(
  subtitle: SubtitleRow[],
  config: LLMConfig,
): Promise<SummaryResult> {
  const response = await callLLM(config, buildMergedPrompt(subtitle));
  
  const summary = extractProtocolSection(response, 'SUMMARY');
  const segmentsRaw = extractProtocolSection(response, 'SEGMENTS');
  
  return {
    summary: sanitizeSummary(summary),
    segments: parseSegments(segmentsRaw),
  };
}

function extractProtocolSection(text: string, section: string): string {
  const regex = new RegExp(
    `<<<${section}_START>>>\\s*([\\s\\S]*?)\\s*<<<${section}_END>>>`,
  );
  return regex.exec(text)?.[1]?.trim() ?? '';
}
```

### 8.4 分段解析

```typescript
function parseSegments(raw: string): VideoSegment[] {
  // 尝试提取 JSON 数组
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeSegments(parsed);
  } catch {
    return [];
  }
}

function normalizeSegments(raw: unknown[]): VideoSegment[] {
  return raw
    .filter((item): item is Record<string, unknown> => 
      typeof item === 'object' && item !== null
    )
    .map((item) => ({
      start: Number(item.start) || 0,
      end: Number(item.end) || 0,
      label: String(item.label || ''),
      type: item.type === 'ad' ? 'ad' as const : 'content' as const,
    }))
    .filter((seg) => seg.end > seg.start && seg.label);
}
```

---

## 9. Content Script UI

### 9.1 入口

```typescript
// entrypoints/bilibili-video.content/index.ts
import './style.css';
import ReactDOM from 'react-dom/client';
import App from './App';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'favbase-panel',
      position: 'inline',
      anchor: 'body',
      isolateEvents: true,  // 防止键盘事件泄漏到B站播放器
      onMount: (container) => {
        const wrapper = document.createElement('div');
        container.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
```

### 9.2 视频检测 Hook

```typescript
// entrypoints/bilibili-video.content/hooks/useVideoDetect.ts

export function useVideoDetect() {
  const [bvid, setBvid] = useState<string | null>(null);

  useEffect(() => {
    // 初始检测
    const currentBvid = extractBvid(window.location.href);
    setBvid(currentBvid);

    // B站是 SPA，监听 URL 变化
    // 方式1: popstate（浏览器前进后退）
    const onPopState = () => setBvid(extractBvid(window.location.href));
    window.addEventListener('popstate', onPopState);

    // 方式2: MutationObserver 监听 title 变化（B站 pushState 不触发 popstate）
    const observer = new MutationObserver(() => {
      const newBvid = extractBvid(window.location.href);
      if (newBvid !== bvid) setBvid(newBvid);
    });
    observer.observe(document.querySelector('title')!, { childList: true });

    return () => {
      window.removeEventListener('popstate', onPopState);
      observer.disconnect();
    };
  }, []);

  return bvid;
}
```

### 9.3 面板布局

面板固定在页面右侧（类似 Bilitato），包含：

1. **顶部工具栏**: 折叠/展开按钮 + 设置入口
2. **Tab 导航**: 字幕 | 总结 | 分段
3. **内容区**:
   - 字幕 Tab: 带时间戳的字幕列表，点击时间戳跳转视频
   - 总结 Tab: Markdown 渲染的总结内容
   - 分段 Tab: 章节列表，点击跳转
4. **底部状态栏**: 字幕来源标识 + 操作按钮（转录/总结）

### 9.4 视频跳转

```typescript
// 通过 postMessage 或直接 DOM 操作控制 B站播放器
function seekVideo(seconds: number) {
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = seconds;
    video.play();
  }
}
```

---

## 10. 设置与存储

### 10.1 WXT Storage Items

```typescript
// lib/storage.ts
import { storage } from 'wxt/storage';

// Groq API Key
export const groqApiKey = storage.defineItem<string>('local:groqApiKey', {
  defaultValue: '',
});

// LLM 配置
export const llmConfig = storage.defineItem<LLMConfig>('local:llmConfig', {
  defaultValue: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
  },
});

// 总结模式
export const summaryMode = storage.defineItem<'quality' | 'efficiency'>(
  'local:summaryMode',
  { defaultValue: 'efficiency' },
);

// 缓存：按 BV 号存储字幕和总结结果
export const videoCache = storage.defineItem<Record<string, VideoCacheEntry>>(
  'local:videoCache',
  { defaultValue: {} },
);
```

### 10.2 缓存结构

```typescript
interface VideoCacheEntry {
  bvid: string;
  title: string;
  subtitle: SubtitleRow[];
  subtitleSource: 'bilibili' | 'groq';
  summary?: string;
  segments?: VideoSegment[];
  updatedAt: number;
}
```

---

## 11. wxt.config.ts 完整配置

```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: '把你的社交媒体收藏自动变成可搜索的知识库',
    permissions: ['storage'],
    host_permissions: [
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://*.bilivideo.com/*',   // 音频 CDN
      'https://api.groq.com/*',
      // LLM providers — 按需添加
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://open.bigmodel.cn/*',
      'https://api.moonshot.cn/*',
      'https://api.siliconflow.cn/*',
    ],
  },
});
```

---

## 12. 实现任务分解

按依赖顺序排列，每个任务可独立交付和验证。

### Phase 0: 基础设施

| ID | 任务 | 产出 | 验证方式 |
|----|------|------|---------|
| T0.1 | 共享类型定义 | `lib/types.ts` | `tsc --noEmit` |
| T0.2 | 消息类型 + 发送封装 | `lib/messages.ts`, `lib/messaging.ts` | 类型检查 |
| T0.3 | WXT 配置（权限、host） | `wxt.config.ts` | `pnpm dev` 启动无报错 |
| T0.4 | Storage items 定义 | `lib/storage.ts` | 在 popup 中读写验证 |

### Phase 1: 字幕获取

| ID | 任务 | 产出 | 验证方式 |
|----|------|------|---------|
| T1.1 | BV号解析 + CID获取 | `lib/bilibili/video-info.ts` | 单元测试 |
| T1.2 | B站字幕 API 封装 | `lib/bilibili/subtitle-fetcher.ts` | 在 background 中对真实视频调用，console 输出字幕 |
| T1.3 | Background 消息处理（FETCH_SUBTITLE） | `entrypoints/background.ts` | Content Script 发消息 → 收到字幕响应 |
| T1.4 | 字幕预处理管线 | `lib/subtitle/preprocessor.ts` | 单元测试（给定输入输出） |
| T1.5 | Content Script 骨架 + 视频检测 | `entrypoints/bilibili-video.content/` | 打开B站视频页 → console 输出 BV号 |
| T1.6 | 最简 UI: 显示字幕列表 | React 组件 | 打开视频页 → 浮窗显示字幕文本 |

### Phase 2: Groq 转录

| ID | 任务 | 依赖 | 产出 |
|----|------|------|------|
| T2.1 | 音频 URL 获取 | T1.2 | `lib/transcription/audio-extractor.ts` |
| T2.2 | Groq API 客户端 | — | `lib/transcription/groq-client.ts` |
| T2.3 | 大文件分块 | T2.2 | `lib/transcription/chunking.ts` |
| T2.4 | Background 消息处理（TRANSCRIBE_AUDIO） | T2.1-T2.3 | background 中的转录流程 |
| T2.5 | UI: 转录按钮 + 进度 | T2.4 | 无字幕视频页 → 点击转录 → 显示字幕 |

### Phase 3: LLM 总结

| ID | 任务 | 依赖 | 产出 |
|----|------|------|------|
| T3.1 | Provider 适配器 | — | `lib/llm/provider-adapter.ts` |
| T3.2 | Prompt 模板 | — | `lib/llm/prompt-builder.ts` |
| T3.3 | 总结调度器 | T3.1, T3.2 | `lib/llm/summary-orchestrator.ts` |
| T3.4 | Background 消息处理（RUN_SUMMARY） | T3.3 | 发消息 → 返回总结结果 |
| T3.5 | UI: 总结/分段展示 | T3.4 | 总结 Tab 显示 Markdown，分段 Tab 显示章节 |

### Phase 4: 完善

| ID | 任务 | 依赖 | 产出 |
|----|------|------|------|
| T4.1 | 缓存读写（避免重复请求） | T1-T3 | storage 缓存逻辑 |
| T4.2 | 设置 UI（API Keys 配置） | T0.4 | SettingsView 组件 |
| T4.3 | 时间戳点击跳转 | T1.6 | 点击字幕时间戳 → 视频跳转 |
| T4.4 | 错误处理与重试 | 全部 | 各模块的错误边界、UI 错误提示 |
| T4.5 | 样式优化 | T1.6 | 与 B站页面视觉协调 |

---

## 13. Bilitato 参考索引

在实现过程中，以下 Bilitato 源文件值得直接参考：

| 文件 | 路径 | 参考内容 |
|------|------|---------|
| content.js | `02_Bilitato/content.js` | `fetchSubtitleByPlayerApi()` (L6545) — 字幕API调用; Shadow DOM创建 (L1065); `triggerDefaultSubtitleCapture()` (L6133) — 字幕捕获流程 |
| background.js | `02_Bilitato/background.js` | `requestGroqTranscription()` (L2050) — Groq API封装; `runSummarySegmentsInQuality()` (L2710) — Quality模式; `runSummarySegmentsInEfficiency()` — Efficiency模式 |
| promptBuilder.js | `02_Bilitato/utils/promptBuilder.js` | `buildPrompt()` — 各任务 prompt 模板; `buildMergedSummarySegmentsPrompt()` — 合并模式 prompt |
| providerAdapter.js | `02_Bilitato/utils/providerAdapter.js` | `callAIWithTimeout()` (L234) — 多Provider路由; 端点映射; SSE流解析 |
| asrTranscription.js | `02_Bilitato/utils/asrTranscription.js` | `buildGroqTranscriptionPrompt()` — 转录 prompt |
| asrChunking.js | `02_Bilitato/utils/asrChunking.js` | `mergeTimestampedChunkRows()` — 分块合并 |
| subtitleProcessor.js | `02_Bilitato/utils/subtitleProcessor.js` | `normalizeSegments()`, `sanitizeSummaryOutput()` — 后处理 |

---

## 14. 关键风险

1. **B站 CID 获取**: 不通过 inject script 获取 `window.__INITIAL_STATE__` 的话，需要额外一次 API 调用。但 `/x/web-interface/view` 接口稳定，风险低。
2. **音频下载体积**: 长视频音频可能超过 100MB，Groq 需要多次分块请求。每次 Groq 请求可能需要 30-60 秒。需要 UI 进度反馈。
3. **LLM 长文本截断**: 超长视频字幕可能超出 LLM 上下文窗口。需要在 prompt 构建时做截断或分段处理。
4. **B站 SPA 路由**: B站视频页是 SPA，切换视频不触发 content script 重新加载。需要监听 URL 变化重置状态。
5. **Shadow DOM 键盘事件**: 如果不隔离键盘事件，用户在面板输入时会触发 B站播放器快捷键（空格暂停等）。`isolateEvents: true` 可解决。
