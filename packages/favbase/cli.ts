import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import SKILL_MD from '../../skills/favbase/SKILL.md';
import { main } from './cli-main';
import { queryRegistries } from './update-check';

declare const __FAVBASE_CLI_VERSION__: string;

const version = typeof __FAVBASE_CLI_VERSION__ === 'string'
  ? __FAVBASE_CLI_VERSION__
  : '0.0.0-dev';

/** Resolves once everything written to `stream` so far has been handed to the OS. */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

// No "am I the entrypoint?" guard: this file is the `bin` target and nothing
// imports it. A guard comparing pathToFileURL(process.argv[1]) with
// import.meta.url silently disables the CLI whenever it is reached through a
// symlink -- which is exactly how `npm i -g` delivers it on every platform.
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
  // The only place the real network is wired (docs/27 D12). Tests import
  // cli-main and never this file, so they cannot reach a registry.
  fetchLatestVersion: () => queryRegistries(fetch),
}).then(async (code) => {
  // Exit explicitly instead of waiting for the event loop to drain. Aborting
  // the registry query rejects `fetch` at the budget, but the TCP connect or
  // TLS handshake it started is not cancelled and kept the process alive until
  // undici's own 10 s connect timeout -- and an agent waits for the exit, not
  // for stdout. (A stalled DNS lookup is not covered: libuv joins its
  // threadpool on exit, so process.exit itself waits for getaddrinfo.) Flush
  // first: pipes are asynchronous on POSIX and TTYs on Windows, and
  // process.exit drops whatever is still queued. `daemon run` only gets here
  // after its daemon has closed.
  await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
  process.exit(code);
});
