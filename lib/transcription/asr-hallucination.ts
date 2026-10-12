/**
 * Whisper's fixed hallucinations on non-speech audio (docs/40). Trained on
 * video subtitles that carry a credit or a channel plug over the silent
 * stretches, the model answers silence and music with those lines.
 *
 * Every entry is a credit or a channel / site plug that real speech almost
 * never says: a channel or site name, a credited pseudonym, or the credit
 * head "字幕志愿者" that the model follows with a different random name each
 * time. "Almost": a speaker talking about subtitle volunteering loses that
 * segment, an accepted cost. Phrases that also occur in real speech
 * ("谢谢观看", "点赞 订阅 转发") are deliberately absent: dropping them would
 * delete what people actually said. NFKC folds width, not script, so a
 * Traditional spelling needs its own entry. Add an entry only with a source.
 */
const HALLUCINATION_SIGNATURES = [
  // docs/37 Step 4; vexa #155; HF whisper-large-v3-turbo discussion #35
  '字幕志愿者',
  '明镜与点点',
  '明鏡與點點',
  '优优独播剧场',
  'YoYo Television Series Exclusive',
  // Traditional forms of the two above, both seen in published Whisper
  // auto-transcripts ("字幕志願者 李宗盛" on Dailymotion, "優優獨播劇場——YoYo
  // Television Series Exclusive" on Gan Jing World)
  '字幕志願者',
  '優優獨播劇場',
  // openai/whisper discussion #928 (zh)
  'Amara.org',
  // MioSub hallucinationFilter.ts (curated from WhisperJAV)
  '字幕by索兰娅',
  'Zither Harp',
].map(normalize);

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function isKnownAsrHallucination(text: string): boolean {
  const normalized = normalize(text);
  return HALLUCINATION_SIGNATURES.some((signature) => normalized.includes(signature));
}
