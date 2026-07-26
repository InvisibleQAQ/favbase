import { zipSync, strToU8 } from 'fflate';

import type { ObsidianNote } from './query';
import { sanitizeFileName, sanitizeTag, quoteYamlScalar, dedupeFileName } from './sanitize';

/** Top-level folder inside the archive, so extracting never litters a vault root. */
export const VAULT_ROOT = 'favbase';

/** Holds items whose collection links were dropped (see lib/ingest droppedLinkItemIds). */
export const UNSORTED_DIR = '_unsorted';

export interface ObsidianSerializeOptions {
  /** Body link text back to the original page. Translated by the UI — lib stays i18n-free. */
  originalLinkLabel: string;
}

/**
 * Quoting rule: everything is quoted except values whose bareness is either
 * functionally required (dates — Obsidian only parses unquoted ISO strings as
 * dates) or guaranteed by construction (tags, which `sanitizeTag` restricts to a
 * charset containing no YAML metacharacter). No per-field exception list.
 */
function frontmatterLines(note: ObsidianNote, sanitizedTitle: string): string[] {
  const lines = [
    `id: ${quoteYamlScalar(note.id)}`,
    `platform: ${quoteYamlScalar(note.platform)}`,
    `title: ${quoteYamlScalar(note.title)}`,
  ];

  if (note.authorName) lines.push(`author: ${quoteYamlScalar(note.authorName)}`);
  lines.push(`url: ${quoteYamlScalar(note.originalUrl)}`);
  if (note.publishedAt) lines.push(`published: ${note.publishedAt.toISOString()}`);
  lines.push(`saved: ${note.savedAt.toISOString()}`);

  // Only when the filename genuinely cannot express the title — a dedupe suffix
  // is not a sanitization failure, and aliasing it would collide with the sibling.
  if (sanitizedTitle !== note.title) {
    lines.push('aliases:', `  - ${quoteYamlScalar(note.title)}`);
  }

  const sources = sortedSources(note.sources);
  if (sources.length > 0) {
    lines.push('sources:', ...sources.map((s) => `  - ${quoteYamlScalar(s)}`));
  }

  const tags = uniqueTags(note.tags);
  if (tags.length > 0) {
    lines.push('tags:', ...tags.map((tag) => `  - ${tag}`));
  }

  return lines;
}

/**
 * Code-point order, deliberately not `localeCompare`: the collection that owns a
 * note's directory is picked from this order, and a locale-sensitive sort would
 * make the exported tree depend on the UI language.
 *
 * `queryObsidianNotes` already sorts in SQL, but sorting here too is what makes
 * `toObsidianZip` independent of input order — and of the database collation.
 */
function sortedSources(raw: string[]): string[] {
  return [...raw].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Obsidian tags are case-insensitive, so two raw tags can sanitize into one. */
function uniqueTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const tag = sanitizeTag(name);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function toMarkdown(
  note: ObsidianNote,
  sanitizedTitle: string,
  options: ObsidianSerializeOptions,
): string {
  const frontmatter = ['---', ...frontmatterLines(note, sanitizedTitle), '---'].join('\n');
  const link = `[${options.originalLinkLabel}](${note.originalUrl})`;
  const content = note.plainText?.trim();

  return content
    ? `${frontmatter}\n\n${link}\n\n${content}\n`
    : `${frontmatter}\n\n${link}\n`;
}

/**
 * One `.md` per note under `<root>/<platform>/<collection>/`.
 *
 * An item in several collections still yields exactly one file — duplicating it
 * would give Obsidian two independent notes with the same content. The remaining
 * collections live in the `sources` property, which stays searchable via
 * `["sources" contains "..."]`.
 *
 * Caller is expected to reject an empty note list before reaching here; an empty
 * input produces an empty archive rather than throwing.
 */
export function toObsidianZip(
  notes: ObsidianNote[],
  options: ObsidianSerializeOptions,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const usedPaths = new Set<string>();

  for (const note of notes) {
    const platform = sanitizeFileName(note.platform, note.id);
    const owner = sortedSources(note.sources)[0];
    const collection = owner ? sanitizeFileName(owner, note.id) : UNSORTED_DIR;
    const dir = `${VAULT_ROOT}/${platform}/${collection}`;

    const sanitizedTitle = sanitizeFileName(note.title, note.id);
    const fileName = dedupeFileName(dir, sanitizedTitle, usedPaths);

    files[`${dir}/${fileName}.md`] = strToU8(toMarkdown(note, sanitizedTitle, options));
  }

  return zipSync(files);
}
