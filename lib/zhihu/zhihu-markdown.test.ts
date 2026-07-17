import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, unwrapZhihuRedirect } from './zhihu-markdown';

describe('unwrapZhihuRedirect', () => {
  it('unwraps link.zhihu.com/?target= redirects', () => {
    expect(
      unwrapZhihuRedirect('https://link.zhihu.com/?target=https%3A//example.com/a%3Fb%3D1'),
    ).toBe('https://example.com/a?b=1');
  });

  it('keeps normal and invalid hrefs untouched', () => {
    expect(unwrapZhihuRedirect('https://example.com/x')).toBe('https://example.com/x');
    expect(unwrapZhihuRedirect('/relative/path')).toBe('/relative/path');
  });
});

describe('htmlToMarkdown', () => {
  it('converts basic rich text to markdown', () => {
    const md = htmlToMarkdown('<h2>Title</h2><p>hello <strong>world</strong></p>');
    expect(md).toContain('## Title');
    expect(md).toContain('hello **world**');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });

  it('prefers data-actualsrc for lazy images and strips the size suffix', () => {
    const md = htmlToMarkdown(
      '<img src="data:image/svg+xml;utf8,placeholder" data-actualsrc="https://pic1.zhimg.com/v2-abc_720w.jpg" alt="">',
    );
    expect(md).toBe('![](https://pic1.zhimg.com/v2-abc.jpg)');
  });

  it('drops noscript lazy-load duplicates', () => {
    const md = htmlToMarkdown(
      '<noscript><img src="https://pic1.zhimg.com/dup.jpg"></noscript><img data-actualsrc="https://pic1.zhimg.com/real.jpg">',
    );
    expect(md).toBe('![](https://pic1.zhimg.com/real.jpg)');
  });

  it('falls back to alt text (LaTeX formulas) for data-URI-only images', () => {
    const md = htmlToMarkdown('<img src="data:image/svg;x" alt="E=mc^2" eeimg="1">');
    expect(md).toBe('E=mc^2');
  });

  it('unwraps zhihu redirect links in anchors', () => {
    const md = htmlToMarkdown(
      '<a href="https://link.zhihu.com/?target=https%3A//example.com">Example</a>',
    );
    expect(md).toBe('[Example](https://example.com)');
  });
});
