import { describe, it, expect } from 'vitest';

import { narrowBiliVideoMeta } from './video-eligibility';

const DEFAULTS = {
  cover: '',
  intro: '',
  duration: 0,
  cnt_info: { play: 0, collect: 0, danmaku: 0 },
  attr: 0,
  type: 0,
  fav_time: 0,
};

describe('narrowBiliVideoMeta', () => {
  it('returns all safe defaults for empty / non-object meta', () => {
    expect(narrowBiliVideoMeta(undefined)).toEqual(DEFAULTS);
    expect(narrowBiliVideoMeta(null)).toEqual(DEFAULTS);
    expect(narrowBiliVideoMeta('nope')).toEqual(DEFAULTS);
    expect(narrowBiliVideoMeta(42)).toEqual(DEFAULTS);
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      cover: 'https://i0.hdslb.com/cover.jpg',
      intro: 'an intro',
      duration: 615,
      cnt_info: { play: 1200, collect: 34, danmaku: 5 },
      attr: 0,
      type: 2,
      fav_time: 1_700_000_000,
    };
    expect(narrowBiliVideoMeta(meta)).toEqual(meta);
  });

  it('drops mistyped fields to defaults', () => {
    expect(
      narrowBiliVideoMeta({
        cover: 1,
        intro: null,
        duration: '615',
        cnt_info: 'many',
        attr: '9',
        type: {},
        fav_time: [],
      }),
    ).toEqual(DEFAULTS);
  });

  it('narrows cnt_info field by field', () => {
    expect(narrowBiliVideoMeta({ cnt_info: { play: 10 } }).cnt_info).toEqual({
      play: 10,
      collect: 0,
      danmaku: 0,
    });
    expect(
      narrowBiliVideoMeta({ cnt_info: { play: '10', collect: 3, danmaku: null } }).cnt_info,
    ).toEqual({ play: 0, collect: 3, danmaku: 0 });
    expect(narrowBiliVideoMeta({ cnt_info: null }).cnt_info).toEqual(DEFAULTS.cnt_info);
  });
});
