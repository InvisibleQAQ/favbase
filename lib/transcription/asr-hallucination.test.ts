import { describe, expect, it } from 'vitest';

import { isKnownAsrHallucination } from './asr-hallucination';

describe('isKnownAsrHallucination', () => {
  it.each([
    '字幕志愿者 李宗盛',
    '中文字幕志愿者 杨栋梁',
    '字幕志願者 李宗盛',
    '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目',
    '請不吝點贊訂閱轉發打賞支持明鏡與點點欄目',
    '优优独播剧场——YoYo Television Series Exclusive',
    '優優獨播劇場',
    '字幕由Amara.org社区提供',
    '小編字幕由Amara.org社區提供',
    '字幕by索兰娅',
    '字幕製作人Zither Harp',
  ])('recognizes the reported phrase %s', (text) => {
    expect(isKnownAsrHallucination(text)).toBe(true);
  });

  it('recognizes several phrases fused into one segment', () => {
    expect(isKnownAsrHallucination(
      '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目 字幕志愿者 杨茜茜优优独播剧场',
    )).toBe(true);
  });

  it('ignores whitespace, full-width forms and letter case', () => {
    expect(isKnownAsrHallucination('字幕 志愿者')).toBe(true);
    expect(isKnownAsrHallucination('ＹｏＹｏ　ｔｅｌｅｖｉｓｉｏｎ series EXCLUSIVE')).toBe(true);
    expect(isKnownAsrHallucination('字幕由ＡＭＡＲＡ．ＯＲＧ社区提供')).toBe(true);
  });

  it.each([
    '谢谢观看',
    '记得点赞 订阅 转发',
    '今天聊聊字幕组是怎么做翻译的',
    '明镜高悬',
    'Amara is a subtitle platform',
    '',
  ])('keeps ordinary speech %s', (text) => {
    expect(isKnownAsrHallucination(text)).toBe(false);
  });
});
