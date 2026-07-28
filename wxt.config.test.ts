import { describe, expect, it } from 'vitest';

import config from './wxt.config';

describe('Chrome host permissions', () => {
  it('keeps broad bookmark access without a redundant optional permission', () => {
    const manifest = (config as { manifest?: Record<string, unknown> }).manifest;

    expect(manifest?.host_permissions).toContain('<all_urls>');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
  });
});
