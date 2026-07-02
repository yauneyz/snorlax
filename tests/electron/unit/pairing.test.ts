import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCode,
  generateSecret,
  hashRecoveryCode,
  hashSecret,
  normalizeRecoveryCode,
  verifyRecoveryCode,
  verifySecret,
} from '@talysman/core';

describe('pairing secret', () => {
  it('generates 256-bit secrets', () => {
    expect(generateSecret()).toHaveLength(32);
  });
  it('verifies a correct secret and rejects a wrong one', () => {
    const secret = generateSecret();
    const stored = hashSecret(secret);
    expect(verifySecret(secret, stored)).toBe(true);
    expect(verifySecret(generateSecret(), stored)).toBe(false);
  });
});

describe('recovery code', () => {
  it('generates a grouped, unambiguous code', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[IO01]/);
  });
  it('normalizes user input (case, spaces, missing hyphens)', () => {
    expect(normalizeRecoveryCode('k7qf 2m9x rt4p')).toBe('K7QF-2M9X-RT4P');
    expect(normalizeRecoveryCode('K7QF2M9XRT4P')).toBe('K7QF-2M9X-RT4P');
  });
  it('verifies regardless of formatting', () => {
    const code = generateRecoveryCode();
    const stored = hashRecoveryCode(code);
    expect(verifyRecoveryCode(code.toLowerCase().replace(/-/g, ' '), stored)).toBe(true);
    expect(verifyRecoveryCode('AAAA-BBBB-CCCC', stored)).toBe(false);
  });
});
