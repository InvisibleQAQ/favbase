import type { ReactNode } from 'react';

/**
 * Minimal Markdown renderer for AI summaries (headings, lists, paragraphs,
 * code, bold/italic/inline-code). Emits React elements — no
 * `dangerouslySetInnerHTML`, so model output can never inject markup.
 *
 * Scope is deliberately the subset the summary prompt asks for; tables and
 * links are not rendered specially (they degrade to plain text).
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_PATTERN).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const RULE_RE = /^\s*(-{3,}|\*{3,})\s*$/;

function isListLine(line: string): boolean {
  return BULLET_RE.test(line) || ORDERED_RE.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(BULLET_RE, '').replace(ORDERED_RE, '');
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || RULE_RE.test(line)) {
      i += 1;
      continue;
    }

    // Fenced code
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or EOF)
      blocks.push(
        <pre className="favbase-md-code" key={`code-${blocks.length}`}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      // Every heading level collapses to one visual weight — the panel is
      // ~300px wide and the summary is a single section.
      blocks.push(
        <div className="favbase-md-heading" key={`h-${blocks.length}`}>
          {renderInline(heading[2], `h-${blocks.length}`)}
        </div>,
      );
      i += 1;
      continue;
    }

    if (isListLine(line)) {
      const items: string[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(stripListMarker(lines[i]));
        i += 1;
      }
      blocks.push(
        <ul className="favbase-md-list" key={`ul-${blocks.length}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isListLine(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p className="favbase-md-paragraph" key={`p-${blocks.length}`}>
        {renderInline(paragraph.join('\n'), `p-${blocks.length}`)}
      </p>,
    );
  }

  return <div className="favbase-md">{blocks}</div>;
}
