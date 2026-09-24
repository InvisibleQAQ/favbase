import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalSkillContent,
  inspectSkills,
  installSkill,
  skillRoot,
  SKILL_AGENTS,
} from './skill-install';

const SHIPPED = '---\nname: favbase\n---\nshipped body\n';
const temps: string[] = [];

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-skills-'));
  temps.push(home);
  return home;
}

async function listTree(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).map(String).sort();
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('canonicalSkillContent', () => {
  it('turns CRLF and lone CR into LF and leaves LF text as it is', () => {
    expect(canonicalSkillContent('a\r\nb\rc\nd\r\n\r\n')).toBe('a\nb\nc\nd\n\n');
    expect(canonicalSkillContent(SHIPPED)).toBe(SHIPPED);
    expect(canonicalSkillContent('')).toBe('');
  });
});

describe('inspectSkills', () => {
  it('reports every agent root in order, current and stale, without writing anything', async () => {
    const home = await tempHome();
    await installSkill(SHIPPED, [skillRoot('claude', home)]);
    await installSkill('---\nname: favbase\n---\nolder body\n', [skillRoot('codex', home)]);
    const before = await listTree(home);

    await expect(inspectSkills(SHIPPED, home)).resolves.toEqual([
      { agent: 'claude', path: join(home, '.claude', 'skills', 'favbase', 'SKILL.md'), state: 'current' },
      { agent: 'codex', path: join(home, '.agents', 'skills', 'favbase', 'SKILL.md'), state: 'stale' },
    ]);
    expect(await listTree(home)).toEqual(before);
  });

  it('reports a copy that is not there as missing, and creates nothing', async () => {
    const home = await tempHome();
    const states = await inspectSkills(SHIPPED, home);
    expect(states.map((copy) => copy.agent)).toEqual([...SKILL_AGENTS]);
    expect(states.every((copy) => copy.state === 'missing')).toBe(true);
    expect(await listTree(home)).toEqual([]);
  });

  // Byte for byte, no normalization: a copy re-saved with CRLF endings is
  // not what this CLI ships, and reinstalling it is the fix.
  it('treats a line-ending-only difference as stale', async () => {
    const home = await tempHome();
    await installSkill(SHIPPED.replaceAll('\n', '\r\n'), [skillRoot('claude', home)]);
    const [claude] = await inspectSkills(SHIPPED, home);
    expect(claude.state).toBe('stale');
  });

  it('treats an unreadable copy as stale rather than failing', async () => {
    const home = await tempHome();
    // A directory where the file should be: readFile fails with EISDIR.
    await mkdir(join(skillRoot('claude', home), 'favbase', 'SKILL.md'), { recursive: true });
    // A file where the skill directory should be: ENOTDIR reads as missing.
    await mkdir(skillRoot('codex', home), { recursive: true });
    await writeFile(join(skillRoot('codex', home), 'favbase'), 'not a directory');

    await expect(inspectSkills(SHIPPED, home)).resolves.toMatchObject([
      { agent: 'claude', state: 'stale' },
      { agent: 'codex', state: 'missing' },
    ]);
  });
});
