import type { BridgePeerSnapshot } from './bridge-server';
import {
  configPath,
  daemonLogPath,
  resolveConfig,
  type ConfigEnv,
  type ResolvedConfig,
} from './config';
import {
  ensureDaemon,
  fetchStatus,
  type EnsureDaemonOptions,
  type EnsureDaemonResult,
} from './daemon-client';
import {
  describeError,
  describeToolError,
  EXTENSION_LATENCY_HINT,
  type Failure,
} from './exit-codes';
import type { HealthResponse, StatusResponse } from './rpc-server';
import { inspectSkills, SKILL_AGENTS, type SkillCopy } from './skill-install';
import type { CliCurrency } from './update-check';

/*
 * `favbase doctor` (docs/30 #3). The probes never throw: each failure becomes
 * a value in the probe's own result, and one pure assembly turns the results
 * into the whole report -- the JSON, the exit code (through `exit-codes.ts`,
 * like every other command) and the stderr lines. So there is one output path,
 * and a failure anywhere still prints every section. Before, the report was
 * built by hand in two branches, and a failure in the daemon half escaped both:
 * one stderr line and no JSON, exactly when SKILL.md's exit-2 row sends an
 * agent here.
 */

/** The `message` of an `extension-unavailable` found by a status check, not by a tool call. */
export const NOT_CONNECTED = 'no favbase extension is connected to the daemon';

/**
 * How far doctor got along config -> daemon -> extension. Each step needs the
 * one before it, so the walk stops at the first failure and keeps that error
 * raw for `describeError`. No state holds a daemon failure next to an
 * extension state (D5-a): without a daemon there is none to read.
 */
export type DoctorLink =
  | { reached: 'config'; error: unknown }
  | {
    reached: 'daemon';
    config: ResolvedConfig;
    /** What `ensureDaemon` found when only `/status` failed; `null` when it failed itself. */
    ensured: EnsureDaemonResult | null;
    error: unknown;
  }
  | { reached: 'extension'; config: ResolvedConfig; ensured: EnsureDaemonResult; status: StatusResponse };

export interface DoctorProbes {
  env: ConfigEnv;
  cli: CliCurrency;
  skills: readonly SkillCopy[];
  link: DoctorLink;
}

export interface DoctorContext extends EnsureDaemonOptions {
  /** Home directory of the personal skill roots. */
  homeDir: string;
  /** The SKILL.md this CLI ships, already canonical. */
  skillContent: string;
}

/** A section doctor could not fill: its probe failed, or one it needs did. */
interface Problem {
  problem: string;
}

type DaemonFound = Pick<EnsureDaemonResult, 'spawned' | 'replaced'>;

/** Every report has these seven keys, in this order, whatever failed. */
export interface DoctorJson {
  /** The extension is connected; the one thing an agent needs before retrying. */
  ok: boolean;
  cli: CliCurrency;
  config: { path: string } & (Problem | Pick<ResolvedConfig, 'port' | 'tokenSource' | 'portSource'>);
  daemon:
    | Problem
    | (HealthResponse & DaemonFound & Problem)
    | (StatusResponse['daemon'] & DaemonFound);
  extension: Problem | BridgePeerSnapshot;
  skills: readonly SkillCopy[];
  troubleshooting: string[];
}

export interface DoctorReport {
  json: DoctorJson;
  /** Printed after the JSON and the skill hint; `null` is exit 0. */
  failure: Failure | null;
  /** The one stderr line about skill copies, or `null` (docs/27 D11). */
  skillHint: string | null;
}

/**
 * What a failed step leaves unchecked, and the reminder that follows its fix
 * in `troubleshooting` (D5-a): the user is told the rest was not looked at,
 * rather than given advice about Chrome that has nothing to do with the cause.
 */
const UNCHECKED = {
  config: {
    problem: 'not checked, because the config is unusable',
    reminder: 'The daemon and the link to the extension were not checked, because the config is unusable. Fix the problem above, then run favbase doctor again.',
  },
  daemon: {
    problem: 'not checked, because the daemon is unavailable',
    reminder: 'The link to the extension was not checked, because the daemon is unavailable. Fix the problem above, then run favbase doctor again.',
  },
} as const;

async function walkLink(context: DoctorContext): Promise<DoctorLink> {
  let config: ResolvedConfig;
  try {
    config = await resolveConfig(context.env);
  } catch (error) {
    return { reached: 'config', error };
  }
  let ensured: EnsureDaemonResult | null = null;
  try {
    ensured = await ensureDaemon(config, context);
    return { reached: 'extension', config, ensured, status: await fetchStatus(config, true) };
  } catch (error) {
    return { reached: 'daemon', config, ensured, error };
  }
}

/** Runs every probe. Never throws: `inspectSkills` and the currency check never do. */
export async function probeDoctor(
  context: DoctorContext,
  currency: Promise<CliCurrency>,
): Promise<DoctorProbes> {
  const skills = await inspectSkills(context.skillContent, context.homeDir, context.env);
  const link = await walkLink(context);
  return { env: context.env, cli: await currency, skills, link };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extensionTroubleshooting(
  config: ResolvedConfig,
  env: ConfigEnv,
  extension: BridgePeerSnapshot,
): string[] {
  const tokenCheck = extension.lastRejectedHelloReason === 'bad-token'
    ? `The last extension hello was rejected because its pairing token did not match this daemon${
      extension.lastRejectedHelloAt === null
        ? ''
        : ` at ${new Date(extension.lastRejectedHelloAt).toISOString()}`
    } (rejected hellos this daemon run: ${extension.rejectedHelloCount}). Copy the setup command from Settings > Connections > Agent Skills and run it again.`
    : 'Confirm the pairing token matches the token copied from Settings > Connections > Agent Skills.';
  return [
    tokenCheck,
    'Confirm Agent Skills is enabled in Settings > Connections.',
    'Confirm Chrome is running with favbase installed.',
    `Confirm the extension port is ${config.port}.`,
    `Inspect the daemon log at ${daemonLogPath(env)}.`,
  ];
}

/**
 * The stderr line for skill copies (docs/27 D11): only when a copy is stale or
 * every copy is missing. One missing side is taken as deliberate. `stale` only
 * says "differs from what this CLI ships" -- the copy may be newer (installed
 * from GitHub main) -- so an outdated CLI is upgraded first, or install-skill
 * would roll the copy back to an older skill. Codex can have two copies (its
 * legacy root); the hint names an agent once.
 */
function skillHint(skills: readonly SkillCopy[], cli: CliCurrency): string | null {
  const stale = [...new Set(skills.filter((copy) => copy.state === 'stale').map((copy) => copy.agent))];
  const allMissing = skills.every((copy) => copy.state === 'missing');
  if (stale.length === 0 && !allMissing) return null;
  const run = cli.state === 'outdated'
    ? 'upgrade this CLI first (npm install -g favbase@latest), then run'
    : 'run';
  return stale.length > 0
    ? `[favbase] the installed skill for ${stale.join(' and ')} differs from the one favbase ${cli.version} ships; ${run} favbase install-skill --agent ${stale.join(',')}`
    : `[favbase] no favbase skill is installed for ${SKILL_AGENTS.join(' or ')} (a copy installed with --dir is invisible to doctor); ${run} favbase install-skill`;
}

/**
 * Probe results -> report; pure. `ok` is "nothing failed", which is "the
 * extension is connected": `skills` and `cli` are advisory and never produce a
 * failure, because exit 2 means "unreachable" in SKILL.md's table and a stale
 * skill is not. A failed step's error is classified by `describeError`, so its
 * exit code and stderr lines are what any other command prints for it; its
 * message is also the step's `problem` and the first troubleshooting item.
 */
export function assembleDoctorReport(probes: DoctorProbes): DoctorReport {
  const { env, cli, skills, link } = probes;
  const report = (
    sections: Pick<DoctorJson, 'config' | 'daemon' | 'extension'>,
    troubleshooting: string[],
    failure: Failure | null,
  ): DoctorReport => ({
    json: {
      ok: failure === null,
      cli,
      config: sections.config,
      daemon: sections.daemon,
      extension: sections.extension,
      skills,
      troubleshooting,
    },
    failure,
    skillHint: skillHint(skills, cli),
  });

  if (link.reached === 'config') {
    const problem = messageOf(link.error);
    const unchecked = { problem: UNCHECKED.config.problem };
    return report(
      { config: { path: configPath(env), problem }, daemon: unchecked, extension: unchecked },
      [problem, UNCHECKED.config.reminder],
      describeError(link.error),
    );
  }

  // Projected field by field: `ResolvedConfig` also holds the pairing token.
  const config = {
    path: link.config.configPath,
    port: link.config.port,
    tokenSource: link.config.tokenSource,
    portSource: link.config.portSource,
  };

  if (link.reached === 'daemon') {
    const problem = messageOf(link.error);
    const found = link.ensured && {
      ...link.ensured.health,
      spawned: link.ensured.spawned,
      replaced: link.ensured.replaced,
    };
    return report(
      { config, daemon: { ...found, problem }, extension: { problem: UNCHECKED.daemon.problem } },
      [problem, UNCHECKED.daemon.reminder],
      describeError(link.error),
    );
  }

  const { ensured, status } = link;
  const sections = {
    config,
    daemon: { ...status.daemon, spawned: ensured.spawned, replaced: ensured.replaced },
    extension: status.extension,
  };
  if (status.extension.connected) return report(sections, [], null);
  const troubleshooting = extensionTroubleshooting(link.config, env, status.extension);
  return report(sections, troubleshooting, describeToolError(
    'extension-unavailable',
    NOT_CONNECTED,
    `${troubleshooting.join(' ')} ${EXTENSION_LATENCY_HINT}`,
  ));
}
