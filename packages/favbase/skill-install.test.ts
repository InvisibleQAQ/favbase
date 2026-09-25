import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalFileError } from './config';
import {
  canonicalSkillContent,
  inspectSkills,
  installAgentSkills,
  installSkill,
  legacyCodexSkillRoot,
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

/** `installAgentSkills`' result when every copy it tried was written. */
function wrote(...written: string[]): { written: string[]; failures: never[] } {
  return { written, failures: [] };
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

    await expect(inspectSkills(SHIPPED, home, {})).resolves.toEqual([
      { agent: 'claude', path: join(home, '.claude', 'skills', 'favbase', 'SKILL.md'), state: 'current' },
      { agent: 'codex', path: join(home, '.agents', 'skills', 'favbase', 'SKILL.md'), state: 'stale' },
    ]);
    expect(await listTree(home)).toEqual(before);
  });

  it('reports a copy that is not there as missing, and creates nothing', async () => {
    const home = await tempHome();
    const states = await inspectSkills(SHIPPED, home, {});
    expect(states.map((copy) => copy.agent)).toEqual([...SKILL_AGENTS]);
    expect(states.every((copy) => copy.state === 'missing')).toBe(true);
    expect(await listTree(home)).toEqual([]);
  });

  // Byte for byte, no normalization: a copy re-saved with CRLF endings is
  // not what this CLI ships, and reinstalling it is the fix.
  it('treats a line-ending-only difference as stale', async () => {
    const home = await tempHome();
    await installSkill(SHIPPED.replaceAll('\n', '\r\n'), [skillRoot('claude', home)]);
    const [claude] = await inspectSkills(SHIPPED, home, {});
    expect(claude.state).toBe('stale');
  });

  it('treats an unreadable copy as stale rather than failing', async () => {
    const home = await tempHome();
    // A directory where the file should be: readFile fails with EISDIR.
    await mkdir(join(skillRoot('claude', home), 'favbase', 'SKILL.md'), { recursive: true });
    // A file where the skill directory should be: ENOTDIR reads as missing.
    await mkdir(skillRoot('codex', home), { recursive: true });
    await writeFile(join(skillRoot('codex', home), 'favbase'), 'not a directory');

    await expect(inspectSkills(SHIPPED, home, {})).resolves.toMatchObject([
      { agent: 'claude', state: 'stale' },
      { agent: 'codex', state: 'missing' },
    ]);
  });
});

// Codex still scans its deprecated `$CODEX_HOME/skills` besides
// `~/.agents/skills` and shows a same-name skill from both. favbase refreshes
// and reports a copy it finds there, never creates one, and creates no
// `.agents` copy beside it either.
describe('the legacy Codex root', () => {
  const OLDER = '---\nname: favbase\n---\nolder body\n';
  const copyIn = (root: string) => join(root, 'favbase', 'SKILL.md');
  const agentsDir = (home: string) => join(home, '.agents');

  it('is $CODEX_HOME/skills, or <home>/.codex/skills when CODEX_HOME is unset or empty', () => {
    const home = join(tmpdir(), 'home');
    const elsewhere = join(tmpdir(), 'codex-home');
    expect(legacyCodexSkillRoot(home, {})).toBe(join(home, '.codex', 'skills'));
    expect(legacyCodexSkillRoot(home, { CODEX_HOME: '' })).toBe(join(home, '.codex', 'skills'));
    expect(legacyCodexSkillRoot(home, { CODEX_HOME: elsewhere })).toBe(join(elsewhere, 'skills'));
  });

  it('is reported after the .agents copy, current or stale, only when a copy is there', async () => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});

    await installSkill(OLDER, [legacy]);
    await expect(inspectSkills(SHIPPED, home, {})).resolves.toEqual([
      { agent: 'claude', path: copyIn(skillRoot('claude', home)), state: 'missing' },
      { agent: 'codex', path: copyIn(skillRoot('codex', home)), state: 'missing' },
      { agent: 'codex', path: copyIn(legacy), state: 'stale' },
    ]);

    await installSkill(SHIPPED, [legacy]);
    const copies = await inspectSkills(SHIPPED, home, {});
    expect(copies.at(-1)).toEqual({ agent: 'codex', path: copyIn(legacy), state: 'current' });
  });

  it('reads CODEX_HOME instead of <home>/.codex when it is set', async () => {
    const home = await tempHome();
    const env = { CODEX_HOME: join(home, 'codex-home') };
    await installSkill(OLDER, [legacyCodexSkillRoot(home, {})]);
    await installSkill(SHIPPED, [legacyCodexSkillRoot(home, env)]);

    const copies = await inspectSkills(SHIPPED, home, env);
    expect(copies.slice(2)).toEqual([
      { agent: 'codex', path: copyIn(join(home, 'codex-home', 'skills')), state: 'current' },
    ]);

    await expect(installAgentSkills(SHIPPED, ['codex'], home, env)).resolves.toEqual(wrote(
      copyIn(join(home, 'codex-home', 'skills')),
    ));
    await expect(readFile(copyIn(legacyCodexSkillRoot(home, {})), 'utf8')).resolves.toBe(OLDER);
    expect(existsSync(agentsDir(home))).toBe(false);

    // The copy under <home>/.codex is not codex's while CODEX_HOME points
    // elsewhere, so it does not stand in for the .agents copy.
    await rm(join(home, 'codex-home'), { recursive: true });
    await expect(installAgentSkills(SHIPPED, ['codex'], home, env)).resolves.toEqual(wrote(
      copyIn(skillRoot('codex', home)),
    ));
  });

  // The cc-switch layout: a legacy copy and no .agents one. Creating .agents
  // would make Codex list favbase twice.
  it('is refreshed for codex instead of creating an .agents copy, and left alone for claude', async () => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});
    await installSkill(OLDER, [legacy]);

    await expect(installAgentSkills(SHIPPED, ['claude'], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('claude', home)),
    ));
    await expect(readFile(copyIn(legacy), 'utf8')).resolves.toBe(OLDER);

    await expect(installAgentSkills(SHIPPED, [...SKILL_AGENTS], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('claude', home)),
      copyIn(legacy),
    ));
    await expect(readFile(copyIn(legacy), 'utf8')).resolves.toBe(SHIPPED);
    expect(existsSync(agentsDir(home))).toBe(false);
  });

  it('is refreshed after the .agents copy when both are there', async () => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});
    await installSkill(OLDER, [skillRoot('codex', home), legacy]);

    await expect(installAgentSkills(SHIPPED, ['codex'], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('codex', home)),
      copyIn(legacy),
    ));
    await expect(readFile(copyIn(skillRoot('codex', home)), 'utf8')).resolves.toBe(SHIPPED);
    await expect(readFile(copyIn(legacy), 'utf8')).resolves.toBe(SHIPPED);
  });

  it('is never created, not even its directory', async () => {
    const home = await tempHome();
    await expect(installAgentSkills(SHIPPED, [...SKILL_AGENTS], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('claude', home)),
      copyIn(skillRoot('codex', home)),
    ));
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  // cc-switch links `~/.codex/skills/favbase` (and `~/.claude/skills/favbase`)
  // to one real directory. A junction needs no privilege on Windows and is a
  // plain directory symlink elsewhere.
  it('is written through a directory link, and a dangling link counts as absent', async () => {
    const home = await tempHome();
    const real = join(home, 'cc-switch', 'favbase');
    await mkdir(real, { recursive: true });
    await writeFile(join(real, 'SKILL.md'), OLDER);
    const legacy = legacyCodexSkillRoot(home, {});
    await mkdir(legacy, { recursive: true });
    await symlink(real, join(legacy, 'favbase'), 'junction');

    await expect(inspectSkills(SHIPPED, home, {})).resolves.toContainEqual(
      { agent: 'codex', path: copyIn(legacy), state: 'stale' },
    );
    await expect(installAgentSkills(SHIPPED, ['codex'], home, {})).resolves.toEqual(wrote(
      copyIn(legacy),
    ));
    await expect(readFile(join(real, 'SKILL.md'), 'utf8')).resolves.toBe(SHIPPED);
    expect(existsSync(agentsDir(home))).toBe(false);

    // Dangling, the link is no copy, so codex has none and gets its .agents one.
    await rm(real, { recursive: true });
    await expect(inspectSkills(SHIPPED, home, {})).resolves.toHaveLength(2);
    await expect(installAgentSkills(SHIPPED, ['codex'], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('codex', home)),
    ));
    expect(existsSync(real)).toBe(false);
  });

  // `stat`, not `lstat`: a dangling link *as* SKILL.md has to read as absent,
  // or writeFile follows it and creates the file it points at.
  it('treats a dangling file link as absent and creates nothing at its target', async (ctx) => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});
    const target = join(home, 'elsewhere', 'SKILL.md');
    await mkdir(join(home, 'elsewhere'));
    await mkdir(join(legacy, 'favbase'), { recursive: true });
    try {
      await symlink(target, copyIn(legacy), 'file');
    } catch (error) {
      // Windows needs Developer Mode or elevation for a file symlink.
      ctx.skip(`cannot create a file symlink here: ${(error as Error).message}`);
    }

    await expect(inspectSkills(SHIPPED, home, {})).resolves.toHaveLength(2);
    await expect(installAgentSkills(SHIPPED, ['codex'], home, {})).resolves.toEqual(wrote(
      copyIn(skillRoot('codex', home)),
    ));
    expect(existsSync(target)).toBe(false);
  });

  // Only "not there" skips the copy. Anything else is what doctor calls stale,
  // and install-skill has to report it rather than skip the copy in silence:
  // as a LocalFileError naming the path, which the CLI reports as exit 1.
  // Something is there, so it also counts as codex's copy: none is created
  // in .agents beside it.
  it('surfaces an error other than a missing copy, naming the path', async () => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});
    const loop = join(legacy, 'favbase');
    await mkdir(legacy, { recursive: true });
    await symlink(loop, loop, 'junction');

    await expect(inspectSkills(SHIPPED, home, {})).resolves.toContainEqual(
      { agent: 'codex', path: copyIn(legacy), state: 'stale' },
    );
    const { written, failures } = await installAgentSkills(SHIPPED, ['codex'], home, {});
    expect(written).toEqual([]);
    expect(failures).toHaveLength(1);
    const [error] = failures;
    expect(error).toBeInstanceOf(LocalFileError);
    expect(error).toMatchObject({
      message: expect.stringMatching(/^cannot write .+: ELOOP: /),
      cause: { code: 'ELOOP', path: copyIn(legacy) },
    });
    expect(error.message.startsWith(`cannot write ${copyIn(legacy)}: `)).toBe(true);
    expect(existsSync(agentsDir(home))).toBe(false);
  });

  // Copy by copy, not agent by agent: the .agents copy fails its write, and
  // the legacy copy after it is still refreshed and still reported.
  it('still refreshes the copy after one that fails', async () => {
    const home = await tempHome();
    const legacy = legacyCodexSkillRoot(home, {});
    await installSkill(OLDER, [legacy]);
    // A directory where SKILL.md goes: stat finds it, the write fails.
    await mkdir(copyIn(skillRoot('codex', home)), { recursive: true });

    const { written, failures } = await installAgentSkills(SHIPPED, ['codex'], home, {});
    expect(written).toEqual([copyIn(legacy)]);
    await expect(readFile(copyIn(legacy), 'utf8')).resolves.toBe(SHIPPED);
    expect(failures.map((failure) => failure.message.startsWith(`cannot write ${copyIn(skillRoot('codex', home))}: `)))
      .toEqual([true]);
  });
});

// A root that links to a directory that exists is followed, as before: the new
// copy lands in the link's target. (A dangling one is cli-main.test.ts'.)
describe('creating a copy through a linked skill root', () => {
  it('writes into the target of a root that links to an existing directory', async (ctx) => {
    const home = await tempHome();
    const real = join(home, 'shared-skills');
    await mkdir(real);
    await mkdir(join(home, '.agents'));
    try {
      await symlink(real, skillRoot('codex', home), 'junction');
    } catch (error) {
      ctx.skip(`cannot create a directory link here: ${(error as Error).message}`);
    }

    await expect(installAgentSkills(SHIPPED, ['codex'], home, {})).resolves.toEqual(wrote(
      join(skillRoot('codex', home), 'favbase', 'SKILL.md'),
    ));
    await expect(readFile(join(real, 'favbase', 'SKILL.md'), 'utf8')).resolves.toBe(SHIPPED);
  });
});
