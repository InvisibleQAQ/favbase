import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from './args';

export const SKILL_AGENTS = ['claude', 'codex'] as const;
export type SkillAgent = typeof SKILL_AGENTS[number];
export const SKILL_DIR_NAME = 'favbase';
export const SKILL_FILE_NAME = 'SKILL.md';

/**
 * Personal skill roots. Claude Code reads `~/.claude/skills/<name>/SKILL.md`;
 * Codex reads the agentskills.io user scope `~/.agents/skills` (its legacy
 * `~/.codex/skills` still works but is not written here).
 */
export function skillRoot(agent: SkillAgent, home: string = homedir()): string {
  return agent === 'claude'
    ? join(home, '.claude', 'skills')
    : join(home, '.agents', 'skills');
}

export function parseSkillAgents(value: string | undefined): SkillAgent[] {
  if (!value || value === 'all') return [...SKILL_AGENTS];
  const agents = new Set<SkillAgent>();
  for (const raw of value.split(',')) {
    const name = raw.trim();
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

/** Writes `<root>/favbase/SKILL.md` under every root; returns the written paths. */
export async function installSkill(
  content: string,
  roots: readonly string[],
): Promise<string[]> {
  const written: string[] = [];
  for (const root of roots) {
    await mkdir(join(root, SKILL_DIR_NAME), { recursive: true });
    const path = skillPath(root);
    await writeFile(path, content, 'utf8');
    written.push(path);
  }
  return written;
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

/**
 * Read-only: compares each personal skill root's copy byte for byte with
 * `content` (the SKILL.md bundled into this CLI, already LF through
 * `canonicalSkillContent`; the copy is read as is). A copy installed with
 * `--dir` lives outside these roots and is invisible here. An unreadable copy
 * is reported `stale`: it is not current, and reinstalling is the one fix
 * doctor can name (install-skill then reports the real error).
 */
export async function inspectSkills(content: string, home: string): Promise<SkillCopy[]> {
  const expected = Buffer.from(content, 'utf8');
  return Promise.all(SKILL_AGENTS.map(async (agent): Promise<SkillCopy> => {
    const path = skillPath(skillRoot(agent, home));
    try {
      const actual = await readFile(path);
      return { agent, path, state: actual.equals(expected) ? 'current' : 'stale' };
    } catch (error) {
      return { agent, path, state: isMissing(error) ? 'missing' : 'stale' };
    }
  }));
}
