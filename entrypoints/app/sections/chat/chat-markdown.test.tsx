import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '../../theme/theme-provider';
import { ChatMarkdown } from './chat-markdown';

function render(md: string): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <ChatMarkdown>{md}</ChatMarkdown>
    </ThemeProvider>,
  );
}

describe('ChatMarkdown', () => {
  it('renders bold emphasis as <strong>', () => {
    const html = render('This is **bold** text');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders unordered lists as <ul>/<li>', () => {
    const html = render('- one\n- two');
    expect(html).toContain('<ul');
    expect(html).toMatch(/<li[^>]*>[^<]*one/);
    expect(html).toMatch(/<li[^>]*>[^<]*two/);
  });

  it('renders fenced code blocks inside a <pre>', () => {
    const html = render('```\nconst x = 1;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('const x = 1;');
  });

  it('renders inline code as <code>', () => {
    const html = render('call `foo()` please');
    expect(html).toContain('<code');
    expect(html).toContain('foo()');
  });

  it('opens links in a new tab with safe rel', () => {
    const html = render('[nasa](https://www.nasa.gov)');
    expect(html).toContain('href="https://www.nasa.gov"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders GFM tables (remark-gfm)', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
  });

  it('does not render raw HTML (no rehype-raw, XSS-safe)', () => {
    const html = render('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
    // Raw HTML is escaped to text, never emitted as live DOM.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });
});
