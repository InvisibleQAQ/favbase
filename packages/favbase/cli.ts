import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import SKILL_MD from '../../skills/favbase/SKILL.md';
import { main } from './cli-main';

declare const __FAVBASE_CLI_VERSION__: string;

const version = typeof __FAVBASE_CLI_VERSION__ === 'string'
  ? __FAVBASE_CLI_VERSION__
  : '0.0.0-dev';

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (entrypoint) {
  void main(process.argv.slice(2), {
    env: process.env,
    cliPath: fileURLToPath(import.meta.url),
    homeDir: homedir(),
    skillContent: SKILL_MD,
    version,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    onSignal: (handler) => {
      process.once('SIGINT', handler);
      process.once('SIGTERM', handler);
    },
  }).then((code) => {
    process.exitCode = code;
  });
}
