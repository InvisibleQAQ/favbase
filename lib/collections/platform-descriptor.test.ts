import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { PLATFORM_DESCRIPTORS } from './platform-descriptor';
import { COLLECTION_PLATFORMS } from './platforms';

/**
 * The platform half of the manifest, in the exact order `wxt.config.ts` flattens
 * it. An installed MV3 extension asks the user to re-authorize the moment this
 * set changes, so the list is locked here instead of only being diffed by hand
 * at build time (docs/26 iron rule 2).
 */
const HOST_PERMISSIONS = [
  'https://*.bilibili.com/*',
  'https://api.bilibili.com/*',
  'https://*.hdslb.com/*',
  'https://*.bilivideo.com/*',
  'https://*.bilivideo.cn/*',
  'https://api.github.com/*',
  '<all_urls>',
  '*://x.com/*',
  'https://www.zhihu.com/*',
  'https://api.zhihu.com/*',
  'https://www.googleapis.com/*',
];

describe('platform descriptor', () => {
  it('declares every platform exactly once, in canonical order', () => {
    expect(Object.keys(PLATFORM_DESCRIPTORS)).toEqual([...COLLECTION_PLATFORMS]);
  });

  it('keeps the manifest host permissions and their order', () => {
    expect(
      COLLECTION_PLATFORMS.flatMap((platform) => [
        ...PLATFORM_DESCRIPTORS[platform].hostPermissions,
      ]),
    ).toEqual(HOST_PERMISSIONS);
  });

  it('gives every platform at least one origin to reach', () => {
    for (const platform of COLLECTION_PLATFORMS) {
      expect(PLATFORM_DESCRIPTORS[platform].hostPermissions, platform).not.toHaveLength(0);
    }
  });

  it('value-imports nothing but the discriminator module', () => {
    // docs/26 iron rule 3: `wxt.config.ts` loads this module in Node by
    // relative path. A value import that reaches drizzle, `chrome.*` or JSX
    // breaks the build with an error that never points back here, so the rule
    // is executable instead of a comment nobody re-reads.
    const file = path.join(__dirname, 'platform-descriptor.ts');
    const ast = ts.createSourceFile(
      'platform-descriptor.ts',
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const valueImports = ast.statements
      .filter(ts.isImportDeclaration)
      .filter((node) => !node.importClause?.isTypeOnly)
      .map((node) =>
        ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : node.moduleSpecifier.getText(ast),
      );

    expect(valueImports).toEqual(['./platforms']);
  });

  it('keeps background-job namespaces unique', () => {
    // Jobs are keyed `{jobPlatform}:{kind}`, so two platforms sharing a
    // namespace share one lane: the second sync is dropped as a duplicate and
    // the global reminder attributes the running one to the wrong platform.
    const namespaces = COLLECTION_PLATFORMS.map(
      (platform) => PLATFORM_DESCRIPTORS[platform].jobPlatform,
    );
    expect(new Set(namespaces).size).toBe(namespaces.length);
  });
});
