import { describe, it, expect } from 'vitest';
import { supportsSchemaDelivery } from './index';

// Pure capability matrix — "does the Zod schema actually reach the model?"
// (see lib/providers.ts `supportsJsonSchema` for the openai-compatible flag)
describe('supportsSchemaDelivery', () => {
  it('native SDK providers always deliver the schema', () => {
    expect(supportsSchemaDelivery('openai')).toBe(true);
    expect(supportsSchemaDelivery('claude')).toBe(true);
    expect(supportsSchemaDelivery('gemini')).toBe(true);
  });

  it('openrouter delivers via the supportsJsonSchema capability flag', () => {
    expect(supportsSchemaDelivery('openrouter')).toBe(true);
  });

  it('json_object-only openai-compatible providers do not deliver', () => {
    expect(supportsSchemaDelivery('deepseek')).toBe(false);
    expect(supportsSchemaDelivery('zhipu')).toBe(false);
    expect(supportsSchemaDelivery('kimi')).toBe(false);
    expect(supportsSchemaDelivery('modelscope')).toBe(false);
  });

  it('custom follows the runtime protocol', () => {
    expect(supportsSchemaDelivery('custom', 'claude')).toBe(true);
    expect(supportsSchemaDelivery('custom', 'openai')).toBe(false);
    expect(supportsSchemaDelivery('custom')).toBe(false);
  });
});
