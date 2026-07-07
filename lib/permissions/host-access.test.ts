import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkHostPermission, hostMatchPattern, requestHostPermission } from './host-access';

describe('hostMatchPattern', () => {
  it('maps an https base URL to a scheme://host/* pattern', () => {
    expect(hostMatchPattern('https://api.openai.com/v1/')).toBe('https://api.openai.com/*');
  });

  it('drops the port (match patterns do not take ports)', () => {
    expect(hostMatchPattern('https://myapi.example.com:8443/v1')).toBe('https://myapi.example.com/*');
    expect(hostMatchPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
  });

  it('returns null for empty or unparseable input', () => {
    expect(hostMatchPattern('')).toBeNull();
    expect(hostMatchPattern('not a url')).toBeNull();
  });
});

describe('checkHostPermission', () => {
  const contains = vi.fn();
  const request = vi.fn();

  beforeEach(() => {
    contains.mockReset();
    request.mockReset();
    vi.stubGlobal('browser', { permissions: { contains, request } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns invalid-url without touching permissions API', async () => {
    expect(await checkHostPermission('')).toEqual({ status: 'invalid-url' });
    expect(contains).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('returns granted when the origin is already covered (built-in/static or prior grant)', async () => {
    contains.mockResolvedValue(true);
    expect(await checkHostPermission('https://api.openai.com/v1/')).toEqual({ status: 'granted' });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns needs-grant for an ungranted https origin without prompting', async () => {
    contains.mockResolvedValue(false);
    expect(await checkHostPermission('https://custom.example.com/v1')).toEqual({
      status: 'needs-grant',
      pattern: 'https://custom.example.com/*',
      origin: 'https://custom.example.com',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns unsupported-scheme for an ungranted non-https origin', async () => {
    contains.mockResolvedValue(false);
    expect(await checkHostPermission('http://192.168.1.9:1234/v1')).toEqual({
      status: 'unsupported-scheme',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('requestHostPermission', () => {
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    vi.stubGlobal('browser', { permissions: { request } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('delegates to browser.permissions.request and returns its boolean', async () => {
    request.mockResolvedValue(true);
    expect(await requestHostPermission('https://custom.example.com/*')).toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ['https://custom.example.com/*'] });

    request.mockResolvedValue(false);
    expect(await requestHostPermission('https://custom.example.com/*')).toBe(false);
  });
});
