import { UsageError } from './args';
import { BridgePortInUseError, type BridgeCallErrorCode } from './bridge-server';
import { CHANGE_PORT_HINT } from './config';
import { DaemonError } from './daemon-client';

/*
 * The one place a failure becomes an exit code and its stderr lines (docs/30
 * #2). The exit-code tables in SKILL.md and INSTALL.md are how an agent
 * handles errors, so each row has to fit every failure that lands in its code
 * (silent-failure guide, Gotcha 5); `exit-codes.test.ts` reconciles those two
 * tables and the npm README's with this module.
 *
 * The default is exit 1 (D3): a failure nobody gave a type is printed as
 * `favbase: <message>`, which every table reads as "show the user". Exit 2
 * is kept for failures known to mean "the daemon or the extension did not
 * answer", the ones `favbase doctor` can look into. Before, the default was
 * exit 2, and each untyped failure sent the agent to a doctor that failed on
 * the same error.
 */

export const EXIT_OK = 0;
/**
 * A usage, config or other local problem, and the default for any failure
 * without a type of its own. Only a usage error ends with `USAGE_LINE`; any
 * other exit-1 message is for the user and names the fix where one is known.
 */
export const EXIT_USAGE = 1;
/** The daemon or the extension did not answer, or not in time. */
export const EXIT_UNAVAILABLE = 2;
/** The Knowledge Tool answered with an error. */
export const EXIT_TOOL = 3;

/** `--help`'s summary. Each markdown table has a row for every failing code. */
export const EXIT_CODES: readonly (readonly [code: number, meaning: string])[] = [
  [EXIT_OK, 'ok'],
  [EXIT_USAGE, 'usage/config/local problem'],
  [EXIT_UNAVAILABLE, 'daemon or extension did not answer'],
  [EXIT_TOOL, 'Knowledge Tool error'],
];

/** How a usage error ends; SKILL.md tells an agent to recognise it by this line. */
export const USAGE_LINE = 'Run favbase --help for usage.';

export const EXTENSION_LATENCY_HINT =
  'An already connected extension has no alarm wait and uses local RPC. After Chrome or the daemon starts, reconnection can take one alarm period: about 30 seconds on Chrome 120+ or about 60 seconds on Chrome 116-119. If it takes longer, run favbase doctor.';
const EXTENSION_HINT =
  `confirm Chrome is running, Agent Skills is enabled, and the port and pairing token match. ${EXTENSION_LATENCY_HINT}`;
const TIMEOUT_HINT =
  'the extension did not answer in time; run favbase doctor, and if it reports ok, retry once';
const COMMAND_HINT =
  'check the command: favbase tools lists the Knowledge Tools and argument schemas the extension accepts';

/** One failure as the CLI reports it. */
export interface Failure {
  exitCode: number;
  /** stderr lines, each without its newline. */
  lines: string[];
}

/**
 * What each Knowledge Tool error code means to the caller. Exhaustive on
 * purpose: a new code does not compile until someone decides its exit code.
 * `advice: null` means no command the agent could run fixes it, so the
 * message goes to the user.
 */
const TOOL_ERRORS: Record<BridgeCallErrorCode, { exitCode: number; advice: string | null }> = {
  'extension-unavailable': { exitCode: EXIT_UNAVAILABLE, advice: EXTENSION_HINT },
  'extension-disconnected': { exitCode: EXIT_UNAVAILABLE, advice: EXTENSION_HINT },
  // D4-a: the agent's arguments are not to blame. Doctor tells a dead link
  // from a slow tool; on a slow one, a single retry is all the agent can do.
  timeout: { exitCode: EXIT_UNAVAILABLE, advice: TIMEOUT_HINT },
  'invalid-args': { exitCode: EXIT_TOOL, advice: COMMAND_HINT },
  'unknown-tool': { exitCode: EXIT_TOOL, advice: COMMAND_HINT },
  'db-unavailable': { exitCode: EXIT_TOOL, advice: null },
  'execution-failed': { exitCode: EXIT_TOOL, advice: null },
  // Sent only on a request the CLI has already abandoned; it never reads it.
  cancelled: { exitCode: EXIT_TOOL, advice: null },
};

/**
 * A Knowledge Tool error the daemon answered with. `code` is a plain string:
 * a newer daemon may send one this CLI has never heard of, and that is exit 3
 * with the message for the user. `advice` replaces the code's own advice line;
 * doctor passes its diagnosis there.
 */
export function describeToolError(code: string, message: string, advice?: string): Failure {
  const known = Object.hasOwn(TOOL_ERRORS, code) ? TOOL_ERRORS[code as BridgeCallErrorCode] : null;
  const next = advice ?? known?.advice ?? null;
  return {
    exitCode: known?.exitCode ?? EXIT_TOOL,
    lines: [`favbase: ${code}: ${message}`, ...(next === null ? [] : [`favbase: ${next}`])],
  };
}

/** A failure thrown by a command, or by parsing it. */
export function describeError(error: unknown): Failure {
  if (error instanceof UsageError) {
    return { exitCode: EXIT_USAGE, lines: [`favbase: ${error.message}`, USAGE_LINE] };
  }
  if (error instanceof DaemonError) {
    return { exitCode: EXIT_UNAVAILABLE, lines: [`favbase: ${error.code}: ${error.message}`] };
  }
  if (error instanceof BridgePortInUseError) {
    return userFailure(
      `port ${error.port} is already in use; stop the favbase daemon there (favbase daemon stop), or ${CHANGE_PORT_HINT}`,
    );
  }
  // ConfigError and LocalFileError name their own fix; anything else has no
  // type of its own, and the user is still the one who can read it.
  return userFailure(error instanceof Error ? error.message : String(error));
}

function userFailure(message: string): Failure {
  return { exitCode: EXIT_USAGE, lines: [`favbase: ${message}`] };
}
