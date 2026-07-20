import { describe, expect, it } from 'vitest';
import { classifySignUpResult } from '../../../apps/desktop/src/main/auth/signUpResult.js';

describe('classifySignUpResult', () => {
  it('reports signedIn when a session is returned (autoconfirm on)', () => {
    expect(
      classifySignUpResult({ user: { identities: [{}] }, session: { access_token: 't' } }),
    ).toBe('signedIn');
  });

  it('reports confirmEmail when a user but no session is returned', () => {
    expect(classifySignUpResult({ user: { identities: [{}] }, session: null })).toBe(
      'confirmEmail',
    );
  });

  it('reports alreadyRegistered for the obfuscated existing-email response', () => {
    expect(classifySignUpResult({ user: { identities: [] }, session: null })).toBe(
      'alreadyRegistered',
    );
  });

  it('treats missing identities as confirmEmail, not alreadyRegistered', () => {
    expect(classifySignUpResult({ user: {}, session: null })).toBe('confirmEmail');
    expect(classifySignUpResult({ user: { identities: null }, session: null })).toBe(
      'confirmEmail',
    );
  });

  it('treats a fully empty response as confirmEmail', () => {
    expect(classifySignUpResult({ user: null, session: null })).toBe('confirmEmail');
  });
});
