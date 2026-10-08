import { describe, expect, it } from 'vitest';
import { RetrySignal } from '@/lib/http/retry';
import { classifyResponse, DouyinRateLimitError, type DouyinEnvelope } from './douyin-api';
import { decodeDetail, isTranscribableAweme, pickAudioSourceUrls } from './douyin-media';

// ---------------------------------------------------------------------------
// Fixtures — the `aweme_detail` media shapes measured in the 2026-10-08 live
// probe (task research/douyin-step0-subtitle-media-probe-2026-10-08.md §2,
// §5), ids and signed URLs redacted. `bit_rate_audio[].audio_meta.url_list`
// is an OBJECT of three named URLs; `bit_rate[].play_addr.url_list` is an
// array of three (two CDN hosts + the play API the server signed itself).
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const COOLDOWN_MS = 1_800_000;

const AUDIO_MAIN = 'https://v26-web.douyinvod.com/sig26/6ac8b5c3/video/tos/cn/audio-a/';
const AUDIO_BACKUP = 'https://v11-weba.douyinvod.com/sig11/6ac8b5c3/video/tos/cn/audio-a/';
const AUDIO_FALLBACK = 'https://www.douyin.com/aweme/v1/play/?file_id=audio-a&sign=s&source=PackSourceEnum_AWEME_DETAIL';

function audioTrack(prefix: string) {
  return {
    audio_extra: '{"real_bitrate":667831}',
    audio_meta: {
      bitrate: 48_570,
      codec_type: 'bytevc1',
      encoded_type: 'normal',
      file_hash: 'h',
      file_id: `${prefix}-file`,
      format: 'dash',
      fps: 0,
      media_type: 'audio',
      quality: 'normal',
      size: 604_218,
      sub_info: '{"audio_profile":"aac_he_v2"}',
      url_list: {
        main_url: `${AUDIO_MAIN}${prefix}`,
        backup_url: `${AUDIO_BACKUP}${prefix}`,
        fallback_url: `${AUDIO_FALLBACK}&file=${prefix}`,
      },
    },
    audio_quality: 5,
  };
}

function urls(gear: string): string[] {
  return [
    `https://v11-weba.douyinvod.com/sig11/6ac66b53/video/tos/cn/${gear}/`,
    `https://v26-web.douyinvod.com/sig26/6ac66b53/video/tos/cn/${gear}/`,
    `https://www.douyin.com/aweme/v1/play/?file_id=${gear}&sign=s&biz_sign=b&source=PackSourceEnum_AWEME_DETAIL`,
  ];
}

function gear(
  name: string,
  bitRate: number,
  format: 'mp4' | 'dash',
  isH265: 0 | 1,
  urlList: string[] = urls(name),
) {
  return {
    FPS: 30,
    HDR_bit: '',
    HDR_type: '',
    bit_rate: bitRate,
    format,
    gear_name: name,
    is_bytevc1: isH265,
    is_h265: isH265,
    play_addr: {
      data_size: 7_590_969,
      file_cs: 'c',
      file_hash: 'h',
      height: 960,
      uri: `v0d00fg10000-${name}`,
      url_key: `v0d00fg10000-${name}_h264_540p_600000`,
      url_list: urlList,
      width: 540,
    },
    quality_type: 20,
    video_extra: '{}',
  };
}

/** The probe's ordering trap: the lowest `bit_rate` gear is h265 + dash. */
const BIT_RATE = [
  gear('1080_1_1', 1_900_000, 'mp4', 0),
  gear('720_3_1', 480_000, 'dash', 1),
  gear('adapt_low_540_0', 620_000, 'mp4', 0),
  gear('540_2_1', 560_000, 'mp4', 1),
  gear('lower_540_0', 700_000, 'mp4', 0),
];

function detail(video: Record<string, unknown>): Record<string, unknown> {
  return {
    aweme_id: '7300000000000000123',
    desc: 'a video',
    video: {
      duration: 99_000,
      cover: { url_list: ['https://p3-pc.douyinpic.com/cover.jpeg'] },
      cdn_url_expired: 1_791_463_027,
      play_addr: { uri: 'v0d00fg10000-main', url_list: urls('play_addr') },
      ...video,
    },
  };
}

function envelope(json: Record<string, unknown>, status = 200): DouyinEnvelope {
  const body = { status_code: 0, ...json };
  return { status, text: JSON.stringify(body), json: body };
}

// ---------------------------------------------------------------------------
// pickAudioSourceUrls — docs/37 D-g, three tiers in one ordered list
// ---------------------------------------------------------------------------

describe('pickAudioSourceUrls', () => {
  it('leads with the audio-only track in main → backup → fallback order, then the lowest H.264 mp4, then play_addr', () => {
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: [audioTrack('a')], bit_rate: BIT_RATE }));
    expect(picked).toEqual([
      `${AUDIO_MAIN}a`,
      `${AUDIO_BACKUP}a`,
      `${AUDIO_FALLBACK}&file=a`,
      ...urls('adapt_low_540_0'),
      ...urls('play_addr'),
    ]);
  });

  it('uses only the first usable audio track when there are two', () => {
    const picked = pickAudioSourceUrls(
      detail({ bit_rate_audio: [audioTrack('a'), audioTrack('b')], bit_rate: [] }),
    );
    expect(picked.slice(0, 3)).toEqual([`${AUDIO_MAIN}a`, `${AUDIO_BACKUP}a`, `${AUDIO_FALLBACK}&file=a`]);
    expect(picked).not.toContain(`${AUDIO_MAIN}b`);
  });

  it('starts at the mp4 tier when bit_rate_audio is null (the ≤ 53 s videos of the probe)', () => {
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: null, bit_rate: BIT_RATE }));
    expect(picked).toEqual([...urls('adapt_low_540_0'), ...urls('play_addr')]);
  });

  it('skips an audio track whose url_list carries no usable URL', () => {
    const empty = audioTrack('a');
    empty.audio_meta.url_list = { main_url: '', backup_url: '', fallback_url: '' };
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: [empty], bit_rate: BIT_RATE }));
    expect(picked[0]).toBe(urls('adapt_low_540_0')[0]);
  });

  it('never picks the lowest-bit_rate gear when it is h265 + dash: the lowest is_h265 === 0 mp4 wins', () => {
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: null, bit_rate: BIT_RATE }));
    expect(picked[0]).toContain('adapt_low_540_0');
    for (const url of picked) {
      expect(url).not.toContain('720_3_1');
      expect(url).not.toContain('540_2_1');
    }
  });

  it('falls back to the lowest h265 mp4 when no H.264 mp4 gear exists', () => {
    const h265Only = [gear('720_3_1', 480_000, 'dash', 1), gear('540_2_1', 560_000, 'mp4', 1), gear('720_2_1', 900_000, 'mp4', 1)];
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: null, bit_rate: h265Only }));
    expect(picked.slice(0, 3)).toEqual(urls('540_2_1'));
  });

  it('ignores a gear without a finite bit_rate or without URLs', () => {
    const odd = [
      gear('no-urls', 100_000, 'mp4', 0, []),
      { ...gear('nan', 0, 'mp4', 0), bit_rate: 'fast' },
      gear('ok', 800_000, 'mp4', 0),
    ];
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: null, bit_rate: odd }));
    expect(picked.slice(0, 3)).toEqual(urls('ok'));
  });

  it('falls back to play_addr when there is no bit_rate at all', () => {
    const picked = pickAudioSourceUrls(detail({ bit_rate_audio: null, bit_rate: undefined }));
    expect(picked).toEqual(urls('play_addr'));
  });

  it('returns [] when nothing is playable (an image post)', () => {
    expect(
      pickAudioSourceUrls({
        aweme_id: '1',
        images: [{ url_list: ['https://p3/img.webp'] }],
        video: { duration: 0, bit_rate_audio: null, play_addr: { url_list: [] } },
      }),
    ).toEqual([]);
    expect(pickAudioSourceUrls({ aweme_id: '1' })).toEqual([]);
  });

  it('drops duplicate URLs, keeping the first position', () => {
    const same = urls('shared');
    const picked = pickAudioSourceUrls(
      detail({
        bit_rate_audio: null,
        bit_rate: [gear('shared', 500_000, 'mp4', 0, same)],
        play_addr: { uri: 'x', url_list: [same[1], 'https://v11-weba.douyinvod.com/extra'] },
      }),
    );
    expect(picked).toEqual([...same, 'https://v11-weba.douyinvod.com/extra']);
  });

  it('keeps only non-empty strings', () => {
    const picked = pickAudioSourceUrls(
      detail({
        bit_rate_audio: null,
        bit_rate: [gear('g', 500_000, 'mp4', 0, ['', 42, 'https://v11-weba.douyinvod.com/g'] as string[])],
        play_addr: { uri: 'x', url_list: [null] },
      }),
    );
    expect(picked).toEqual(['https://v11-weba.douyinvod.com/g']);
  });
});

// ---------------------------------------------------------------------------
// decodeDetail — docs/37 D-i and §4.3 T6 / F8
// ---------------------------------------------------------------------------

describe('decodeDetail', () => {
  it('returns the aweme when aweme_detail is an object', () => {
    const payload = detail({});
    const decoded = decodeDetail(envelope({ aweme_detail: payload }), () => NOW);
    expect(decoded).toEqual({ kind: 'aweme', detail: payload });
  });

  it('takes what classifyResponse hands over for a detail body: no has_more, no list key (the Step 2 path)', () => {
    // The list shape checks (`has_more`, a list key) live in the page decoder,
    // not in `classifyResponse`, so a detail envelope passes through unchanged.
    const payload = detail({});
    const body = { status_code: 0, aweme_detail: payload, log_pb: { impr_id: 'x' } };
    const env = classifyResponse(
      { kind: 'response', status: 200, text: JSON.stringify(body) },
      'Douyin aweme/detail',
      () => NOW,
    );
    expect(env).not.toBeInstanceOf(RetrySignal);
    const decoded = decodeDetail(env as DouyinEnvelope, () => NOW);
    expect(decoded).toEqual({ kind: 'aweme', detail: payload });
  });

  it('D-i: aweme_detail null with filter_detail is a legitimate "unavailable", with the reason quoted', () => {
    const decoded = decodeDetail(
      envelope({
        aweme_detail: null,
        filter_detail: { filter_reason: 'status_self_see', detail_msg: '作品仅自己可见' },
      }),
      () => NOW,
    );
    expect(decoded.kind).toBe('unavailable');
    if (decoded.kind === 'unavailable') {
      expect(decoded.reason).toContain('status_self_see');
      expect(decoded.reason).toContain('作品仅自己可见');
    }
    const asString = decodeDetail(
      envelope({ aweme_detail: null, filter_detail: 'core_dep' }),
      () => NOW,
    );
    expect(asString).toEqual({ kind: 'unavailable', reason: 'core_dep' });
  });

  it('an empty payload without filter_detail is a withheld page: DouyinRateLimitError with the cooldown', () => {
    for (const json of [{ aweme_detail: null }, {}, { aweme_detail: null, filter_detail: {} }, { aweme_detail: null, filter_detail: '' }]) {
      let caught: unknown;
      try {
        decodeDetail(envelope(json), () => NOW);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DouyinRateLimitError);
      expect((caught as DouyinRateLimitError).resetAt?.getTime()).toBe(NOW + COOLDOWN_MS);
      expect((caught as Error).message).toContain('Douyin aweme/detail');
      expect((caught as Error).message).toContain('HTTP 200');
    }
  });

  it('an aweme_detail of another type is an unexpected shape, not a risk-control signal', () => {
    for (const aweme_detail of ['7300000000000000123', [detail({})], 7]) {
      let caught: unknown;
      try {
        decodeDetail(envelope({ aweme_detail }), () => NOW);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(DouyinRateLimitError);
      expect((caught as Error).message).toMatch(/unexpected response shape/);
    }
  });
});

// ---------------------------------------------------------------------------
// isTranscribableAweme — docs/37 D-f
// ---------------------------------------------------------------------------

describe('isTranscribableAweme', () => {
  it('is true only for a video with a positive duration', () => {
    expect(isTranscribableAweme({ mediaKind: 'video', durationMs: 15_300 })).toBe(true);
    expect(isTranscribableAweme({ mediaKind: 'note', durationMs: 15_300 })).toBe(false);
    expect(isTranscribableAweme({ mediaKind: 'note', durationMs: null })).toBe(false);
    expect(isTranscribableAweme({ mediaKind: 'video', durationMs: null })).toBe(false);
    expect(isTranscribableAweme({ mediaKind: 'video', durationMs: 0 })).toBe(false);
  });
});
