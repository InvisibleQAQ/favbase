import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_BRIDGE_PORT } from '../../lib/agent-bridge/protocol';
import {
  ConfigError,
  configPath,
  parsePort,
  parseToken,
  readConfigFile,
  resolveConfig,
  SETUP_HINT,
  writeConfigFile,
} from './config';

const homes: string[] = [];

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-config-'));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
});

describe('resolveConfig', () => {
  it('uses the environment token with the default port when no file exists', async () => {
    const env = { FAVBASE_HOME: await tempHome(), FAVBASE_TOKEN: ' env-token ' };
    await expect(resolveConfig(env)).resolves.toEqual({
      token: 'env-token',
      port: DEFAULT_AGENT_BRIDGE_PORT,
      tokenSource: 'env',
      portSource: 'default',
      configPath: configPath(env),
    });
  });

  it('reads the config file and lets the environment port override it', async () => {
    const home = await tempHome();
    await writeConfigFile({ FAVBASE_HOME: home }, { token: 'file-token', port: 2000 });

    await expect(resolveConfig({ FAVBASE_HOME: home })).resolves.toMatchObject({
      token: 'file-token',
      port: 2000,
      tokenSource: 'file',
      portSource: 'file',
    });
    await expect(resolveConfig({ FAVBASE_HOME: home, FAVBASE_BRIDGE_PORT: '3000' }))
      .resolves.toMatchObject({ port: 3000, portSource: 'env' });
  });

  it('fails with the setup hint when no token is configured anywhere', async () => {
    const home = await tempHome();
    await expect(resolveConfig({ FAVBASE_HOME: home })).rejects.toThrow(SETUP_HINT);
    await expect(resolveConfig({ FAVBASE_HOME: home })).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects a corrupt config file instead of ignoring it', async () => {
    const home = await tempHome();
    await writeFile(configPath({ FAVBASE_HOME: home }), '{not json', 'utf8');
    await expect(readConfigFile({ FAVBASE_HOME: home })).rejects.toThrow(/not valid JSON/);
  });
});

describe('config file round trip', () => {
  it('writes pretty JSON containing only token and port', async () => {
    const env = { FAVBASE_HOME: join(await tempHome(), 'nested') };
    const path = await writeConfigFile(env, { token: 'abc', port: 17_836 });

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ token: 'abc', port: 17_836 });
    await expect(readConfigFile(env)).resolves.toEqual({ token: 'abc', port: 17_836 });
  });
});

describe('value parsers', () => {
  it('bound the token length and the port range', () => {
    expect(parseToken('  ', 'x')).toBeNull();
    expect(parseToken(undefined, 'x')).toBeNull();
    expect(() => parseToken('a'.repeat(513), 'FAVBASE_TOKEN')).toThrow(ConfigError);
    expect(parsePort('', 'x')).toBeNull();
    expect(parsePort('8080', 'x')).toBe(8080);
    expect(() => parsePort('0', 'x')).toThrow(ConfigError);
    expect(() => parsePort('65536', 'x')).toThrow(ConfigError);
    expect(() => parsePort('12.5', 'x')).toThrow(ConfigError);
  });
});
