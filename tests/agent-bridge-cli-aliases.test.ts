import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLATFORM_META } from '@/entrypoints/app/collection-platform-registry';
import { DEFAULT_AGENT_BRIDGE_PORT } from '@/lib/agent-bridge/protocol';
import { describeTools } from '@/lib/agent-bridge/tool-registry';
import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import en from '@/lib/i18n/locales/en';
import { AGENT_SETUP_GUIDE_URL, REPO_URL } from '@/lib/repo';
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
 * SKILL.md names the CLI release it ships in, so a copy on disk says which
 * `favbase` it was written for. The Agent Skills spec has no top-level
 * `version` field; it goes under `metadata`, as a string. Markdown cannot read
 * package.json, so a release that bumps one without the other is red here.
 */
describe('favbase SKILL.md states the CLI version it ships with', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');
  const PACKAGE_JSON = path.resolve(__dirname, '..', 'packages', 'favbase', 'package.json');

  it('carries packages/favbase/package.json version as metadata.version', () => {
    const skill = readFileSync(SKILL_MD, 'utf8').replace(/\r\n/g, '\n');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    const metadata = /^metadata:\n((?:[ \t]+.*\n?)*)/m.exec(frontmatter)?.[1] ?? '';
    const version = /^[ \t]+version: "([^"]+)"$/m.exec(metadata)?.[1];
    const { version: cliVersion } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };

    expect(version, 'SKILL.md frontmatter needs `metadata:` with `  version: "<cli version>"`').toBe(cliVersion);
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

  // This file is read from `main`, but `npm install -g favbase` installs the
  // last release, so anything it says about the CLI's behaviour describes a
  // version the reader may not have. Its exit-code table did (docs/30 #4): the
  // rows had to be checked by hand against two versions, and the day they were
  // not, an agent told its user "Chrome is closed" about an unwritable file.
  // The table was deleted (D6-a); failures are read from what ships with the
  // installed CLI -- the skill step 4 writes, `favbase doctor`, `--help`.
  // Exit codes are the first thing to creep back, so they are refused outright.
  it('interprets no exit code: the installed CLI and its skill do that', () => {
    const offenders = read()
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => /\bexit(?:\s+code)?\s+\d/i.test(line));

    expect(
      offenders.map(([line, text]) => `INSTALL.md:${line} ${text.trim()}`),
      'INSTALL.md is read from `main` by agents installing the last release; exit-code advice belongs in SKILL.md',
    ).toEqual([]);
  });
});

/**
 * An integer argument's range is the argument contract spelled out by hand
 * outside the zod chain. docs/27 Step 6 found `top_k`'s in three places with no
 * guard on any; the third, the CLI's `AliasFlag.help`, was never rendered by
 * `favbase --help` and has been deleted (docs/27 D9), so the CLI holds no copy
 * at all. Each describe string is built from the same constants as its zod
 * chain; SKILL.md cannot be (shipped markdown). Both are reconciled here
 * against the JSON Schema the extension actually advertises -- the describe
 * string too, because it stays honest only while the zod chain keeps using the
 * constants. Every failure names the copy that went stale.
 *
 * One case per `positive-integer` alias flag, read off the alias table: a flag
 * added later is held to the same rule without anyone naming it here. Each
 * range is read from its own alias's synopsis line, so `tags --limit <1-200>`
 * and `search --limit <1-20>` are told apart.
 */
describe('hand-written integer bounds match the live tool schemas', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');
  const skillLines = () => readFileSync(SKILL_MD, 'utf8').split(/\r?\n/);
  const isSynopsisOf = (command: string, line: string) => new RegExp(`^favbase ${command}(?: |$)`).test(line);

  const bounded = TOOL_ALIASES.flatMap((alias) =>
    Object.entries(alias.flags)
      .filter(([, flag]) => flag.kind === 'positive-integer')
      .map(([flag, { arg }]) => ({ command: alias.command, tool: alias.tool, flag, arg })),
  );
  type Bound = (typeof bounded)[number];

  function liveBounds({ tool, arg }: Bound): { range: string; description: string } {
    const schema = describeTools().find((descriptor) => descriptor.name === tool)?.inputSchema as
      | {
          properties?: Record<string, { minimum?: number; maximum?: number }>;
          description?: string;
        }
      | undefined;
    const { minimum, maximum } = schema?.properties?.[arg] ?? {};
    expect(minimum, `${tool}.${arg} no longer emits a JSON Schema \`minimum\``).toBeTypeOf('number');
    expect(maximum, `${tool}.${arg} no longer emits a JSON Schema \`maximum\``).toBeTypeOf('number');
    return { range: `${minimum}-${maximum}`, description: schema?.description ?? '' };
  }

  it('finds every bounded CLI flag', () => {
    // Reverse assertion: if reading the alias table ever breaks, every case
    // below vanishes and this block passes on nothing.
    expect(bounded.map(({ command, flag, arg }) => `${command} --${flag} -> ${arg}`)).toEqual(
      expect.arrayContaining(['search --limit -> top_k', 'tags --limit -> limit']),
    );
  });

  it.each(bounded.map((bound) => [`${bound.command} --${bound.flag}`, bound] as const))(
    'SKILL.md states the schema range in its favbase %s synopsis',
    (_flag, bound) => {
      const { range } = liveBounds(bound);
      const synopsis = skillLines().find((line) => isSynopsisOf(bound.command, line));
      expect(synopsis, `skills/favbase/SKILL.md has no \`favbase ${bound.command}\` synopsis line`).toBeDefined();

      const stated = synopsis!.match(new RegExp(`--${bound.flag} <(\\d+-\\d+)>`))?.[1];
      expect(
        stated,
        `skills/favbase/SKILL.md \`${synopsis}\` no longer carries the \`--${bound.flag} <min-max>\` this contract reads`,
      ).toBeDefined();
      expect(
        stated,
        `skills/favbase/SKILL.md \`--${bound.flag} <${stated}>\`: range differs from the ${bound.tool}.${bound.arg} schema`,
      ).toBe(range);
    },
  );

  // The cases above read one line each. A range written anywhere else (prose,
  // an example, another alias's line) is a copy nothing would reconcile.
  it('SKILL.md states a range only where a case above reads it', () => {
    const offenders = skillLines()
      .map((line, index) => [index + 1, line] as const)
      .flatMap(([lineNo, line]) =>
        [...line.matchAll(/--([a-z][a-z-]*) <\d+-\d+>/g)]
          .filter(([, flag]) => !bounded.some((bound) => bound.flag === flag && isSynopsisOf(bound.command, line)))
          .map(([copy]) => `SKILL.md:${lineNo} ${copy}`),
      );

    expect(offenders, 'a hand-written range outside the reconciled synopsis lines').toEqual([]);
  });

  it.each(bounded.map((bound) => [`${bound.tool}.${bound.arg}`, bound] as const))(
    'the describe string states the %s schema range',
    (_arg, bound) => {
      const { range, description } = liveBounds(bound);
      const clause = description.split(`${bound.arg}=`)[1];
      const copy = `lib/chat/tools.ts ${bound.tool} describe string`;

      expect(clause, `${copy} no longer documents ${bound.arg}`).toBeDefined();
      expect(clause, `${copy}: range differs from what the zod chain enforces`).toContain(range);
    },
  );

  // Workflow step 1 also spells the `tags` default ("the top 50"). The JSON
  // Schema carries no default (`.optional()`, filled in `execute`), so the
  // describe string is the source here; `lib/chat/tools.test.ts` holds that
  // string to the limit `execute` really passes.
  it('SKILL.md states the same tags default as the listTags describe string', () => {
    const tags = bounded.find((bound) => bound.tool === 'listTags');
    expect(tags, 'no `favbase` alias flag maps onto listTags.limit').toBeDefined();
    const fallback = liveBounds(tags!).description.split(`${tags!.arg}=`)[1]?.match(/默认 (\d+)/)?.[1];
    expect(fallback, 'the listTags describe string no longer states a default limit').toBeDefined();

    expect(readFileSync(SKILL_MD, 'utf8'), `SKILL.md should say \`favbase tags\` returns the top ${fallback}`).toMatch(
      new RegExp(`\\btop ${fallback}\\b`),
    );
  });
});

/**
 * `npx skills add` (vercel-labs/skills) is the one route that installs the
 * skill without the CLI, and it copies `main`'s SKILL.md. doctor compares
 * every copy byte for byte with the one the installed CLI bundles, so the
 * route is only sound because `main`'s SKILL.md is kept equal to the one the
 * latest npm release bundles (packages/favbase/CLAUDE.md, Release; docs/30 #4,
 * D7-b). That rule is release discipline and has no guard here; what is
 * guarded is the rest of the route:
 * - `-g`. Without it the tool installs into the current project
 *   (`./.agents/skills/`, `./.claude/skills/`), where doctor never looks.
 * - No `#ref`. `main` is the one ref the release rule pins.
 * - LF. For a repository outside its raw-download allowlist the tool always
 *   git-clones, and a clone under core.autocrlf=true -- Git for Windows'
 *   default -- checks the file out as CRLF (measured), hence `.gitattributes`.
 */
describe('npx skills add installs main, globally, with LF endings', () => {
  const ROOT = path.resolve(__dirname, '..');
  const slug = REPO_URL.replace(/^https:\/\/github\.com\//, '');
  const command = `npx skills add ${slug} -g`;
  const read = (file: string) => readFileSync(path.resolve(ROOT, file), 'utf8');
  // Every markdown a user or an agent reads outside the extension.
  const PUBLIC_MARKDOWN = [
    'README.md',
    'README_zh_CN.md',
    'packages/favbase/README.md',
    'skills/favbase/INSTALL.md',
    'skills/favbase/SKILL.md',
  ];

  it('the root README keeps the route', () => {
    expect(read('README.md')).toContain(command);
  });

  it('every public `npx skills add` is exactly that command', () => {
    const offenders = PUBLIC_MARKDOWN.flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => /npx skills add/.test(line) && !line.includes(command))
        .map(([line, text]) => `${file}:${line} ${text.trim()}`),
    );
    expect(offenders, `\`npx skills add\` must read \`${command}\`: global, no ref`).toEqual([]);
  });

  it('.gitattributes checks SKILL.md out with LF endings', () => {
    expect(read('.gitattributes')).toMatch(/^skills\/favbase\/SKILL\.md\s+text\s+eol=lf\s*$/m);
  });
});

/**
 * The root README used to carry a fifth hand-written install guide (after the
 * settings card, SKILL.md's prerequisites, the npm README and INSTALL.md), and
 * nothing guarded it: it still named the settings section "Agent Bridge",
 * showed `<Bridge Token>` to users and listed three of the four commands
 * (docs/30 #13). It now hands out the Agent Setup Guide and nothing more.
 */
describe('the root README points at the setup guide instead of repeating it', () => {
  const README = path.resolve(__dirname, '..', 'README.md');

  it('hands out the Agent Setup Guide URL', () => {
    expect(readFileSync(README, 'utf8')).toContain(AGENT_SETUP_GUIDE_URL);
  });

  it('carries no install or pairing command of its own', () => {
    const readme = readFileSync(README, 'utf8');
    expect(readme).not.toMatch(/npm install -g favbase/);
    expect(readme).not.toMatch(/favbase setup/);
  });
});

/**
 * SKILL.md and the npm README each spell the four alias synopses by hand. Only
 * `--limit`'s range was reconciled (above); a flag renamed in `commands.ts`
 * left both teaching an option the CLI refuses as a usage error (docs/30 #13).
 * Each synopsis line must name exactly the alias's flags, and a positional
 * placeholder exactly when the alias takes one.
 */
describe('hand-written alias synopses match the alias table', () => {
  const DOCS = ['skills/favbase/SKILL.md', 'packages/favbase/README.md'];
  const cases = DOCS.flatMap((doc) => TOOL_ALIASES.map((alias) => [doc, alias.command, alias] as const));

  it.each(cases)('%s: favbase %s', (doc, command, alias) => {
    const lines = readFileSync(path.resolve(__dirname, '..', doc), 'utf8').split(/\r?\n/);
    const synopses = lines.filter((line) => new RegExp(`^favbase ${command}(?: |$)`).test(line));
    expect(synopses, `${doc} has no single \`favbase ${command}\` synopsis line`).toHaveLength(1);

    const [synopsis] = synopses;
    const flags = [...synopsis.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1]);
    expect(flags.sort(), `${doc}: \`${synopsis}\``).toEqual(Object.keys(alias.flags).sort());

    const beforeOptions = synopsis.split('[')[0];
    expect(/<[^>]+>/.test(beforeOptions), `${doc}: \`${synopsis}\` positional`).toBe(alias.positional !== null);
  });
});
