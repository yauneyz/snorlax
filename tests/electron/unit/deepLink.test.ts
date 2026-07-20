import { describe, expect, it } from 'vitest';
import { parseDeepLink } from '../../../apps/desktop/src/main/deepLink.js';

describe('desktop deep links', () => {
  it('extracts the auth callback without exposing its code in the log label', () => {
    const parsed = parseDeepLink('talysman://auth/callback?code=secret-code&state=secret-state');

    expect(parsed).toMatchObject({
      path: 'auth/callback',
      code: 'secret-code',
      error: null,
      logLabel: 'talysman://auth/callback',
    });
    expect(parsed.logLabel).not.toContain('secret-code');
    expect(parsed.logLabel).not.toContain('secret-state');
  });

  it('extracts provider cancellation errors', () => {
    expect(parseDeepLink('talysman://auth/callback?error=access_denied')).toMatchObject({
      path: 'auth/callback',
      code: null,
      error: 'access_denied',
    });
  });
});
