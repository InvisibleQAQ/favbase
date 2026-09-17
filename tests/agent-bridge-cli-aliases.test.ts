import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLATFORM_META } from '@/entrypoints/app/collection-platform-registry';
import { DEFAULT_AGENT_BRIDGE_PORT } from '@/lib/agent-bridge/protocol';
import { describeTools } from '@/lib/agent-bridge/tool-registry';
import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import en from '@/lib/i18n/locales/en';
import { AGENT_SETUP_GUIDE_URL } from '@/lib/repo';
import { TOOL_ALIASES } from '../packages/favbase/commands';

/**
 * The favbase CLI's ergonomic subcommands (`search` / `tags` / `get` /
 * `coverage`) are the only place outside the extension that spells Knowledge
 * Tool and argument names. This contract pins every alias to the live `chatTools` registry so a
 * renamed tool or argument fails here instead of at an agent's terminal.
 */
describe('favbase CLI aliases match the Knowledge Tool registry', () => {
  const descriptors = new Map(describeTools().map((tool) => [tool.name, tool]));

  it('covers every Knowledge Tool exactly once', () => {
    expect(TOOL_ALIASES.map((alias) => alias.tool).sort()).toEqual([...descriptors.keys()].sort());
  });

  it.each(TOOL_ALIASES.map((alias) => [alias.command, alias] as const))(
    'favbase %s maps only onto declared arguments and covers required ones',
    (_command, alias) => {
      const descriptor = descriptors.get(alias.tool);
      expect(descriptor).toBeDefined();
      const schema = descriptor!.inputSchema as {
        properties?: Record<string, { type?: string }>;
        required?: string[];
      };
      const properties = schema.properties ?? {};

      const mapped = [
        ...(alias.positional ? [alias.positional.arg] : []),
        ...Object.values(alias.flags).map((flag) => flag.arg),
      ];
      for (const arg of mapped) expect(Object.keys(properties)).toContain(arg);
      expect(new Set(mapped).size).toBe(mapped.length);

      for (const required of schema.required ?? []) expect(mapped).toContain(required);

      for (const flag of Object.values(alias.flags)) {
        const type = properties[flag.arg]?.type;
        expect(flag.kind === 'integer' ? ['integer', 'number'] : ['string']).toContain(type);
      }
    },
  );
});

/**
 * SKILL.md is the other half of that same sentence: besides the tool and
 * argument names above, it is the only place outside the extension that spells
 * the Collection Platforms — and it teaches them to an external agent, the way
 * `chatTools`' descriptions teach them to the in-app one (docs/26 Step 1 and
 * appendix A item 3 — this used to be an unguarded row in
 * platform-onboarding.md §9). Being shipped markdown it cannot derive either of
 * its two lists, so both reconciliations live here.
 */
describe('favbase SKILL.md matches the live platform list', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');
  const PLATFORM_SENTENCE = /`<platform>` is one of ([^.]+)\./;
  const DESCRIPTION_LIST = /^description:[^(]*\(([^)]+)\)/m;

  it('names every platform, and no platform the product dropped', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    const sentence = skill.match(PLATFORM_SENTENCE)?.[1];
    expect(
      sentence,
      'SKILL.md no longer carries the "`<platform>` is one of …." sentence this contract reads',
    ).toBeDefined();

    const listed = [...(sentence ?? '').matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]);
    expect(listed.slice().sort()).toEqual([...COLLECTION_PLATFORMS].sort());
  });

  // The `<platform>` sentence above is not the only hand-written list in this
  // file. The frontmatter `description` names the platforms a second time, in
  // display prose, and that copy is what an agent *selects the skill by*: a
  // platform missing there means the agent never reaches for favbase when the
  // user asks about it — no error, no red test, just a knowledge base that
  // appears not to know. So the parenthesised list is reconciled the same way,
  // against the in-app names (`PLATFORM_META.title` resolved through the en
  // locale) rather than the ids, because prose cannot spell `x` unambiguously.
  // The coupling is deliberate: renaming a platform in the product renames it
  // here too.
  it('names every platform in the frontmatter description an agent selects by', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    const listed = skill.match(DESCRIPTION_LIST)?.[1];
    expect(
      listed,
      'SKILL.md frontmatter `description` no longer carries the parenthesised platform list this contract reads',
    ).toBeDefined();

    expect((listed ?? '').split(',').map((entry) => entry.trim().toLowerCase())).toEqual(
      COLLECTION_PLATFORMS.map((platform) => en[PLATFORM_META[platform].title].toLowerCase()),
    );
  });
});

/**
 * The third hand-written thing in SKILL.md is the invocation itself. Its
 * frontmatter declares `allowed-tools: Bash(favbase:*)`, which permits exactly
 * one command shape — an agent that reads a `npx -y favbase …` instruction
 * follows it, gets denied by its own permission layer, and reports the library
 * as unreachable. The contradiction is invisible in review because the two
 * halves sit twenty lines apart, so it is asserted instead: this file said
 * "prefix every command with `npx -y favbase`" until docs/27 Step 1.
 */
describe('favbase SKILL.md only teaches the invocation its allowed-tools permit', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');

  it('declares the bare `favbase` command as its only allowed tool', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    expect(skill).toMatch(/^allowed-tools: Bash\(favbase:\*\)$/m);
  });

  it('never instructs the agent to reach for a runner allowed-tools would deny', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    const offenders = skill
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => /\b(npx|pnpm dlx|bunx|yarn dlx)\b/.test(line));

    expect(
      offenders.map(([line, text]) => `SKILL.md:${line} ${text.trim()}`),
      'allowed-tools permits `favbase` only; a runner prefix here is an instruction the agent cannot follow',
    ).toEqual([]);
  });
});

/**
 * INSTALL.md (the Agent Setup Guide, docs/adr/0005) is the fourth hand-written
 * copy of "how to install favbase" -- after the settings card's
 * `settings.agentBridge.commands*`, SKILL.md's prerequisites and the npm
 * README. Four copies drift, and they already did: renaming the settings
 * section to Agent Skills (e462948) left SKILL.md and the README pointing at a
 * menu entry that no longer exists, with nothing red to show for it.
 *
 * Unlike SKILL.md this file is fetched over the network from `main`, so a
 * mistake here is live for every user the moment it merges -- and the agent
 * reading it has no way to tell a stale instruction from a current one.
 */
describe('favbase INSTALL.md stays reconciled with what it installs', () => {
  const INSTALL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'INSTALL.md');
  // Read per test, not once in the describe body: a missing file there throws
  // during collection and vitest reports "no tests" instead of naming the
  // contract that broke.
  const read = () => readFileSync(INSTALL_MD, 'utf8');

  // The URL is a public contract: users paste it into their own prompts, so
  // the file has to sit exactly where lib/repo.ts says it does. Moving the
  // file is otherwise a silent 404 nobody in this repo ever sees.
  it('is reachable at the path the published URL promises', () => {
    const repoPath = AGENT_SETUP_GUIDE_URL.split('/main/')[1];
    expect(repoPath, 'AGENT_SETUP_GUIDE_URL no longer points into the `main` branch').toBe(
      'skills/favbase/INSTALL.md',
    );
    expect(existsSync(path.resolve(__dirname, '..', repoPath))).toBe(true);
  });

  it('sends the user to the settings section that actually exists', () => {
    const install = read();
    expect(install).toContain(en['settings.agentBridge.title']);
    expect(install).toContain(en['settings.tabConnections']);
  });

  it('installs the package this repository publishes', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', 'packages', 'favbase', 'package.json'), 'utf8'),
    ) as { name: string };
    expect(read()).toContain(`npm install -g ${pkg.name}`);
  });

  it('quotes the pairing command and default port the CLI really uses', () => {
    const usage = readFileSync(
      path.resolve(__dirname, '..', 'packages', 'favbase', 'cli-main.ts'),
      'utf8',
    );
    const install = read();
    expect(usage).toContain('setup --token <token> [--port <port>]');
    expect(install).toContain('favbase setup --token');
    expect(install).toContain('--port');
    expect(install).toContain(String(DEFAULT_AGENT_BRIDGE_PORT));
  });

  // The whole reason this document pauses in the middle is that the pairing
  // token lives only inside the running extension. An edit that quietly turns
  // the pause into a ready-made command hands the agent a placeholder to fail
  // with -- and the failure surfaces as "favbase is broken", not as a doc bug.
  it('never hands the agent a runnable setup command of its own', () => {
    const offenders = read()
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => /favbase setup --token\s+(?!<)/.test(line));

    expect(
      offenders.map(([line, text]) => `INSTALL.md:${line} ${text.trim()}`),
      'the token must stay a placeholder: only the extension can produce a real one',
    ).toEqual([]);
  });
});
