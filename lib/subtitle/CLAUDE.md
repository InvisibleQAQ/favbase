# lib/subtitle

通用字幕共享类型（平台无关）。

## 模块结构

- `types.ts` — 通用字幕共享类型（平台无关）：SubtitleSource(`'official' | 'asr'`，按转录方法维度区分，不绑定平台/工具名), SubtitleRow(`{ start, end, text }`，通用字幕行), SubtitleResult(`{ status, rows, source?, error? }`，字幕获取结果)。所有层（bilibili/transcription/cache/offscreen/UI）统一从此模块导入
