import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

import { toObsidianZip, VAULT_ROOT, UNSORTED_DIR } from './serialize';
import type { ObsidianNote } from './query';

const LINK_LABEL = 'Original';
const OPTIONS = { originalLinkLabel: LINK_LABEL };

let seq = 0;
function note(overrides: Partial<ObsidianNote> = {}): ObsidianNote {
  seq += 1;
  return {
    id: `0000000${seq}-9b4d-4a1f-8e2c-77aa11bb22cc`,
    platform: 'bilibili',
    title: 'React Hooks 入门',
    authorName: 'UP主',
    originalUrl: 'https://www.bilibili.com/video/BV1xx',
    publishedAt: new Date('2025-03-14T08:00:00.000Z'),
    savedAt: new Date('2026-07-20T10:11:12.000Z'),
    plainText: '第一句。第二句。',
    sources: ['编程学习'],
    tags: ['前端'],
    ...overrides,
  };
}

function unzip(notes: ObsidianNote[]): Record<string, string> {
  const files = unzipSync(toObsidianZip(notes, OPTIONS));
  return Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]),
  );
}

function frontmatterOf(content: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) throw new Error(`no frontmatter in:\n${content}`);
  return match[1];
}

describe('toObsidianZip paths', () => {
  it('nests notes under <root>/<platform>/<collection>/<title>.md', () => {
    const paths = Object.keys(unzip([note()]));
    expect(paths).toEqual([`${VAULT_ROOT}/bilibili/编程学习/React Hooks 入门.md`]);
  });

  it('emits exactly one file for an item in several collections', () => {
    const paths = Object.keys(unzip([note({ sources: ['技术收藏', '产品思考'] })]));
    // Alphabetical first source owns the directory; the other is frontmatter-only.
    expect(paths).toEqual([`${VAULT_ROOT}/bilibili/产品思考/React Hooks 入门.md`]);
  });

  it('falls back to the unsorted directory when an item has no collection', () => {
    const paths = Object.keys(unzip([note({ sources: [] })]));
    expect(paths).toEqual([`${VAULT_ROOT}/bilibili/${UNSORTED_DIR}/React Hooks 入门.md`]);
  });

  it('sanitizes platform and collection segments', () => {
    const paths = Object.keys(unzip([note({ sources: ['a/b:c'] })]));
    expect(paths).toEqual([`${VAULT_ROOT}/bilibili/a b c/React Hooks 入门.md`]);
  });

  it('suffixes colliding titles in the same directory instead of overwriting', () => {
    const paths = Object.keys(unzip([note({ title: 'dup' }), note({ title: 'dup' })]));
    expect(paths).toEqual([
      `${VAULT_ROOT}/bilibili/编程学习/dup.md`,
      `${VAULT_ROOT}/bilibili/编程学习/dup (2).md`,
    ]);
  });

  it('does not treat same-titled notes in different collections as colliding', () => {
    const paths = Object.keys(
      unzip([note({ title: 'dup', sources: ['a'] }), note({ title: 'dup', sources: ['b'] })]),
    );
    expect(paths).toEqual([
      `${VAULT_ROOT}/bilibili/a/dup.md`,
      `${VAULT_ROOT}/bilibili/b/dup.md`,
    ]);
  });
});

describe('toObsidianZip frontmatter', () => {
  function only(notes: ObsidianNote[]): string {
    const files = unzip(notes);
    const paths = Object.keys(files);
    expect(paths).toHaveLength(1);
    return files[paths[0]];
  }

  it('writes the full property set', () => {
    const fm = frontmatterOf(
      only([note({ id: 'fixed001-9b4d-4a1f-8e2c-77aa11bb22cc', sources: ['技术收藏', '产品思考'] })]),
    );
    expect(fm).toBe(
      [
        'id: "fixed001-9b4d-4a1f-8e2c-77aa11bb22cc"',
        'platform: "bilibili"',
        'title: "React Hooks 入门"',
        'author: "UP主"',
        'url: "https://www.bilibili.com/video/BV1xx"',
        'published: 2025-03-14T08:00:00.000Z',
        'saved: 2026-07-20T10:11:12.000Z',
        'sources:',
        '  - "产品思考"',
        '  - "技术收藏"',
        'tags:',
        '  - 前端',
      ].join('\n'),
    );
  });

  // Dates must stay unquoted or Obsidian parses them as text, not dates.
  it('leaves dates unquoted and quotes free text', () => {
    const fm = frontmatterOf(only([note({ title: 'a: b # c' })]));
    expect(fm).toContain('title: "a: b # c"');
    expect(fm).toContain('published: 2025-03-14T08:00:00.000Z');
    expect(fm).not.toContain('published: "');
  });

  it('omits keys with nothing to say rather than writing null', () => {
    const fm = frontmatterOf(
      only([note({ publishedAt: null, tags: [], sources: [], authorName: '' })]),
    );
    expect(fm).not.toContain('published:');
    expect(fm).not.toContain('tags:');
    expect(fm).not.toContain('sources:');
    expect(fm).not.toContain('author:');
    expect(fm).toContain('title:');
  });

  it('sanitizes tags and drops the ones that cannot be represented', () => {
    const fm = frontmatterOf(only([note({ tags: ['react hooks', '1984', '###', '前端'] })]));
    expect(fm).toContain('  - react-hooks');
    expect(fm).toContain('  - _1984');
    expect(fm).toContain('  - 前端');
    expect(fm).not.toContain('###');
  });

  it('collapses tags that sanitize to the same value', () => {
    const fm = frontmatterOf(only([note({ tags: ['react hooks', 'react-hooks', 'React Hooks'] })]));
    expect(fm.match(/ {2}- react-hooks/gi)).toHaveLength(1);
  });

  it('adds an alias when the filename cannot express the title', () => {
    const fm = frontmatterOf(only([note({ title: 'a/b' })]));
    expect(fm).toContain('aliases:\n  - "a/b"');
  });

  it('does not add a redundant alias when the title survives verbatim', () => {
    expect(frontmatterOf(only([note()]))).not.toContain('aliases:');
  });

  // A dedupe suffix is not a sanitization failure — aliasing here would collide
  // with the sibling note's own filename.
  it('does not alias notes that only got a dedupe suffix', () => {
    const files = unzip([note({ title: 'dup' }), note({ title: 'dup' })]);
    const second = files[`${VAULT_ROOT}/bilibili/编程学习/dup (2).md`];
    expect(frontmatterOf(second)).not.toContain('aliases:');
  });
});

describe('toObsidianZip body', () => {
  function bodyOf(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  it('puts a labelled link to the original above the content', () => {
    const files = unzip([note()]);
    const body = bodyOf(files[Object.keys(files)[0]]);
    expect(body).toBe(
      `\n[${LINK_LABEL}](https://www.bilibili.com/video/BV1xx)\n\n第一句。第二句。\n`,
    );
  });

  it('emits only the link when the item has no extracted content', () => {
    const files = unzip([note({ plainText: null })]);
    const body = bodyOf(files[Object.keys(files)[0]]);
    expect(body).toBe(`\n[${LINK_LABEL}](https://www.bilibili.com/video/BV1xx)\n`);
  });

  it('treats blank content as no content', () => {
    const files = unzip([note({ plainText: '   \n  ' })]);
    const body = bodyOf(files[Object.keys(files)[0]]);
    expect(body).toBe(`\n[${LINK_LABEL}](https://www.bilibili.com/video/BV1xx)\n`);
  });

  it('keeps platform markdown intact', () => {
    const md = '# Heading\n\n- [x] item\n\n```ts\nconst a = 1;\n```';
    const files = unzip([note({ plainText: md })]);
    expect(bodyOf(files[Object.keys(files)[0]])).toContain(md);
  });
});

describe('toObsidianZip edge cases', () => {
  it('produces an empty archive for no notes', () => {
    expect(Object.keys(unzip([]))).toEqual([]);
  });

  it('names files from the id when no part of the title survives', () => {
    const paths = Object.keys(unzip([note({ id: 'abcdef12-0000-0000-0000-000000000000', title: '###' })]));
    expect(paths).toEqual([`${VAULT_ROOT}/bilibili/编程学习/untitled-abcdef12.md`]);
  });
});
