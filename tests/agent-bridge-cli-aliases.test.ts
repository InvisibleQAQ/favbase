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
        properties?: Record<string, { type?: string; minimum?: number }>;
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

      for (const [name, flag] of Object.entries(alias.flags)) {
        const property = properties[flag.arg];
        expect(flag.kind === 'positive-integer' ? ['integer', 'number'] : ['string']).toContain(
          property?.type,
        );
        // The CLI refuses anything below 1 on its own (`buildAliasArgs`). A
        // schema that accepts 0 would make that local refusal stricter than the
        // tool it fronts, turning a valid call into a usage error.
        if (flag.kind === 'positive-integer') {
          expect(
            property?.minimum,
            `favbase ${alias.command} --${name} refuses values below 1 locally, but ${alias.tool}.${flag.arg} accepts them`,
          ).toBeGreaterThanOrEqual(1);
        }
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

  // An exit-code table is the reading agent's error handling (silent-failure
  // guide, Gotcha 5), and this file keeps its own copy of SKILL.md's for the
  // agent that has no skill yet. Exit 1 also means a file favbase cannot write
  // (5ffe0b8) and a dangling skill link (a8e2d44); this row still said "re-run
  // step 4" for all of it, which loops an agent on an error setup cannot fix.
  // cli-main.test.ts pins SKILL.md's usage line to the CLI's real output; this
  // pins INSTALL.md's row to SKILL.md's.
  it('reads exit code 1 the way SKILL.md does', () => {
    const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');
    const rows = {
      'SKILL.md': readFileSync(SKILL_MD, 'utf8').split('\n').find((line) => line.startsWith('| 1 |')),
      'INSTALL.md': read().split('\n').find((line) => line.startsWith('| exit code 1 |')),
    };
    const usageLine = rows['SKILL.md']?.match(/`(Run favbase --help[^`]*)`/)?.[1];
    expect(usageLine, "SKILL.md's exit-1 row no longer quotes the CLI's usage line").toBeDefined();

    for (const [file, row] of Object.entries(rows)) {
      expect(row, `${file} no longer has the exit-1 row this contract reads`).toBeDefined();
      expect(row, `${file}: a usage error is recognised by its closing line`).toContain(`\`${usageLine}\``);
      expect(row, `${file}: any other exit 1 names its own fix, so it goes to the user`).toContain(
        'show the stderr message to the user',
      );
    }
  });
});

/**
 * `top_k`'s range is the one argument contract spelled out by hand outside the
 * zod chain. docs/27 Step 6 found it in three places with no guard on any; the
 * third, the CLI's `AliasFlag.help`, was never rendered by `favbase --help` and
 * has been deleted (docs/27 D9), so the CLI holds no copy at all. The describe
 * string is now built from the same constants as the zod chain; SKILL.md cannot
 * be (shipped markdown). Both are reconciled here against the JSON Schema the
 * extension actually advertises -- the describe string too, because it stays
 * honest only while the zod chain keeps using the constants. Every failure
 * names the copy that went stale.
 */
describe('hand-written top_k bounds match the live search schema', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');

  // Derived, not named: whichever alias flag fronts `top_k` is the `--<flag>`
  // synopsis SKILL.md has to carry.
  const search = TOOL_ALIASES.find((alias) => alias.tool === 'searchKnowledgeBase');
  const limit = Object.entries(search?.flags ?? {}).find(([, flag]) => flag.arg === 'top_k');

  function liveTopK(): { range: string; description: string } {
    const schema = describeTools().find((tool) => tool.name === 'searchKnowledgeBase')?.inputSchema as
      | {
          properties?: Record<string, { minimum?: number; maximum?: number }>;
          description?: string;
        }
      | undefined;
    const { minimum, maximum } = schema?.properties?.top_k ?? {};
    expect(minimum, 'searchKnowledgeBase.top_k no longer emits a JSON Schema `minimum`').toBeTypeOf('number');
    expect(maximum, 'searchKnowledgeBase.top_k no longer emits a JSON Schema `maximum`').toBeTypeOf('number');
    return { range: `${minimum}-${maximum}`, description: schema?.description ?? '' };
  }

  it('finds the CLI flag that fronts top_k', () => {
    // Reverse assertion: without it, a renamed alias or argument would turn
    // every check below into a crash on `limit!` instead of a named failure.
    expect(limit, 'no `favbase` alias flag maps onto searchKnowledgeBase.top_k').toBeDefined();
  });

  it('SKILL.md states the schema range in its --limit synopsis', () => {
    const { range } = liveTopK();
    const [name] = limit!;
    const stated = [
      ...readFileSync(SKILL_MD, 'utf8').matchAll(new RegExp(`--${name} <(\\d+-\\d+)>`, 'g')),
    ].map((match) => match[1]);

    expect(
      stated,
      `skills/favbase/SKILL.md no longer carries the \`--${name} <min-max>\` synopsis this contract reads`,
    ).not.toEqual([]);
    for (const value of stated) {
      expect(value, `skills/favbase/SKILL.md \`--${name} <${value}>\`: range differs from the top_k schema`).toBe(
        range,
      );
    }
  });

  it('the model-facing describe string states the schema range', () => {
    const { range, description } = liveTopK();
    const clause = description.split('top_k=')[1];
    const copy = 'lib/chat/tools.ts searchKnowledgeBase describe string';

    expect(clause, `${copy} no longer documents top_k`).toBeDefined();
    expect(clause, `${copy}: range differs from what the zod chain enforces`).toContain(range);
  });
});
