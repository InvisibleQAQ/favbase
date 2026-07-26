import { describe, it, expect } from 'vitest';
import {
  sanitizeFileName,
  sanitizeTag,
  quoteYamlScalar,
  dedupeFileName,
  FILENAME_MAX_LENGTH,
} from './sanitize';

const ID = '3f7a1c2e-9b4d-4a1f-8e2c-77aa11bb22cc';

describe('sanitizeFileName', () => {
  it('keeps a clean title untouched', () => {
    expect(sanitizeFileName('React Hooks 入门', ID)).toBe('React Hooks 入门');
  });

  // Obsidian forbids these on every OS: internal links break even when the OS allows them.
  it.each(['[', ']', '#', '^', '|'])('replaces cross-platform forbidden char %s', (ch) => {
    expect(sanitizeFileName(`a${ch}b`, ID)).toBe('a b');
  });

  // Windows additionally forbids these.
  it.each(['\\', '/', ':', '*', '?', '<', '>', '"'])(
    'replaces Windows forbidden char %s',
    (ch) => {
      expect(sanitizeFileName(`a${ch}b`, ID)).toBe('a b');
    },
  );

  it('collapses whitespace produced by replacement', () => {
    expect(sanitizeFileName('某个视频: 标题 / 副标题', ID)).toBe('某个视频 标题 副标题');
  });

  // Fullwidth punctuation is legal everywhere — only the ASCII forms are forbidden.
  it('keeps fullwidth punctuation that no filesystem rejects', () => {
    expect(sanitizeFileName('某个视频：标题', ID)).toBe('某个视频：标题');
  });

  it('strips control characters', () => {
    const raw = `a${String.fromCharCode(1)}b${String.fromCharCode(127)}c`;
    expect(sanitizeFileName(raw, ID)).toBe('abc');
  });

  it('strips leading dots so Obsidian does not treat the file as hidden', () => {
    expect(sanitizeFileName('..hidden', ID)).toBe('hidden');
  });

  it('strips trailing dots and spaces that Windows rejects', () => {
    expect(sanitizeFileName('title...  ', ID)).toBe('title');
  });

  it('truncates over-long titles', () => {
    const out = sanitizeFileName('い'.repeat(300), ID);
    expect(out).toHaveLength(FILENAME_MAX_LENGTH);
  });

  it('re-trims trailing dots exposed by truncation', () => {
    const raw = `${'a'.repeat(FILENAME_MAX_LENGTH - 1)}.tail`;
    expect(sanitizeFileName(raw, ID)).toBe('a'.repeat(FILENAME_MAX_LENGTH - 1));
  });

  it('falls back to an id-derived name when nothing survives', () => {
    expect(sanitizeFileName('###', ID)).toBe('untitled-3f7a1c2e');
    expect(sanitizeFileName('   ', ID)).toBe('untitled-3f7a1c2e');
    expect(sanitizeFileName('', ID)).toBe('untitled-3f7a1c2e');
  });
});

describe('sanitizeTag', () => {
  it('keeps CJK tags verbatim — Obsidian supports Unicode tags', () => {
    expect(sanitizeTag('前端')).toBe('前端');
  });

  it('turns spaces into hyphens because Obsidian has no multi-word tags', () => {
    expect(sanitizeTag('react hooks')).toBe('react-hooks');
    expect(sanitizeTag('a   b')).toBe('a-b');
  });

  it('preserves nested tag slashes and existing hyphens/underscores', () => {
    expect(sanitizeTag('inbox/to-read_v2')).toBe('inbox/to-read_v2');
  });

  it('drops characters outside the Obsidian tag charset', () => {
    expect(sanitizeTag('c#')).toBe('c');
    expect(sanitizeTag('a,b')).toBe('ab');
    expect(sanitizeTag('[draft]')).toBe('draft');
    expect(sanitizeTag('v1.2')).toBe('v12');
  });

  it('collapses hyphen runs and trims separator edges', () => {
    expect(sanitizeTag('  a -- b  ')).toBe('a-b');
    expect(sanitizeTag('/nested/')).toBe('nested');
  });

  // Obsidian: "tags must contain at least one non-numerical character".
  // We require a letter or pictograph, which is legal under every reading of that rule.
  it('prefixes tags with no letter', () => {
    expect(sanitizeTag('1984')).toBe('_1984');
    expect(sanitizeTag('12 34')).toBe('_12-34');
  });

  it('returns null when nothing survives, so the caller drops the tag', () => {
    expect(sanitizeTag('###')).toBeNull();
    expect(sanitizeTag('   ')).toBeNull();
    expect(sanitizeTag('')).toBeNull();
  });

  // Guarantees the frontmatter writer never needs to quote a tag.
  it('never emits a YAML metacharacter', () => {
    const hostile = ': # " \' [ ] { } , & * ! | > % @ ` \n \\ - a1';
    const out = sanitizeTag(hostile);
    expect(out).not.toBeNull();
    expect(out).toMatch(/^[\p{L}\p{N}\p{M}\p{Extended_Pictographic}_/-]+$/u);
  });
});

describe('quoteYamlScalar', () => {
  it('always double-quotes so no "does this need quoting" branch exists', () => {
    expect(quoteYamlScalar('plain')).toBe('"plain"');
  });

  it('escapes backslashes and double quotes', () => {
    expect(quoteYamlScalar('a\\b')).toBe('"a\\\\b"');
    expect(quoteYamlScalar('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes newlines, tabs and carriage returns', () => {
    expect(quoteYamlScalar('a\nb')).toBe('"a\\nb"');
    expect(quoteYamlScalar('a\r\nb')).toBe('"a\\r\\nb"');
    expect(quoteYamlScalar('a\tb')).toBe('"a\\tb"');
  });

  it('survives titles that would break plain YAML', () => {
    expect(quoteYamlScalar('某个视频：标题')).toBe('"某个视频：标题"');
    expect(quoteYamlScalar('- leading dash')).toBe('"- leading dash"');
    expect(quoteYamlScalar('# hash')).toBe('"# hash"');
    expect(quoteYamlScalar('')).toBe('""');
  });
});

describe('dedupeFileName', () => {
  it('returns the base name when free', () => {
    expect(dedupeFileName('bilibili/编程', 'note', new Set())).toBe('note');
  });

  it('suffixes collisions within the same directory', () => {
    const used = new Set<string>();
    const dir = 'bilibili/编程';
    expect(dedupeFileName(dir, 'note', used)).toBe('note');
    expect(dedupeFileName(dir, 'note', used)).toBe('note (2)');
    expect(dedupeFileName(dir, 'note', used)).toBe('note (3)');
  });

  it('does not collide across different directories', () => {
    const used = new Set<string>();
    expect(dedupeFileName('a', 'note', used)).toBe('note');
    expect(dedupeFileName('b', 'note', used)).toBe('note');
  });

  // Extraction targets (Windows/macOS) are case-insensitive: 'Note' would overwrite 'note'.
  it('treats names differing only in case as colliding', () => {
    const used = new Set<string>();
    expect(dedupeFileName('a', 'Note', used)).toBe('Note');
    expect(dedupeFileName('a', 'note', used)).toBe('note (2)');
  });
});
