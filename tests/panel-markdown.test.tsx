import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/entrypoints/bilibili-video.content/components/Markdown';

/**
 * The panel's Markdown renderer runs on raw model output, so the escaping and
 * block-boundary behaviour is security-relevant, not cosmetic.
 */
function render(text: string): string {
  return renderToStaticMarkup(<Markdown text={text} />);
}

describe('Markdown', () => {
  it('renders bold subheadings and bullet lists', () => {
    const html = render('**Key points**\n- first\n- second');
    expect(html).toContain('<strong>Key points</strong>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
  });

  it('treats ordered items as list entries too', () => {
    expect(render('1. alpha\n2. beta')).toContain('<li>alpha</li>');
  });

  it('renders headings, inline code and italics', () => {
    const html = render('## Title\ntext with `code` and *stress*');
    expect(html).toContain('favbase-md-heading');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<em>stress</em>');
  });

  it('renders fenced code blocks verbatim', () => {
    const html = render('```\nconst a = 1;\n```');
    expect(html).toContain('<pre class="favbase-md-code"><code>const a = 1;</code></pre>');
  });

  it('escapes HTML in model output instead of injecting it', () => {
    const html = render('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps paragraphs and lists separate', () => {
    const html = render('intro line\n\n- item');
    expect(html).toContain('<p class="favbase-md-paragraph">intro line</p>');
    expect(html).toContain('<ul class="favbase-md-list">');
  });

  it('renders nothing for empty input', () => {
    expect(render('')).toBe('<div class="favbase-md"></div>');
  });
});
