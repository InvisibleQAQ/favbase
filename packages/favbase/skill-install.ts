import { lstat, mkdir, readFile, readlink, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { UsageError } from './args';
import { LocalFileError, writingFile, type ConfigEnv } from './config';

export const SKILL_AGENTS = ['claude', 'codex'] as const;
export type SkillAgent = typeof SKILL_AGENTS[number];
export const SKILL_DIR_NAME = 'favbase';
export const SKILL_FILE_NAME = 'SKILL.md';

/**
 * The personal skill root favbase creates a copy in, for an agent that has
 * none yet. Claude Code reads `~/.claude/skills/<name>/SKILL.md`; Codex reads
 * the agentskills.io user scope `~/.agents/skills`, and still scans its legacy
 * root too (`legacyCodexSkillRoot`), which favbase refreshes but never creates.
 */
export function skillRoot(agent: SkillAgent, home: string = homedir()): string {
  return agent === 'claude'
    ? join(home, '.claude', 'skills')
    : join(home, '.agents', 'skills');
}

/**
 * Codex's deprecated user root, `$CODEX_HOME/skills`, kept by Codex for
 * backward compatibility; it shows a same-name skill from both roots. Codex's
 * own rule for `CODEX_HOME`: unset or empty means `~/.codex`, anything else is
 * used as given.
 */
export function legacyCodexSkillRoot(home: string, env: ConfigEnv): string {
  return join(env.CODEX_HOME || join(home, '.codex'), 'skills');
}

interface PersonalRoot {
  agent: SkillAgent;
  root: string;
  /**
   * Reported only when a copy is there. Never created: `installAgentSkills`
   * creates only in `skillRoot`, and it refreshes a copy here like any other.
   */
  legacy: boolean;
}

/** Every personal root of `agents`, in the order they are written and reported. */
function personalRoots(
  agents: readonly SkillAgent[],
  home: string,
  env: ConfigEnv,
): PersonalRoot[] {
  return agents.flatMap((agent) => [
    { agent, root: skillRoot(agent, home), legacy: false },
    ...(agent === 'codex' ? [{ agent, root: legacyCodexSkillRoot(home, env), legacy: true }] : []),
  ]);
}

/**
 * `--agent`: absent, empty or `all` means every agent; otherwise names split on
 * commas **or whitespace** -- Windows PowerShell's npm `.ps1` shim delivers an
 * unquoted `claude,codex` as `claude codex`. A value of separators only is
 * checked whole, so it still fails as an unknown agent.
 */
export function parseSkillAgents(value: string | undefined): SkillAgent[] {
  if (!value || value === 'all') return [...SKILL_AGENTS];
  const names = value.split(/[\s,]+/).filter(Boolean);
  const agents = new Set<SkillAgent>();
  for (const name of names.length > 0 ? names : [value]) {
    if (!(SKILL_AGENTS as readonly string[]).includes(name)) {
      throw new UsageError(`Unknown agent "${name}"; use ${SKILL_AGENTS.join(', ')} or all`);
    }
    agents.add(name as SkillAgent);
  }
  return [...agents];
}

function skillPath(root: string): string {
  return join(root, SKILL_DIR_NAME, SKILL_FILE_NAME);
}

/**
 * The bundled SKILL.md is whatever the publisher's checkout held, and a
 * CRLF checkout (`core.autocrlf=true`, no `.gitattributes`) would bundle CRLF.
 * `main` passes it through here once, so install-skill and setup always write
 * LF and `inspectSkills` compares against LF -- the same bytes GitHub serves
 * to `npx skills add`. Installed copies are never normalized.
 */
export function canonicalSkillContent(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/**
 * Writes `<root>/favbase/SKILL.md` under every root; returns the written paths.
 * A failure is a `LocalFileError` naming the copy.
 */
export async function installSkill(
  content: string,
  roots: readonly string[],
): Promise<string[]> {
  const written: string[] = [];
  for (const root of roots) {
    const path = skillPath(root);
    await writingFile(path, async () => {
      await mkdir(join(root, SKILL_DIR_NAME), { recursive: true });
      await writeFile(path, content, 'utf8');
    });
    written.push(path);
  }
  return written;
}

/** What `installAgentSkills` did, copy by copy. */
export interface SkillInstallResult {
  /** The copies written, in `personalRoots` order. */
  written: string[];
  /** One per copy that could not be written; the copies after it were still tried. */
  failures: LocalFileError[];
}

/**
 * Runs one copy's write. A `LocalFileError` is recorded in `result` and comes
 * back as `null`, so one copy's failure does not cost the other copies theirs.
 */
async function collect<T>(result: SkillInstallResult, write: () => Promise<T>): Promise<T | null> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof LocalFileError)) throw error;
    result.failures.push(error);
    return null;
  }
}

/**
 * Overwrites `<root>/favbase/SKILL.md` only where it already exists and creates
 * nothing. `stat` follows links, so a copy behind a directory link (cc-switch)
 * is written through it, and a dangling link reads as absent. Any other
 * failure, of the `stat` or the write, is a `LocalFileError` naming the copy.
 * Returns whether any root had a copy; one that failed counts, since something
 * is there, so the caller creates none beside it.
 */
async function refreshSkill(
  content: string,
  roots: readonly string[],
  result: SkillInstallResult,
): Promise<boolean> {
  let found = false;
  for (const root of roots) {
    const path = skillPath(root);
    const refreshed = await collect(result, () => writingFile(path, () => overwriteIfPresent(path, content)));
    if (refreshed) result.written.push(path);
    found ||= refreshed !== false;
  }
  return found;
}

/** `false` when there is no copy at `path` to overwrite. */
async function overwriteIfPresent(path: string, content: string): Promise<boolean> {
  if (!await exists(path)) return false;
  await writeFile(path, content, 'utf8');
  return true;
}

/**
 * Creates `agent`'s copy in `skillRoot`. The root, `<root>/favbase` or its
 * SKILL.md may be a link whose target is gone (`~/.agents/skills` left behind
 * by a removed tool). That link is the user's: favbase names it and writes
 * nothing, rather than failing inside `mkdir` with a bare ENOTDIR or letting
 * `writeFile` follow a file link and create what it points at, and it neither
 * removes the link nor creates its target. The look runs inside `writingFile`,
 * so a failure of the look itself still names the copy; the refusal is raised
 * outside it, so its message is not prefixed with a second path.
 */
async function createSkill(content: string, agent: SkillAgent, home: string): Promise<string> {
  const root = skillRoot(agent, home);
  const path = skillPath(root);
  const dangling = await writingFile(path, () => findDanglingLink([root, join(root, SKILL_DIR_NAME), path]));
  if (dangling) {
    throw new LocalFileError(
      `cannot install the ${agent} skill: ${dangling.link} is a link to ${dangling.target}, which does not exist; `
      + `remove the link or restore its target, then run favbase install-skill --agent ${agent}`,
    );
  }
  await installSkill(content, [root]);
  return path;
}

interface DanglingLink {
  link: string;
  /** Resolved against the link's own directory, as the OS follows it. */
  target: string;
}

/**
 * The first of `paths` that is a link whose target does not exist, or `null`.
 * An absent path is no link. `lstat` sees the link itself; `stat` follows it.
 */
async function findDanglingLink(paths: readonly string[]): Promise<DanglingLink | null> {
  for (const link of paths) {
    if (await isLink(link) && !await exists(link)) {
      return { link, target: resolve(dirname(link), await readlink(link)) };
    }
  }
  return null;
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Follows links. Only ENOENT/ENOTDIR mean absent; any other error is thrown. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * install-skill and setup for named agents: refreshes every copy an agent
 * already has, in any of its roots, and only an agent with no copy at all
 * gets one created in `skillRoot`. Codex lists a same-name skill from both of
 * its roots, so a `.agents` copy created beside a legacy one (cc-switch)
 * would show favbase twice. Every copy is tried: a failure is collected and
 * the rest are still written. The written paths come back in `personalRoots`
 * order: agents as given, codex's legacy copy right after its `.agents` one
 * (doctor walks `SKILL_AGENTS` the same way).
 */
export async function installAgentSkills(
  content: string,
  agents: readonly SkillAgent[],
  home: string,
  env: ConfigEnv,
): Promise<SkillInstallResult> {
  const result: SkillInstallResult = { written: [], failures: [] };
  for (const agent of agents) {
    const roots = personalRoots([agent], home, env).map(({ root }) => root);
    if (await refreshSkill(content, roots, result)) continue;
    const created = await collect(result, () => createSkill(content, agent, home));
    if (created) result.written.push(created);
  }
  return result;
}

/** `stale` means "differs from the SKILL.md this CLI ships" -- it has no direction. */
export type SkillCopyState = 'current' | 'stale' | 'missing';

export interface SkillCopy {
  agent: SkillAgent;
  path: string;
  state: SkillCopyState;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

async function copyState(path: string, expected: Buffer): Promise<SkillCopyState> {
  try {
    return (await readFile(path)).equals(expected) ? 'current' : 'stale';
  } catch (error) {
    return isMissing(error) ? 'missing' : 'stale';
  }
}

/**
 * Read-only: compares each personal skill root's copy byte for byte with
 * `content` (the SKILL.md bundled into this CLI, already LF through
 * `canonicalSkillContent`; the copy is read as is). A copy installed with
 * `--dir` lives outside these roots and is invisible here. An unreadable copy
 * is reported `stale`: it is not current, and reinstalling is the one fix
 * doctor can name (install-skill then reports the real error). The legacy
 * Codex root is listed only when it holds a copy, so a machine without one
 * sees exactly one entry per agent.
 */
export async function inspectSkills(
  content: string,
  home: string,
  env: ConfigEnv,
): Promise<SkillCopy[]> {
  const expected = Buffer.from(content, 'utf8');
  const copies = await Promise.all(
    personalRoots(SKILL_AGENTS, home, env).map(async ({ agent, root, legacy }) => {
      const path = skillPath(root);
      const state = await copyState(path, expected);
      return legacy && state === 'missing' ? [] : [{ agent, path, state }];
    }),
  );
  return copies.flat();
}
