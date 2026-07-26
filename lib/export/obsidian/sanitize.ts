/**
 * Obsidian-safe string sanitizers. Pure functions, no DB or DOM access.
 *
 * The forbidden sets below are not defensive guesses — they are what Obsidian
 * itself rejects (see the task research note). Getting them wrong produces a
 * vault with silently-ignored files or broken internal links.
 */

// Obsidian rejects these on every OS: even where the filesystem allows them,
// internal links (wikilinks) stop resolving.
// Windows additionally rejects \ / : * ? < > " — folded into one class.
const FORBIDDEN_FILENAME_CHARS = /[[\]#^|\\/:*?<>"]/g;

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// Dots and spaces at either edge: a leading dot makes the file hidden (Obsidian
// silently ignores it), a trailing dot or space is rejected by Windows.
const EDGE_DOTS_AND_SPACES = /^[.\s]+|[.\s]+$/g;

/**
 * CJK is 3 bytes per char in UTF-8; 100 chars stays clear of the 255-byte
 * single-segment limit and leaves room under Windows' 260-char path cap.
 */
export const FILENAME_MAX_LENGTH = 100;

export function sanitizeFileName(raw: string, fallbackId: string): string {
  const cleaned = raw
    .replace(FORBIDDEN_FILENAME_CHARS, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(EDGE_DOTS_AND_SPACES, '')
    .slice(0, FILENAME_MAX_LENGTH)
    // Truncation can expose a fresh trailing dot or space.
    .replace(EDGE_DOTS_AND_SPACES, '');

  return cleaned || `untitled-${fallbackId.slice(0, 8)}`;
}

// Obsidian tag charset: letters, numbers, marks, emoji, _ - and / for nesting.
// A whitelist (rather than a blacklist) is what lets the frontmatter writer emit
// tags unquoted — no YAML metacharacter can survive this.
const NON_TAG_CHARS = /[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}_/-]/gu;

const HAS_LETTER = /[\p{L}\p{Extended_Pictographic}]/u;

/**
 * Returns null when nothing legal survives — the caller drops the tag rather
 * than emitting an empty one.
 */
export function sanitizeTag(raw: string): string | null {
  const cleaned = raw
    // Obsidian has no multi-word tags; the properties UI would split on spaces.
    .replace(/\s+/g, '-')
    .replace(NON_TAG_CHARS, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');

  if (!cleaned) return null;
  // Obsidian requires at least one non-numerical character (#1984 is invalid).
  // Requiring a letter is legal under every reading of that rule.
  return HAS_LETTER.test(cleaned) ? cleaned : `_${cleaned}`;
}

const YAML_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/**
 * Always double-quotes. Deciding *when* a scalar needs quoting is a pile of
 * special cases (leading -, #, :, digit-like, bool-like, edge whitespace);
 * quoting unconditionally is valid YAML and has none of them.
 */
export function quoteYamlScalar(raw: string): string {
  const escaped = raw.replace(/[\\"\n\r\t]/g, (ch) => YAML_ESCAPES[ch]);
  return `"${escaped}"`;
}

/**
 * Resolves same-directory filename collisions to `name`, `name (2)`, `name (3)`.
 *
 * `used` accumulates taken paths and is mutated. Keys are lowercased because the
 * extraction target (Windows/macOS) is case-insensitive — `Note` and `note` in
 * one folder would overwrite each other.
 */
export function dedupeFileName(dir: string, base: string, used: Set<string>): string {
  const key = (name: string) => `${dir}/${name}`.toLowerCase();

  let name = base;
  for (let n = 2; used.has(key(name)); n += 1) {
    name = `${base} (${n})`;
  }

  used.add(key(name));
  return name;
}
