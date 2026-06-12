import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../config/schema.js';

describe('config schema', () => {
  it('applies defaults', () => {
    const c = parseConfig({});
    expect(c.APP_ENV).toBe('development');
    expect(c.FOCUSLOCK_PIPE).toBe('focuslock');
  });
  it('accepts valid overrides', () => {
    const c = parseConfig({ APP_ENV: 'production', FOCUSLOCK_PIPE: 'focuslock' });
    expect(c.APP_ENV).toBe('production');
  });
  it('rejects an invalid APP_ENV', () => {
    expect(() => parseConfig({ APP_ENV: 'staging' })).toThrow(/Invalid FocusLock configuration/);
  });
});
