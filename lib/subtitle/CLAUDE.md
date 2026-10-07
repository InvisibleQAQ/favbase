# lib/subtitle

平台无关的字幕共享类型（`SubtitleRow` / `SubtitleSource` / `SubtitleResult`）。

- 所有层（平台、transcription、cache、offscreen、UI）都从这里导入，不各自重新定义。
- `SubtitleSource` 按转录方法区分（`'official' | 'asr'`），不要加平台名或工具名（如 `'bilibili'` / `'groq'`）。
