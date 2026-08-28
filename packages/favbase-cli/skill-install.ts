import { mkdir, writeFile } from 'node:fs/promises';
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

/** Writes `<root>/favbase/SKILL.md` under every root; returns the written paths. */
export async function installSkill(
  content: string,
  roots: readonly string[],
): Promise<string[]> {
  const written: string[] = [];
  for (const root of roots) {
    const directory = join(root, SKILL_DIR_NAME);
    await mkdir(directory, { recursive: true });
    const path = join(directory, SKILL_FILE_NAME);
    await writeFile(path, content, 'utf8');
    written.push(path);
  }
  return written;
}
