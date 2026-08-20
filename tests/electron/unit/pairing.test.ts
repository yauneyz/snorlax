import { describe, expect, it } from 'vitest';
import {
  generateSecret,
  hashSecret,
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
