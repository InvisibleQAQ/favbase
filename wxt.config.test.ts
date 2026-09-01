import { describe, expect, it } from 'vitest';

import config from './wxt.config';

describe('Chrome host permissions', () => {
  it('keeps broad bookmark access without a redundant optional permission', () => {
    const manifest = (config as { manifest?: Record<string, unknown> }).manifest;

    expect(manifest?.host_permissions).toContain('<all_urls>');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
  });

  it('requires Chrome 117 (MUI v9 floor, covers the 116 WebSocket-kept SW floor)', () => {
    const manifest = (config as { manifest?: Record<string, unknown> }).manifest;

    expect(manifest?.minimum_chrome_version).toBe('117');
  });
});
